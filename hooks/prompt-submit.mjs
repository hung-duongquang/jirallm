// UserPromptSubmit hook of the jirallm Claude Code plugin. Two jobs, neither ever blocks the prompt:
// 1. When the background `jirallm watch` logged something since Claude last saw CHANGES.md, the
//    unseen changes are added to the prompt's context. Usually only two stat calls (no CLI start).
// 2. When the FIRST prompt of a session holds a Slack link, the session is named after the thread
//    ("ZOD-1234 first line of the thread · #channel") instead of the generic title Claude would
//    derive from a pasted thread, so sessions can be told apart in /resume. Costs one Slack fetch,
//    once per session.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const outputDir = path.join(process.env.CLAUDE_PROJECT_DIR || process.cwd(), 'jira-export');
const changes = path.join(outputDir, 'CHANGES.md');
const seen = path.join(outputDir, '.changes.seen');
const sessionsDir = path.join(os.tmpdir(), 'jirallm-sessions');
const SLACK_URL = /https:\/\/[\w-]+\.slack\.com\/(?:archives|files)\/[^\s<>)"'\]]+/;
const ISSUE_KEY = /\b[A-Z][A-Z0-9]+-\d+\b/;
const MAX_TITLE = 80;

function jirallm(args, timeout) {
  const r =
    process.platform === 'win32'
      ? spawnSync(['jirallm', ...args].map((a) => (/[\s"&|<>^]/.test(a) ? `"${a}"` : a)).join(' '), { encoding: 'utf8', shell: true, timeout })
      : spawnSync('jirallm', args, { encoding: 'utf8', timeout });
  return r.status === 0 ? r.stdout.trim() : '';
}

function unseenChanges() {
  try {
    if (existsSync(changes) && (!existsSync(seen) || statSync(changes).mtimeMs > statSync(seen).mtimeMs)) {
      return jirallm(['changes', '--unseen', '--output-dir', outputDir], 10000);
    }
  } catch {
    // Context is a bonus; never fail the prompt.
  }
  return '';
}

/** True only for the first prompt of this session (a marker file per session id; old ones are cleared). */
function isFirstPrompt(sessionId) {
  if (!sessionId || !/^[\w-]+$/.test(sessionId)) return false;
  mkdirSync(sessionsDir, { recursive: true });
  const marker = path.join(sessionsDir, sessionId);
  if (existsSync(marker)) return false;
  writeFileSync(marker, '');
  const cutoff = Date.now() - 30 * 24 * 3600 * 1000;
  for (const f of readdirSync(sessionsDir)) {
    try {
      if (statSync(path.join(sessionsDir, f)).mtimeMs < cutoff) unlinkSync(path.join(sessionsDir, f));
    } catch {
      // Another session may be clearing too.
    }
  }
  return true;
}

function slackSessionTitle(prompt) {
  const url = prompt.match(SLACK_URL)?.[0];
  if (!url) return '';
  const key = prompt.replace(new RegExp(SLACK_URL, 'g'), ' ').match(ISSUE_KEY)?.[0];
  let title = jirallm(['slack', url, '--title'], 10000).split('\n')[0] || 'Slack thread';
  if (key && !title.includes(key)) title = `${key} ${title}`;
  return title.length > MAX_TITLE ? `${title.slice(0, MAX_TITLE - 1)}…` : title;
}

let input = {};
try {
  input = JSON.parse(readFileSync(0, 'utf8') || '{}');
} catch {
  // No or bad stdin: still report changes.
}

let title = '';
try {
  if (typeof input.prompt === 'string' && SLACK_URL.test(input.prompt) && isFirstPrompt(input.session_id)) {
    title = slackSessionTitle(input.prompt);
  } else if (input.session_id) {
    isFirstPrompt(input.session_id);
  }
} catch {
  // A title is a bonus too.
}

const context = unseenChanges();
if (title) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: { hookEventName: 'UserPromptSubmit', sessionTitle: title, ...(context && { additionalContext: context }) },
    })
  );
} else if (context) {
  process.stdout.write(context);
}
