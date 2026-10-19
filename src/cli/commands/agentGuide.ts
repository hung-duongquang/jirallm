import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/**
 * A guide written for LLM agents (Claude Code, Copilot, …) that drive jirallm from a shell:
 * which command answers which question, the cheapest output for each, and which commands write.
 */
export const AGENT_GUIDE = `---
name: jirallm
description: Read and update Jira (and linked Confluence pages) from the shell with jirallm. Use when a task mentions a Jira key (e.g. ZOD-1234), a sprint, a board column, or asks to assign, transition, comment or log work.
---

# jirallm for agents

Output switches to JSON when stdout is piped. Prefer the compact forms below: they cost far fewer tokens.

## Read (safe, no side effects)

| Need | Command |
|---|---|
| Full ticket as markdown (description, AC, comments, attachments, linked Confluence pages) | \`jirallm PROJ-1 --no-status-changes --output-dir ./jira-export\` then read \`jira-export/proj-1/task.md\` |
| Ticket plus its parent chain / linked issues | add \`--include-parent\` / \`--include-linked\` |
| Quick look, no files | \`jirallm fetch PROJ-1\` |
| List issues (compact) | \`jirallm search --org <org> '<JQL>' --fields key,summary,status,assignee --format tsv --all\` |
| Active sprint, by status | JQL \`project = PROJ AND sprint in openSprints() AND status = "To Do"\` |
| A board **column** (columns are not statuses) | \`jirallm boards --org <org>\` → \`jirallm board:issues --help\` |
| Valid transitions of an issue | \`jirallm transition PROJ-1 --list\` |
| Who am I / find a user | \`jirallm me --org <org>\`, \`jirallm users <query> --org <org>\` |
| Environment check | \`jirallm doctor\` |

Search tips: \`--fields\` takes friendly names (\`key,summary,status,assignee,sprint,parent\`) or raw ids (\`customfield_10050\`). \`--format tsv\` prints a header line and one line per issue; nested values collapse to their key or name. With \`--all\`, a "more results" note on stderr means the \`--max\` cap was hit.

## Write (changes Jira: confirm with the user first unless they asked for it)

| Action | Command |
|---|---|
| Start work: export + branch/worktree + assign me + In Progress | \`jirallm start PROJ-1 --repo <repo> --worktree-root <dir> [--type bugfix] [--dry-run]\` |
| Assign | \`jirallm assign PROJ-1 me\` (\`none\` unassigns) |
| Transition | \`jirallm transition PROJ-1 --to "Code Review"\` (positional status is an error) |
| Comment | \`jirallm comment PROJ-1 --help\` (markdown is converted) |
| Log work | \`jirallm worklog PROJ-1 "1h 30m"\` |

Every write command accepts \`--dry-run\`: use it when unsure. \`start\` runs git before touching Jira, so a failed worktree leaves the issue unchanged.

## Gotchas

- A board's "Ready to Dev" (or similar) is a column mapped to statuses, so a JQL on that name returns nothing. Use \`board:issues\`.
- \`openSprints()\` can cover several boards' sprints; narrow with \`sprint = "<name>"\` or a board query.
- Exports overwrite \`task.md\` and keep the previous copy as \`.task.previous.md\`, so diff the two to see what changed.
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
