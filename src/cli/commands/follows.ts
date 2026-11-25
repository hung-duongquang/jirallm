// What a session follows (`<session>.follow` in jirallm-sessions) ends when the thing is finished, or
// when the user says so. A PR that merged or closed, an Actions run that completed and an "and below"
// window that went quiet are dropped from every session's follows RETIRE_AFTER_MS after watch first saw
// them finished: long enough for the running sessions to get that last change line, which is matched
// against the follows. `jirallm unfollow` drops items at once: a link pasted only to discuss it, a
// thread whose topic moved on.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { prItems } from './repoPrWatch.js';
import { runItems } from './runWatch.js';

export const RETIRE_AFTER_MS = 3600_000;
const RETIRED_FILE = '.retired.json';
const defaultSessionsDir = () => path.join(os.tmpdir(), 'jirallm-sessions');

const readJson = <T>(file: string): T | undefined => {
  try {
    return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as T) : undefined;
  } catch {
    return undefined;
  }
};

/** Follow items whose PR, run or "below" window is finished, from watch's state files in `outputDir`. */
export function finishedItems(outputDir: string): string[] {
  const items: string[] = [];
  const prs = readJson<{ meta?: { repo?: string }; finished?: Record<string, string> }>(path.join(outputDir, '.prs.json'));
  for (const n of Object.keys(prs?.finished ?? {})) {
    items.push(`pr/${n}`);
    if (prs?.meta?.repo) items.push(`pr/${prs.meta.repo}/${n}`);
  }
  const repoPrs = readJson<Record<string, { state?: string }>>(path.join(outputDir, '.repo-prs.json')) ?? {};
  for (const [item, s] of Object.entries(repoPrs)) if (s.state && s.state !== 'OPEN') items.push(item);
  const runs = readJson<Record<string, { status?: string }>>(path.join(outputDir, '.runs.json')) ?? {};
  for (const [item, s] of Object.entries(runs)) if (s.status === 'completed') items.push(item);
  const below = readJson<Record<string, { closed?: boolean }>>(path.join(outputDir, '.slack-below.json')) ?? {};
  for (const [dir, s] of Object.entries(below)) if (s.closed) items.push(`below/${dir}`);
  return items.map((i) => i.toLowerCase());
}

/** Removes `items` (lower case) from a session's .follow; returns the items it removed. */
function removeFollows(file: string, items: Set<string>): string[] {
  const lines = readFileSync(file, 'utf8').split(/\r?\n/).filter((l) => l.trim());
  const keep = lines.filter((l) => !items.has(l.trim().toLowerCase()));
  if (keep.length !== lines.length) writeFileSync(file, keep.join('\n'));
  return lines.filter((l) => items.has(l.trim().toLowerCase())).map((l) => l.trim());
}

/**
 * Drops finished items from all sessions' follows once they have been finished for RETIRE_AFTER_MS
 * (first seen finished: .retired.json in the sessions folder). Returns "<session>: <item>" per removal.
 */
export function retireFollows(finished: string[], sessionsDir = defaultSessionsDir(), now = Date.now()): string[] {
  if (!existsSync(sessionsDir)) return [];
  const file = path.join(sessionsDir, RETIRED_FILE);
  const seen = readJson<Record<string, number>>(file) ?? {};
  const next: Record<string, number> = {};
  for (const item of finished) next[item] = seen[item] ?? now;
  const due = new Set(Object.keys(next).filter((i) => now - next[i]! >= RETIRE_AFTER_MS));
  const removed: string[] = [];
  if (due.size) {
    for (const f of readdirSync(sessionsDir)) {
      if (!f.endsWith('.follow')) continue;
      for (const item of removeFollows(path.join(sessionsDir, f), due)) removed.push(`${f.slice(0, -'.follow'.length)}: ${item}`);
    }
  }
  if (JSON.stringify(next) !== JSON.stringify(seen)) writeFileSync(file, JSON.stringify(next, null, 1));
  return removed;
}

/**
 * The follow items a user's words name: a Slack message link (its thread and the channel below it),
 * a PR or Actions run link, "PR #12" / "#12", or an item as `jirallm unfollow --list` shows it.
 */
export function itemsNamed(target: string): string[] {
  const slack = /slack\.com\/archives\/([A-Z0-9]+)\/p(\d{16})/i.exec(target);
  if (slack) {
    // A reply link names its thread by thread_ts, as the prompt hook followed it.
    const thread = /[?&]thread_ts=(\d+)\.(\d+)/.exec(target);
    const dir = `${slack[1]!.toLowerCase()}-${thread ? thread[1] + thread[2] : slack[2]}`;
    return [`slack/${dir}`, `below/${dir}`];
  }
  const links = [...prItems(target), ...runItems(target)];
  if (links.length) return links;
  const pr = /^(?:pr\s*)?#?(\d+)$/i.exec(target.trim());
  if (pr) return [`pr/${pr[1]}`, `pr/*/${pr[1]}`];
  return [target.trim()];
}

