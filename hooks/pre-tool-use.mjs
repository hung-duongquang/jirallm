// PreToolUse hook of the jirallm Claude Code plugin (Bash/PowerShell). Commands that change Jira,
// Confluence, SharePoint or a GitHub PR other people see (transition, comment, worklog, review,
// merge, …) get Claude Code's permission prompt with a short reason, so the "confirm writes with the
// user" rule is enforced by the harness instead of resting on Claude remembering it. Dry runs, help
// and listing variants pass. Set JIRALLM_CONFIRM_WRITES=0 to turn it off. Never blocks on an error.
import { readFileSync } from 'node:fs';

/** [pattern, what it does]; checked per command segment (split on ;, &&, ||, |). */
export const WRITES = [
  [/\bjirallm\s+(transition|comment|worklog|assign|edit|create|link|attach|watchers?:add)\b/, 'changes the Jira ticket'],
  [/\bjirallm\s+start\b/, 'assigns the ticket and moves it to In Progress'],
  [/\bjirallm\s+(page:publish|qa\s+publish)\b/, 'publishes to Confluence'],
  [/\bjirallm\s+sharepoint:edit\b/, 'saves to a shared SharePoint document'],
  [/\bgh\s+pr\s+(review|merge|close|reopen|ready|comment|edit)\b/, 'changes the GitHub PR'],
  [/\bgh\s+stack\s+merge\b/, 'merges the PR stack'],
  [/\bgh\s+issue\s+(comment|close|edit|create)\b/, 'changes a GitHub issue'],
  [/\bgh\s+api\b(?=.*(-X|--method)\s*(POST|PATCH|PUT|DELETE)\b)(?=.*\/(pulls|issues|comments|reviews)\b)/i, 'writes to GitHub through the API'],
  [/\bgh\s+api\s+graphql\b(?=.*\bmutation\b)/, 'runs a GitHub GraphQL mutation'],
];
const SAFE = /--dry-run\b|--help\b|\s-h\b|\btransition\b.*--list\b/;

/** What the command writes, or '' when it only reads. */
export function writeReason(command) {
  const reasons = [];
  for (const segment of command.split(/;|&&|\|\||\|/)) {
    if (SAFE.test(segment)) continue;
    for (const [re, what] of WRITES) if (re.test(segment) && !reasons.includes(what)) reasons.push(what);
  }
  return reasons.join(', ');
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop())) {
  try {
    if (process.env.JIRALLM_CONFIRM_WRITES === '0') process.exit(0);
    const input = JSON.parse(readFileSync(0, 'utf8') || '{}');
    const command = input.tool_input?.command;
    const reason = typeof command === 'string' ? writeReason(command) : '';
    if (reason) {
      process.stdout.write(
        JSON.stringify({
          hookSpecificOutput: {
            hookEventName: 'PreToolUse',
            permissionDecision: 'ask',
            permissionDecisionReason: `jirallm: this ${reason}, which other people see. Allow it?`,
          },
        })
      );
    }
  } catch {
    // Unknown input: let the normal permission rules decide.
  }
}
