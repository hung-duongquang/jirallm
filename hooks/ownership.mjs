// One owner per followed item. A ticket, PR, Actions run or Slack thread the user names in a session's
// prompt moves to that session: other running sessions stop following it and are told so (a change line
// "session/<their id>: …", which their monitor and next prompt deliver). What a session only picks up
// indirectly (the PRs and tickets a Slack thread it reads links to) is not taken from a running session
// that already follows it. Without this, two sessions worked on the same failed test: the user had moved
// the ticket to a new session, and the old one followed it again through a thread that linked its run.
import { appendFileSync, existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const SESSION_ID = /^[\w-]{1,100}$/;

const read = (file) => {
  try {
    return readFileSync(file, 'utf8').split('\n').map((l) => l.trim()).filter(Boolean);
  } catch {
    return [];
  }
};

/** Session ids whose monitor runs (started after boot, pid alive), other than `self`. */
export function otherRunningSessions(sessionsDir, self) {
  const boot = Date.now() - os.uptime() * 1000;
  const ids = [];
  let files = [];
  try {
    files = readdirSync(sessionsDir).filter((f) => f.endsWith('.monitor'));
  } catch {
    return ids;
  }
  for (const f of files) {
    const id = f.slice(0, -'.monitor'.length);
    if (id === self || !SESSION_ID.test(id)) continue;
    try {
      const file = path.join(sessionsDir, f);
      const pid = Number(readFileSync(file, 'utf8').trim());
      if (!(pid > 0) || statSync(file).mtimeMs < boot) continue;
      process.kill(pid, 0);
      ids.push(id);
    } catch {
      // Not running.
    }
  }
  return ids;
}

const norm = (s) => s.toLowerCase();

/** Items (follow items or ticket keys) another running session already has. */
export function ownedElsewhere(sessionsDir, self, items) {
  const owned = new Set();
  for (const id of otherRunningSessions(sessionsDir, self)) {
    for (const l of [...read(path.join(sessionsDir, `${id}.follow`)), ...read(path.join(sessionsDir, `${id}.keys`))]) owned.add(norm(l));
  }
  return new Set(items.filter((i) => owned.has(norm(i))));
}

const pad = (n) => String(n).padStart(2, '0');
const stamp = (d = new Date()) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;

/** "ZOD-1", "PR #12", "playwright#55", "run 44", "a Slack thread" for the hand-over line. */
const label = (item) =>
  /^slack\//i.test(item)
    ? 'a Slack thread'
    : /^confluence\//i.test(item)
      ? 'a Confluence page'
      : item.replace(/^pr\/(\d+)$/i, 'PR #$1').replace(/^pr\/[\w.-]+\/([\w.-]+)\/(\d+)$/i, '$1#$2').replace(/^run\/[\w.-]+\/[\w.-]+\/(\d+)$/i, 'run $1');

/**
 * Moves `items` (follow items) and `keys` (tickets) the user named in `self`'s prompt away from the other
 * running sessions. Each session that lost something gets one change line. Returns the ids it took from.
 */
export function takeOver(sessionsDir, outputDir, self, { items = [], keys = [] }) {
  const wanted = new Set([...items, ...keys].map(norm));
  // "slack/<dir>" takes the "and below" that came with it too.
  for (const i of items) if (/^slack\//i.test(i)) wanted.add(norm(`below/${i.slice(6)}`));
  if (!wanted.size) return [];
  const myTitle = read(path.join(sessionsDir, `${self}.title`))[0] ?? self.slice(0, 8);
  const lines = [];
  const from = [];
  for (const id of otherRunningSessions(sessionsDir, self)) {
    const taken = [];
    for (const ext of ['follow', 'keys']) {
      const file = path.join(sessionsDir, `${id}.${ext}`);
      if (!existsSync(file)) continue;
      const had = read(file);
      const keep = had.filter((l) => !wanted.has(norm(l)));
      if (keep.length === had.length) continue;
      taken.push(...had.filter((l) => wanted.has(norm(l)) && !/^below\//i.test(l)));
      writeFileSync(file, keep.join('\n'));
    }
    if (!taken.length) continue;
    from.push(id);
    const what = [...new Set(taken.map(label))].join(', ');
    lines.push(`- session/${id}: ${what} handed to session "${myTitle}" (${self.slice(0, 8)}), where the user named it; this session no longer follows it — leave that work to the other session`);
  }
  if (lines.length) {
    try {
      appendFileSync(path.join(outputDir, 'CHANGES.md'), `\n## ${stamp()}\n\n${lines.join('\n')}\n`);
    } catch {
      // The hand-over still happened; only the notice is lost.
    }
  }
  return from;
}
