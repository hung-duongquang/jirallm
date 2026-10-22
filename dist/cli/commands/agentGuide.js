import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
/**
 * A guide written for LLM agents (Claude Code, Copilot, …) that drive jirallm from a shell:
 * which command answers which question, the cheapest output for each, and which commands write.
 */
export const AGENT_GUIDE = `---
name: jirallm
description: Read and update Jira and Confluence from the shell with jirallm. Use when a task mentions a Jira key (e.g. ZOD-1234), a sprint, a board column, or asks to assign, transition, comment or log work; to find or read a Confluence page (spec, test report); to test a ticket; or to check what changed in tickets or whether the local ticket context is current.
model: sonnet
---

# jirallm for agents

Output switches to JSON when stdout is piped. Prefer the compact forms below: they cost far fewer tokens.

## Read (safe, no side effects)

| Need | Command |
|---|---|
| Full ticket as markdown (description, AC, comments, attachments, linked Confluence pages) | \`jirallm PROJ-1 --no-status-changes --output-dir ./jira-export\` then read \`jira-export/proj-1/task.md\` |
| Ticket plus its parent chain / linked issues | add \`--include-parent\` / \`--include-linked\` |
| Quick look, no files | \`jirallm fetch PROJ-1\` |
| One Confluence page by URL (e.g. a test report) | \`jirallm page <url>\` → \`jira-export/confluence/<id>-<slug>/page.md\` |
| Find Confluence pages (plain words or CQL) | \`jirallm page:search "<words>" [--space KEY] --format tsv\`, then \`jirallm page <url>\` on a hit |
| List issues (compact) | \`jirallm search --org <org> '<JQL>' --fields key,summary,status,assignee --format tsv --all\` |
| Active sprint, by status | JQL \`project = PROJ AND sprint in openSprints() AND status = "To Do"\` |
| A board **column** (columns are not statuses) | \`jirallm boards --org <org>\` → \`jirallm board:issues --help\` |
| Valid transitions of an issue | \`jirallm transition PROJ-1 --list\` |
| Who am I / find a user | \`jirallm me --org <org>\`, \`jirallm users <query> --org <org>\` |
| Environment check | \`jirallm doctor\` |

Search tips: \`--fields\` takes friendly names (\`key,summary,status,assignee,sprint,parent\`) or raw ids (\`customfield_10050\`). \`--format tsv\` prints a header line and one line per issue; nested values collapse to their key or name. With \`--all\`, a "more results" note on stderr means the \`--max\` cap was hit.

jirallm or the Atlassian MCP server: use jirallm for ticket context (files on disk with images, attachments and linked pages, cheap to re-read), \`start\` and \`qa\`. If the Atlassian MCP tools are connected, they suit one-off questions, Rovo search across Jira and Confluence, and rarely used fields or link types. Don't fetch the same ticket through both.

## Write (changes Jira: confirm with the user first unless they asked for it)

| Action | Command |
|---|---|
| Start work: export + branch/worktree + assign me + In Progress | \`jirallm start PROJ-1 --repo <repo> --worktree-root <dir> [--type bugfix] [--dry-run]\` |
| Assign | \`jirallm assign PROJ-1 me\` (\`none\` unassigns) |
| Transition | \`jirallm transition PROJ-1 --to "Code Review"\` (positional status is an error) |
| Comment | \`jirallm comment PROJ-1 --help\` (markdown is converted) |
| Log work | \`jirallm worklog PROJ-1 "1h 30m"\` |

## Testing a ticket (tester workflow)

1. \`jirallm PROJ-1 --no-status-changes\`, then \`jirallm qa init PROJ-1 --env <url>\`: writes \`jira-export/proj-1/test-report.md\` with one test case (TC-01…) per acceptance-criteria scenario. Edit it to add steps, expected results and preconditions. Keep the table shape.
2. After running each case: \`jirallm qa result PROJ-1 TC-03 pass|fail|blocked --note "<observed>" --evidence shot.png resp.json\`. Evidence is copied next to the report and the Results line is recounted.
   Automated instead: run the Playwright tests with the JSON reporter, then \`jirallm qa import PROJ-1 <results.json> [--grep <describe or title>] [--layer "API (Playwright)"]\`. Each test becomes a case (re-runs update the same case, matched on title) with its \`test.step\` titles as steps, its verdict, the failure message as note, and its image attachments as evidence. Untouched placeholder cases are dropped. A test that covers acceptance-criteria cases names them with an annotation \`{ type: "qa-case", description: "GP-1, GP-5" }\` (case ids or the scenario label a title starts with): its result then goes on those cases, whose written steps are kept.
3. \`jirallm qa publish PROJ-1 --space <KEY> [--parent <pageId>] --dry-run\`, then run it without \`--dry-run\` (a **write**). It creates the page, or updates it on later runs, uploads the evidence and links the page from the issue.

People who prefer a screen use the same files through \`jirallm ui\`: pick a ticket, then **Test report** (edit cases, Pass/Fail/Blocked with pasted screenshots, Preview, Publish). A report title must be unique in the space; an existing page is never overwritten.

Every write command accepts \`--dry-run\`: use it when unsure. \`start\` runs git before touching Jira, so a failed worktree leaves the issue unchanged.

## Gotchas

- A board's "Ready to Dev" (or similar) is a column mapped to statuses, so a JQL on that name returns nothing. Use \`board:issues\`.
- \`openSprints()\` can cover several boards' sprints; narrow with \`sprint = "<name>"\` or a board query.
- Exports overwrite \`task.md\` and keep the previous copy as \`.task.previous.md\`, so diff the two to see what changed.

## Staying current

\`jirallm watch\` re-exports exported tickets and Confluence pages that changed since their local copy, plus open tickets assigned to me that are not exported yet, and appends one line per change to \`jira-export/CHANGES.md\` (e.g. \`ZOD-1: status: To Do → In Progress; Comments changed\`). \`jirallm changes\` prints them compactly (one line per ticket, latest state); \`--dry-run\` on \`watch\` only lists what would be re-exported. A session-start hook running \`jirallm changes --unseen\` puts new changes in context automatically. \`--install 15\` runs it every 15 minutes in the background (\`--uninstall\` removes it).
`;
export function runAgentGuide(opts) {
    if (!opts.install) {
        process.stdout.write(AGENT_GUIDE);
        return;
    }
    const root = typeof opts.install === 'string' ? opts.install : '.';
    const file = path.join(root, '.claude', 'skills', 'jirallm', 'SKILL.md');
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, AGENT_GUIDE);
    console.log(`✓ wrote ${file}`);
}
//# sourceMappingURL=agentGuide.js.map