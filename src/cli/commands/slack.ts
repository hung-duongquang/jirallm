import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { intro, outro, password, isCancel, cancel } from '@clack/prompts';
import { removeSecret, setSecret } from '../../lib/credentials.js';
import {
  SLACK_COOKIE_ACCOUNT,
  SLACK_NOT_SET_UP,
  SLACK_TOKEN_ACCOUNT,
  SlackClient,
  exportSlackThread,
  hasSlackToken,
  loadSlackAuth,
  loadSlackThread,
  formatTs,
  mentionedUsers,
  parseSince,
  refreshSlackExport,
  renderThread,
  type LoadedThread,
  searchHits,
  slackMessageUrl,
  slackSearchQueries,
  threadTitle,
} from '../../lib/slack.js';
import { printJson } from '../jsonOutput.js';
import { prItems } from './repoPrWatch.js';
import { runItems } from './runWatch.js';
import { readTask } from './state.js';
import { logChanges } from './watch.js';

export type SlackOptions = {
  outputDir?: string;
  files?: boolean;
  /** false (--no-channel): leave out channel messages posted outside the thread. */
  channel?: boolean;
  /** false (--no-frames): keep videos but skip extracting their frames. */
  frames?: boolean;
  json?: boolean;
  /** Only print replies after this day/time/ts (the parent is always printed). */
  since?: string;
  /** Print only `<thread title> · #channel` (the plugin's prompt hook names Claude Code sessions with it). */
  title?: boolean;
  /** Print only the message link (a file link resolved to the message sharing the file), for the prompt hook. */
  link?: boolean;
  /** Claude Code session that reads the thread (default: $CLAUDE_CODE_SESSION_ID): it follows the PRs and tickets the thread names. */
  session?: string;
};

/**
 * One line naming the thread, most telling part first: `<first line of its first message> · #channel`.
 * A group DM's channel name lists everyone (mpdm-a--b--c-1), which only pushes the title out of sight.
 */
export function slackTitleLine(channelName: string | undefined, title: string): string {
  const where = !channelName
    ? ''
    : channelName === 'direct message'
      ? ' · DM'
      : channelName.startsWith('mpdm-')
        ? ' · group DM'
        : ` · #${channelName}`;
  return `${title}${where}`;
}

const TICKET_LINK = /^(?:https?:\/\/)?[\w.-]+\/browse\/([A-Z][A-Z0-9]+-\d+)\S*$/;

/**
 * A thread that opens with nothing but a ticket link is named after the ticket: "ZOD-4243 <summary>"
 * from its export when there is one, else "ZOD-4243". Otherwise two such threads both read
 * "topicushealthcare.atlassian.net/browse/…" in /resume.
 */
export function ticketThreadTitle(title: string, outputDir: string | undefined): string {
  const key = TICKET_LINK.exec(title)?.[1];
  if (!key) return title;
  const summary = outputDir ? readTask(path.join(outputDir, key.toLowerCase(), 'task.md'))?.title : undefined;
  return summary ? `${key} ${summary}` : key;
}

/**
 * Prints a Slack message with its whole thread as Markdown, or with --output-dir writes
 * <dir>/slack/<channel>-<ts>/thread.md and downloads the thread's files next to it.
 */
export async function runSlack(url: string, opts: SlackOptions): Promise<void> {
  if (opts.link) {
    const client = new SlackClient(await loadSlackAuth());
    console.log(slackMessageUrl(await client.resolveLink(url)));
    return;
  }
  if (opts.title) {
    const { channelName, messages, names } = await loadSlackThread(url, undefined, { channel: false });
    const title = ticketThreadTitle(threadTitle(messages, names), opts.outputDir ?? workspaceOutputDir());
    console.log(slackTitleLine(channelName, title));
    return;
  }
  const session = opts.session ?? process.env.CLAUDE_CODE_SESSION_ID;
  if (opts.outputDir && !opts.json) {
    const loaded = await loadSlackThread(url, undefined, { channel: opts.channel });
    const thread = await exportSlackThread(url, { outputDir: opts.outputDir, files: opts.files, channel: opts.channel, frames: opts.frames, loaded });
    followThreadRefs(loaded.messages.map((m) => m.text ?? ''), opts.outputDir, session);
    for (const err of thread.fileErrors) console.error(`# ${err}`);
    console.log(thread.path);
    return;
  }
  const loaded = await loadSlackThread(url, undefined, { channel: opts.channel });
  const { link, url: messageUrl, channelName, messages, channelMessages, names } = loaded;
  followThreadRefs(messages.map((m) => m.text ?? ''), workspaceOutputDir(session), session);
  if (opts.json) {
    printJson({ link, channelName, users: Object.fromEntries(names), messages, channelMessages });
  } else {
    const since = opts.since ? parseSince(opts.since) : undefined;
    process.stdout.write(renderThread({ url: messageUrl, channelName, messages, channelMessages, linkedTs: link.ts, names, since }));
  }
  await refreshAfterRead(loaded, opts.channel);
}

const SESSION_ID = /^[\w-]{1,100}$/;
const MAX_THREAD_KEYS = 3;

