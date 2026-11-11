// UserPromptSubmit hook of the jirallm Claude Code plugin. Three jobs, none ever blocks the prompt:
// 1. When the background `jirallm watch` logged something this session has not been given yet, the
//    unseen changes are added to the prompt's context, and the user sees a one-line "📥 jirallm: …"
//    message saying so. Each session keeps its own seen marker, so every open session gets every
//    change. Usually only two stat calls (no CLI start).
// 2. When the FIRST prompt of a session holds a Slack link, the session is named after the thread
//    ("ZOD-1234 first line of the thread · #channel") instead of the generic title Claude would
//    derive from a pasted thread, so sessions can be told apart in /resume. Costs one Slack fetch,
//    once per session.
// 3. The first time a prompt names a ticket key that has a local folder in jira-export, its state
//    card (`jirallm state --notes`: Jira status, my PRs, worktree, own files, notes) is added, once
//    per key per session, so ticket facts live with the ticket instead of in a memory index.
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { changesMessage, jirallm, outputDir, unseenChanges } from './changes.mjs';

const sessionsDir = path.join(os.tmpdir(), 'jirallm-sessions');
const SLACK_URL = /https:\/\/[\w-]+\.slack\.com\/(?:archives|files)\/[^\s<>)"'\]]+/;
const ISSUE_KEY = /\b[A-Z][A-Z0-9]+-\d+\b/;
const MAX_TITLE = 80;
const MAX_STATE_KEYS = 3;

/** Keys in the prompt with a local ticket folder that this session has not had a card for yet. */
function newTicketKeys(prompt, sessionId) {
  if (!sessionId || !/^[\w-]+$/.test(sessionId)) return [];
  const keys = [...new Set(prompt.match(new RegExp(ISSUE_KEY, 'g')) ?? [])].filter((k) =>
    existsSync(path.join(outputDir, k.toLowerCase()))
  );
  if (!keys.length) return [];
  mkdirSync(sessionsDir, { recursive: true });
  const marker = path.join(sessionsDir, `${sessionId}.keys`);
  const seen = existsSync(marker) ? readFileSync(marker, 'utf8').split('\n').filter(Boolean) : [];
  const fresh = keys.filter((k) => !seen.includes(k)).slice(0, MAX_STATE_KEYS);
  if (fresh.length) writeFileSync(marker, [...seen, ...fresh].join('\n'));
  return fresh;
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

let cards = '';
let cardKeys = [];
try {
  if (typeof input.prompt === 'string') {
    cardKeys = newTicketKeys(input.prompt, input.session_id);
    if (cardKeys.length) cards = jirallm(['state', ...cardKeys, '--notes', '--output-dir', outputDir], 10000);
  }
} catch {
  // The card is a bonus too.
}

const changes = unseenChanges(input.session_id, true);
const context = [cards && `jirallm ticket state (local):\n\n${cards}`, changes].filter(Boolean).join('\n\n');
const message = [changes && changesMessage(changes), cards && `🗂 jirallm: state of ${cardKeys.join(', ')} added`]
  .filter(Boolean)
  .join(' · ');
if (title || context) {
  process.stdout.write(
    JSON.stringify({
      ...(message && { systemMessage: message }),
      hookSpecificOutput: {
        hookEventName: 'UserPromptSubmit',
        ...(title && { sessionTitle: title }),
        ...(context && { additionalContext: context }),
      },
    })
  );
}