/** Drops what `targets` name from the session's follows; returns what it removed and what is left. */
export function unfollow(session: string, targets: string[], sessionsDir = defaultSessionsDir()): { removed: string[]; left: string[] } {
  const file = path.join(sessionsDir, `${session}.follow`);
  if (!existsSync(file)) return { removed: [], left: [] };
  const lines = readFileSync(file, 'utf8').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const named = targets.flatMap(itemsNamed).map((i) => i.toLowerCase());
  const matches = (line: string) =>
    named.some((n) => {
      const l = line.toLowerCase();
      // "PR #12" names that PR in any repo: pr/12 and pr/<owner>/<repo>/12.
      if (n.startsWith('pr/*/')) return new RegExp(`^pr/(?:[\\w.-]+/[\\w.-]+/)?${n.slice(5)}$`).test(l);
      // "slack/<dir>" also ends the "and below" that came with it.
      return l === n || (n.startsWith('slack/') && l === `below/${n.slice(6)}`);
    });
  const removed = lines.filter(matches);
  const left = lines.filter((l) => !matches(l));
  if (removed.length) writeFileSync(file, left.join('\n'));
  return { removed, left };
}

export function followList(session: string, sessionsDir = defaultSessionsDir()): string[] {
  const file = path.join(sessionsDir, `${session}.follow`);
  return existsSync(file) ? readFileSync(file, 'utf8').split(/\r?\n/).map((l) => l.trim()).filter(Boolean) : [];
}

/**
 * The follow items `follow` adds for a target: a Slack link is its thread only (`below/<dir>` names the
 * channel below explicitly), "PR #12" the PR in the workspace repo, a PR or run link that one.
 */
export function itemsToFollow(target: string): string[] {
  const named = itemsNamed(target);
  if (named[0]?.startsWith('slack/')) return [named[0]];
  if (named[0]?.startsWith('pr/') && named[1]?.startsWith('pr/*/')) return [named[0]];
  return named.filter((i) => /^(slack|below|pr|run|confluence)\/[\w./-]+$/i.test(i));
}

/** Adds items to the session's follows; returns those that were new. */
export function follow(session: string, items: string[], sessionsDir = defaultSessionsDir()): string[] {
  const lines = followList(session, sessionsDir);
  const known = new Set(lines.map((l) => l.toLowerCase()));
  const added = [...new Set(items)].filter((i) => !known.has(i.toLowerCase()));
  if (added.length) {
    mkdirSync(sessionsDir, { recursive: true });
    writeFileSync(path.join(sessionsDir, `${session}.follow`), [...lines, ...added].join('\n'));
  }
  return added;
}

/**
 * `jirallm follow <targets...>`: Claude follows something itself, e.g. the one thread below a link that
 * is still on its topic before `unfollow below/<dir>`. A Slack thread not exported yet is exported first,
 * as watch reports replies from the export.
 */
export async function runFollow(targets: string[], opts: { session?: string; outputDir?: string }, sessionsDir = defaultSessionsDir()): Promise<void> {
  const session = opts.session ?? process.env.CLAUDE_CODE_SESSION_ID;
  if (!session) {
    console.error('No session: pass --session <id> (inside Claude Code, $CLAUDE_CODE_SESSION_ID names it).');
    process.exitCode = 1;
    return;
  }
  const outputDir = path.resolve(opts.outputDir ?? 'jira-export');
  const items: string[] = [];
  for (const target of targets) {
    const found = itemsToFollow(target);
    if (!found.length) {
      console.error(`Not something to follow: ${target} (a Slack, PR or Actions run link, "PR #12", or an item as \`jirallm unfollow --list\` shows it)`);
      process.exitCode = 1;
      continue;
    }
    for (const item of found) {
      if (item.startsWith('slack/') && /slack\.com\/archives\//i.test(target) && !existsSync(path.join(outputDir, item, 'thread.md'))) {
        // The export names the thread by its first message, also for a link to a reply.
        const { exportSlackThread } = await import('../../lib/slack.js');
        const exported = await exportSlackThread(target, { outputDir });
        items.push(`slack/${exported.dirName}`);
      } else items.push(item);
    }
  }
  const added = follow(session, items, sessionsDir);
  console.log(added.length ? `Now followed: ${added.join(', ')}` : `Already followed: ${items.join(', ') || 'nothing'}`);
}

/** `jirallm unfollow [targets...] [--session <id>] [--list]`. */
export function runUnfollow(targets: string[], opts: { session?: string; list?: boolean }, sessionsDir = defaultSessionsDir()): void {
  const session = opts.session ?? process.env.CLAUDE_CODE_SESSION_ID;
  if (!session) {
    console.error('No session: pass --session <id> (inside Claude Code, $CLAUDE_CODE_SESSION_ID names it).');
    process.exitCode = 1;
    return;
  }
  if (opts.list || !targets.length) {
    const items = followList(session, sessionsDir);
    console.log(items.length ? `Session ${session} follows:\n${items.map((i) => `  ${i}`).join('\n')}` : `Session ${session} follows nothing.`);
    return;
  }
  const { removed, left } = unfollow(session, targets, sessionsDir);
  if (!removed.length) {
    console.log(`Nothing of that is followed by session ${session}. It follows: ${left.join(', ') || 'nothing'}`);
    return;
  }
  console.log(`No longer followed: ${removed.join(', ')}${left.length ? `\nStill followed: ${left.join(', ')}` : ''}`);
}