/**
 * A Slack thread given to a session often only points at the work ("resolve the comments in this PR"
 * with the PR link in the message), and a prompt that is just the thread's link names neither. The
 * session then follows the PRs linked in the thread's messages and the tickets they name (of projects
 * with exported tickets, at most 3 new ones), as if the prompt had named them, so their CI, reviews and
 * Jira changes reach it. Channel messages outside the thread are left out: they can be unrelated.
 */
export function followThreadRefs(
  texts: string[],
  outputDir: string | undefined,
  session: string | undefined,
  sessionsDir = path.join(os.tmpdir(), 'jirallm-sessions')
): void {
  if (!session || !SESSION_ID.test(session)) return;
  const text = texts.join('\n');
  const prs = [...prItems(text), ...runItems(text)];
  let projects = new Set<string>();
  try {
    if (outputDir) projects = new Set(readdirSync(outputDir).map((f) => /^([a-z][a-z0-9]*)-\d+$/.exec(f)?.[1]).filter((p): p is string => !!p));
  } catch {
    // No export folder: no keys.
  }
  const keys = [...new Set(text.match(/\b[A-Z][A-Z0-9]+-\d+\b/g) ?? [])].filter((k) => projects.has(k.split('-')[0]!.toLowerCase()));
  const add = (file: string, items: string[], max = Infinity) => {
    if (!items.length) return;
    const p = path.join(sessionsDir, `${session}.${file}`);
    const had = existsSync(p) ? readFileSync(p, 'utf8').split('\n').filter(Boolean) : [];
    const fresh = items.filter((i) => !had.includes(i)).slice(0, max);
    if (fresh.length) {
      mkdirSync(sessionsDir, { recursive: true });
      writeFileSync(p, [...had, ...fresh].join('\n'));
    }
  };
  try {
    // A thread only links to these: leave them to a running session that already follows them
    // (one owner per item, as hooks/ownership.mjs keeps it).
    const owned = ownedByOtherRunning(sessionsDir, session);
    add('follow', prs.filter((p) => !owned.has(p.toLowerCase())));
    add('keys', keys.filter((k) => !owned.has(k.toLowerCase())), MAX_THREAD_KEYS);
  } catch {
    // Following is a bonus.
  }
}

/** Follow items and ticket keys (lower case) of the running Claude sessions other than `self`. */
export function ownedByOtherRunning(sessionsDir: string, self: string, boot = Date.now() - os.uptime() * 1000): Set<string> {
  const owned = new Set<string>();
  let files: string[];
  try {
    files = readdirSync(sessionsDir).filter((f) => f.endsWith('.monitor'));
  } catch {
    return owned;
  }
  for (const f of files) {
    const id = f.slice(0, -'.monitor'.length);
    if (id === self) continue;
    try {
      const file = path.join(sessionsDir, f);
      const pid = Number(readFileSync(file, 'utf8').trim());
      if (!(pid > 0) || statSync(file).mtimeMs < boot) continue;
      process.kill(pid, 0);
    } catch {
      continue;
    }
    for (const ext of ['follow', 'keys']) {
      try {
        for (const l of readFileSync(path.join(sessionsDir, `${id}.${ext}`), 'utf8').split('\n')) if (l.trim()) owned.add(l.trim().toLowerCase());
      } catch {
        // None.
      }
    }
  }
  return owned;
}

/**
 * The workspace's export folder: the project of this Claude Code session (its handshake in
 * jirallm-sessions holds the project dir, also when Claude works in a worktree elsewhere), else the
 * nearest `jira-export` above the current directory.
 */
export function workspaceOutputDir(
  session = process.env.CLAUDE_CODE_SESSION_ID,
  cwd = process.cwd(),
  sessionsDir = path.join(os.tmpdir(), 'jirallm-sessions')
): string | undefined {
  if (session && SESSION_ID.test(session)) {
    try {
      const project = readFileSync(path.join(sessionsDir, `${session}.start`), 'utf8').split('\n')[0]!.trim();
      if (project && existsSync(path.join(project, 'jira-export'))) return path.join(project, 'jira-export');
    } catch {
      // No handshake: look around the current directory.
    }
  }
  for (let dir = path.resolve(cwd); ; dir = path.dirname(dir)) {
    if (existsSync(path.join(dir, 'jira-export'))) return path.join(dir, 'jira-export');
    if (path.dirname(dir) === dir) return undefined;
  }
}

/**
 * After reading a thread that is exported (so `watch` follows it) and got new replies: brings the
 * export up to date and logs the change as `watch` would, so other sessions following the thread still
 * get it, but marks it read for the session that read it (CLAUDE_CODE_SESSION_ID): its monitor does
 * not hand it the replies it just read. A thread that was never exported is left alone.
 */
