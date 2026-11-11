// SessionStart hook of the jirallm Claude Code plugin. What it returns lands in Claude's context:
// the Jira/Confluence/Slack/PR changes `jirallm watch` logged since the last session (the user sees
// a one-line "📥 jirallm: …" message when there are any), this session's id, or a setup hint when
// the CLI is missing. It also pins this session's seen marker, so changes other sessions pick up
// later still reach this one, and leaves the handshake the plugin's background monitor
// (monitor.mjs) uses to learn this session's id.
// After a compaction (source "compact") it re-adds the state cards of the tickets this session had
// been given, which the summary may have reduced to a mention, and asks Claude to save decisions
// from the summary as ticket notes.
// It never fails the session.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { changesMessage, jirallm, outputDir, unseenChanges } from './changes.mjs';

const sessionsDir = path.join(os.tmpdir(), 'jirallm-sessions');
const SESSION_ID = /^[\w-]{1,100}$/;

let input = {};
try {
  input = JSON.parse(readFileSync(0, 'utf8') || '{}');
} catch {
  // No or bad stdin: no session id.
}
const session = typeof input.session_id === 'string' && SESSION_ID.test(input.session_id) ? input.session_id : '';

/** Keys whose state card this session was given (written by the prompt hook). */
function sessionKeys() {
  const file = path.join(sessionsDir, `${session}.keys`);
  return session && existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean) : [];
}

if (!jirallm(['--version'], 15000)) {
  console.log(
    'jirallm plugin: the jirallm CLI is not installed. Ask the user to run ' +
      '`npm install -g github:hung-duongquang/jirallm#release` and then `jirallm init` (their own Jira API token).'
  );
} else if (existsSync(outputDir)) {
  const changes = unseenChanges(session, false);
  const parts = [];
  if (changes) parts.push(changes);
  if (session) {
    try {
      mkdirSync(sessionsDir, { recursive: true });
      writeFileSync(path.join(sessionsDir, `${session}.start`), process.env.CLAUDE_PROJECT_DIR || process.cwd());
    } catch {
      // Without the handshake the monitor stays idle; the prompt hook still delivers changes.
    }
    parts.push(
      `jirallm session id: ${session}. The plugin's background monitor "jirallm-changes" delivers new changes ` +
        `(CI, reviews, Jira, Slack) as notifications during this session; if it is not running, ` +
        `\`jirallm changes --follow --session ${session} --output-dir "${outputDir}"\` under the Monitor tool does the same.`
    );
  }
  const keys = input.source === 'compact' ? sessionKeys() : [];
  if (keys.length) {
    const cards = jirallm(['state', ...keys, '--notes', '--output-dir', outputDir], 10000);
    if (cards) {
      parts.push(
        `Tickets this session worked on (state re-added after compaction):\n\n${cards}\n\n` +
          'If the summary above holds decisions about these tickets that their notes lack (settled review points, ' +
          'agreements, deploy env, who it waits on), save each as one line with `jirallm note <KEY> "<text>"` from the workspace root.'
      );
    }
  }
  const message = [changes && changesMessage(changes), keys.length && `🗂 jirallm: state of ${keys.join(', ')} re-added after compaction`]
    .filter(Boolean)
    .join(' · ');
  if (parts.length) {
    process.stdout.write(
      JSON.stringify({
        ...(message && { systemMessage: message }),
        hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: parts.join('\n\n') },
      })
    );
  }
}
