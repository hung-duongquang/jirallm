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
import { changesMessage, jirallm, jirallmDetached, outputDir, refreshResumeTasks, unseenChanges } from './changes.mjs';

const sessionsDir = path.join(os.tmpdir(), 'jirallm-sessions');
const SLACK_URL = /https:\/\/[\w-]+\.slack\.com\/(?:archives|files)\/[^\s<>)"'\]]+/;
const ISSUE_KEY = /\b[A-Z][A-Z0-9]+-\d+\b/;
const MAX_TITLE = 80;
const MAX_STATE_KEYS = 3;

const PR_REF = /\/pull\/(\d+)\b|\b(?:PR|pull request)\s*#?(\d+)\b|(?:^|\s)#(\d{3,})\b/gi;

/**
 * Ticket keys of the PRs the prompt names (a PR link, "PR #3151", "#3151"), from the PR list
 * `jirallm watch --prs` keeps in .prs.json, so a session started from a PR link follows its ticket.
 */
function prTicketKeys(prompt) {
  const numbers = [...prompt.matchAll(PR_REF)].map((m) => m[1] ?? m[2] ?? m[3]);
  if (!numbers.length) return [];
  try {
    const prs = JSON.parse(readFileSync(path.join(outputDir, '.prs.json'), 'utf8')).prs ?? {};
    return numbers.map((n) => prs[n]?.key).filter((k) => typeof k === 'string' && ISSUE_KEY.test(k));
  } catch {
    return [];
  }
}

/** Keys in the prompt (or of the PRs it names) with a local ticket folder that this session has not had a card for yet. */
function newTicketKeys(prompt, sessionId) {
  if (!sessionId || !/^[\w-]+$/.test(sessionId)) return [];
  const keys = [...new Set([...(prompt.match(new RegExp(ISSUE_KEY, 'g')) ?? []), ...prTicketKeys(prompt)])].filter((k) =>
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

const SLACK_MESSAGE = /https:\/\/[\w-]+\.slack\.com\/archives\/([A-Z0-9]+)\/p(\d{16})[^\s<>)"'\]]*/gi;

/** A Confluence page link: …/wiki/spaces/<S>/pages/<id>/… or …/wiki/pages/viewpage.action?pageId=<id>. */
const CONFLUENCE_PAGE = /https:\/\/[\w.-]+\/wiki\/(?:spaces\/[^/\s]+\/pages\/(\d+)|pages\/viewpage\.action\?(?:[^\s#]*&)?pageId=(\d+))[^\s<>)"'\]]*/gi;

/**
 * Slack threads and Confluence pages linked in the prompt become things this session follows
 * (`<id>.follow`), so the monitor pushes their changes like changes to its tickets. `watch` only polls
 * exported threads and pages, so one with no export yet is exported in the background (the prompt does
 * not wait for it). A thread is named by its export folder: channel + thread start (thread_ts of a
 * reply link, else its own ts); a page by "confluence/<page id>" (its folder is "<id>-<slug>", which
 * the change line names, so the id prefix matches it).
 */
function followLinks(prompt, sessionId) {
  if (!sessionId || !/^[\w-]+$/.test(sessionId)) return;
  const file = path.join(sessionsDir, `${sessionId}.follow`);
  const followed = existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean) : [];
  const added = [];
  const links = [];
  for (const m of prompt.matchAll(SLACK_MESSAGE)) {
    const threadTs = /[?&]thread_ts=(\d+)\.(\d+)/.exec(m[0]);
    const item = `slack/${m[1].toLowerCase()}-${threadTs ? threadTs[1] + threadTs[2] : m[2]}`;
    links.push({ item, url: m[0], command: 'slack', exported: () => existsSync(path.join(outputDir, item)) });
  }
  for (const m of prompt.matchAll(CONFLUENCE_PAGE)) {
    const id = m[1] ?? m[2];
    const dir = path.join(outputDir, 'confluence');
    const exported = () => existsSync(dir) && readdirSync(dir).some((d) => d.startsWith(`${id}-`));
    links.push({ item: `confluence/${id}`, url: m[0], command: 'page', exported });
  }
  for (const { item, url, command, exported } of links) {
    if (followed.includes(item) || added.includes(item)) continue;
    added.push(item);
    if (!exported()) jirallmDetached([command, url, '--output-dir', outputDir]);
  }
  if (!added.length) return;
  mkdirSync(sessionsDir, { recursive: true });
  writeFileSync(file, [...followed, ...added].join('\n'));
}

/** Names the session in `jirallm ui` (Claude sessions): its Slack thread title, else its first prompt. */
function saveUiTitle(sessionId, text) {
  const line = text.replace(/\s+/g, ' ').trim();
  if (line) writeFileSync(path.join(sessionsDir, `${sessionId}.title`), line.length > MAX_TITLE ? `${line.slice(0, MAX_TITLE - 1)}…` : line);
}

let title = '';
try {
  const first = typeof input.prompt === 'string' && isFirstPrompt(input.session_id);
  if (first && SLACK_URL.test(input.prompt)) title = slackSessionTitle(input.prompt);
  if (first) saveUiTitle(input.session_id, title || input.prompt);
  // Now the session has a transcript and a title: its VS Code resume task can be written.
  if (first) refreshResumeTasks();
} catch {
  // A title is a bonus too.
}

try {
  if (typeof input.prompt === 'string') followLinks(input.prompt, input.session_id);
} catch {
  // Following is a bonus too.
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
