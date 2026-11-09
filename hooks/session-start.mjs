// SessionStart hook of the jirallm Claude Code plugin. What it returns lands in Claude's context:
// the Jira/Confluence/Slack/PR changes `jirallm watch` logged since the last session (the user sees
// a one-line "📥 jirallm: …" message when there are any), this session's id for
// `jirallm changes --follow --session <id>`, or a setup hint when the CLI is missing. It also pins
// this session's seen marker, so changes other sessions pick up later still reach this one.
// It never fails the session.
import { existsSync, readFileSync } from 'node:fs';
import { changesMessage, jirallm, outputDir, unseenChanges } from './changes.mjs';

let input = {};
try {
  input = JSON.parse(readFileSync(0, 'utf8') || '{}');
} catch {
  // No or bad stdin: no session id.
}

if (!jirallm(['--version'], 15000)) {
  console.log(
    'jirallm plugin: the jirallm CLI is not installed. Ask the user to run ' +
      '`npm install -g github:hung-duongquang/jirallm#release` and then `jirallm init` (their own Jira API token).'
  );
} else if (existsSync(outputDir)) {
  const changes = unseenChanges(input.session_id, false);
  const parts = [];
  if (changes) parts.push(changes);
  if (input.session_id) {
    parts.push(
      `jirallm session id: ${input.session_id} (to follow changes mid-session, run ` +
        `\`jirallm changes --follow --session ${input.session_id} --output-dir "${outputDir}"\` under the Monitor tool).`
    );
  }
  const message = changes ? changesMessage(changes) : '';
  if (parts.length) {
    process.stdout.write(
      JSON.stringify({
        ...(message && { systemMessage: message }),
        hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: parts.join('\n\n') },
      })
    );
  }
}
