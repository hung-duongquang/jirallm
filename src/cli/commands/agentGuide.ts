import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/**
 * A guide written for LLM agents (Claude Code, Copilot, …) that drive jirallm from a shell:
 * which command answers which question, the cheapest output for each, and which commands write.
 */
export const AGENT_GUIDE = `---
name: jirallm
description: Read and update Jira and Confluence from the shell with jirallm. Use when a task mentions a Jira key (e.g. ZOD-1234), a sprint, a board column, or asks to assign, transition, comment or log work; to find, read or write a Confluence page (spec, test report); to write up a ticket's business or technical context, documentation or a how-to-test for testers or the team; to test a ticket; before opening a pull request for a ticket branch; or to check what changed in tickets or whether the local ticket context is current.
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
| Exact field values the markdown lacks or renders wrong (custom fields, link metadata, IDs) | \`jirallm fetch PROJ-1 --raw --fields <jira field ids>\` (e.g. \`issuelinks,customfield_10050\`); avoid bare \`--raw\`, it returns every field |
| One Confluence page by URL (e.g. a test report) | \`jirallm page <url>\` → \`jira-export/confluence/<id>-<slug>/page.md\` |
| Find Confluence pages (plain words or CQL) | \`jirallm page:search "<words>" [--space KEY] --format tsv\`, then \`jirallm page <url>\` on a hit |
| Child pages of a Confluence page (find where a new page goes) | \`jirallm page:children <id or url> --format tsv\` |
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
| Publish a markdown file as a Confluence page (create, then update) | \`jirallm page:publish <file.md> --space KEY --parent <id> --link PROJ-1 --dry-run\` |

## Documents for the team

Write-ups that testers or colleagues read (a ticket's business and technical context, how to test, a design note) belong in Confluence next to the ticket, not in a chat-only or private doc tool, unless the user asks for that tool:
1. Write the markdown to \`jira-export/<key>/context.md\` (\`# Title\` first; images next to it, linked relatively, become attachments; draw diagrams as images, since Confluence does not render mermaid).
2. Find the parent page: the user's choice, or \`page:search\` / \`page:children\` under the space's feature or sprint pages. Ask when unsure.
3. \`jirallm page:publish jira-export/<key>/context.md --space KEY --parent <id> --link <key> --dry-run\`, show the plan, and publish after the user confirms (a **write**). Later runs update the same page (the id is kept in \`.context.md.confluence.json\`); a page with the same title is never overwritten without \`--page\`.

## Before opening a PR

Run \`jirallm pr-context --repo <worktree>\` (key taken from the branch name) before \`gh pr create\`. It re-exports the ticket and prints what changed in Jira since work started (first branch commit): requirement and description edits as line diffs, new comments, status and assignee changes, plus the branch commits and diffstat. Then:
- tell the user about requirement changes or comments that the branch does not cover yet, before opening the PR;
- check the diff against the acceptance criteria in the re-exported \`task.md\`;
- write the PR description from it (what was built per acceptance criterion, anything left out and why).

## Testing a ticket (tester workflow)

1. \`jirallm PROJ-1 --no-status-changes\`, then \`jirallm qa init PROJ-1 --env <url> [--template api|matrix] [--api <endpoint>]\`: writes \`jira-export/proj-1/test-report.md\` with one test case (TC-01…) per acceptance-criteria scenario. Edit it to add steps, expected results and preconditions. Keep the table shape. Pick the layout by ticket: \`default\`; \`api\` for backend tickets driven by API calls or messages (a shared base message, a read-back section, and a Test Data column so each case lists only what it changes); \`matrix\` when the outcome depends on a combination such as insurer result × action (columns Situation, Action, Expected Result, Side effects, and an Also-check list for invariants).
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

export type AgentGuideOptions = { install?: string | boolean };

export function runAgentGuide(opts: AgentGuideOptions): void {
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