export async function refreshAfterRead(
  loaded: LoadedThread & { client: SlackClient },
  channel: boolean | undefined,
  outputDir = workspaceOutputDir(),
  session = process.env.CLAUDE_CODE_SESSION_ID
): Promise<void> {
  if (!outputDir) return;
  try {
    const exported = await refreshSlackExport(loaded, outputDir, channel);
    if (!exported) return;
    const n = exported.newReplies;
    const line = `slack/${exported.dirName}: ${n} new repl${n === 1 ? 'y' : 'ies'} in "${exported.title}"`;
    logChanges(outputDir, [line], session && SESSION_ID.test(session) ? session : undefined);
    console.error(`# Export updated (${exported.path}): these replies will not come back to this session as a change.`);
  } catch (err) {
    console.error(`# Export not updated: ${String(err instanceof Error ? err.message : err).split('\n')[0]}`);
  }
}

export type SlackSearchOptions = {
  after?: string;
  max?: string;
  json?: boolean;
  /** false (--no-threads): skip looking up each hit thread's reply count and newest reply. */
  threads?: boolean;
};

/**
 * Searches Slack messages and prints one TSV row per thread (newest match): date, channel, author,
 * matches in the thread, text, permalink. Open a hit with `jirallm slack <url>`.
 */
export async function runSlackSearch(query: string, opts: SlackSearchOptions): Promise<void> {
  const max = opts.max ? Number(opts.max) : 20;
  if (!Number.isInteger(max) || max < 1 || max > 500) throw new Error(`--max needs a number from 1 to 500, got: ${opts.max}`);
  const queries = slackSearchQueries(query, opts.after);
  if (queries.length === 0) throw new Error('Empty search query.');
  const q = queries.join(' | ');
  // Slack is optional: without a token this is not an error, just nothing to search.
  if (!(await hasSlackToken())) {
    if (opts.json) printJson({ skipped: SLACK_NOT_SET_UP, matches: [] });
    else console.log(SLACK_NOT_SET_UP);
    return;
  }
  const client = new SlackClient(await loadSlackAuth());
  const { total, matches } = await client.searchAny(queries, max);

  const ids = new Set<string>();
  for (const m of matches) {
    if (m.user) ids.add(m.user);
    for (const id of mentionedUsers(m.text ?? '')) ids.add(id);
  }
  const names = new Map<string, string>();
  for (const id of ids) names.set(id, await client.userName(id));
  const hits = searchHits(matches, names);
  // Replies rarely repeat the key, so a thread's newest activity is shown even when it did not match.
  if (opts.threads !== false) {
    for (const h of hits.slice(0, MAX_THREAD_INFO)) {
      if (!h.channelId || !h.threadTs) continue;
      try {
        const info = await client.threadInfo(h.channelId, h.threadTs);
        h.replies = info.replies;
        h.lastReply = info.latestReply;
      } catch {
        // Thread info is a bonus (e.g. a DM the token cannot read).
      }
    }
  }

  if (opts.json) {
    printJson({ query: q, total, hits });
    return;
  }
  console.error(`# ${q}: ${total} message(s)${total > matches.length ? `, showing the newest ${matches.length}` : ''}, ${hits.length} thread(s)`);
  if (hits.length === 0) return;
  console.log(['date', 'channel', 'author', 'matches', 'replies', 'last reply', 'text', 'url'].join('\t'));
  for (const h of hits) {
    const replies = h.replies === undefined ? '' : String(h.replies);
    const last = h.lastReply ? formatTs(h.lastReply) : '';
    console.log([h.date, h.channel, h.author, String(h.more + 1), replies, last, h.text.replace(/\t/g, ' '), h.url].join('\t'));
  }
}

/** Threads whose reply count is looked up (one conversations.replies call each). */
const MAX_THREAD_INFO = 25;

export async function runSlackAuth(opts: { remove?: boolean; check?: boolean }): Promise<void> {
  if (opts.remove) {
    const a = await removeSecret(SLACK_TOKEN_ACCOUNT);
    const b = await removeSecret(SLACK_COOKIE_ACCOUNT);
    console.log(a || b ? 'Removed the Slack token.' : 'No Slack token stored.');
    return;
  }
  if (!opts.check) {
    intro('jirallm slack:auth');
    const token = await password({
      message:
        'Slack token (xoxp- user token from a Slack app with channels:history, groups:history, im:history, mpim:history, users:read, search:read; or an xoxc- browser token)',
      validate: (v) => (/^xox[pcb]-/.test(v ?? '') ? undefined : 'Expected a token starting with xoxp-, xoxb- or xoxc-'),
    });
    if (isCancel(token)) {
      cancel('Cancelled.');
      return;
    }
    await setSecret(SLACK_TOKEN_ACCOUNT, token);
    if (token.startsWith('xoxc-')) {
      const cookie = await password({
        message: 'Value of the "d" cookie (starts with xoxd-) from the same browser session',
        validate: (v) => (v ? undefined : 'Required for an xoxc- token'),
      });
      if (isCancel(cookie)) {
        cancel('Cancelled.');
        return;
      }
      await setSecret(SLACK_COOKIE_ACCOUNT, cookie);
    } else {
      await removeSecret(SLACK_COOKIE_ACCOUNT);
    }
    outro('Stored in the OS keychain.');
  }
  const res = await new SlackClient(await loadSlackAuth()).call<{ url?: string; user?: string; team?: string }>('auth.test', {});
  console.log(`Slack OK: ${res.user} on ${res.team} (${res.url})`);
}

