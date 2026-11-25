// "<Slack link> and below": the conversation goes on in the channel after the linked message, not only
// in its thread (a DM or group DM mostly), and people move parts of it into the thread of a message in
// between. A session given such a link follows `below/<channel>-<ts>` besides `slack/<channel>-<ts>`.
// `watch` then reads the channel after the message every run, up to the first quiet gap of
// BELOW_GAP_HOURS (a conversation that went quiet has ended, next morning's messages are another one),
// including the threads branching off messages in that window, writes them to slack/<dir>/below.md and
// logs "N new below …". Whether a message is still on the topic is for Claude to judge: the change line
// says it may be another topic. After the gap the window is closed and no longer read.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { downloadSlackFiles, formatTs, mentionedUsers, messageBodyLines, SlackClient, threadFrontmatter, type SlackMessage } from '../../lib/slack.js';
import { isRunning } from './resume.js';

export const BELOW_GAP_HOURS = 3;
/** Top-level messages below the link that still count as its conversation (replies in their threads keep coming). */
export const BELOW_MAX_MESSAGES = 6;
const BELOW_STATE = '.slack-below.json';
const MAX_HISTORY = 200;
const MAX_BRANCHES = 10;

type BelowState = Record<string, { newest: string; closed?: boolean }>;
type Change = { line: string; url?: string; error?: boolean };

/** Export folders (`<channel>-<ts>`) whose channel below running sessions follow (`below/<dir>` in .follow). */
export function followedBelow(sessionsDir = path.join(os.tmpdir(), 'jirallm-sessions')): Set<string> {
  const dirs = new Set<string>();
  if (!existsSync(sessionsDir)) return dirs;
  for (const f of readdirSync(sessionsDir)) {
    if (!f.endsWith('.follow') || !isRunning(f.slice(0, -'.follow'.length), sessionsDir)) continue;
    for (const l of readFileSync(path.join(sessionsDir, f), 'utf8').split(/\r?\n/)) {
      const dir = /^below\/([\w-]+)$/i.exec(l.trim())?.[1];
      if (dir) dirs.add(dir.toLowerCase());
    }
  }
  return dirs;
}

/**
 * The messages of the conversation below `startTs` (oldest first): up to the first gap longer than
 * `gapHours` between one bit of activity and the next. A reply in a message's thread counts as activity
 * (latest_reply), so a conversation that moved into a thread keeps the window open. Returns the window
 * and its last activity.
 */
export function belowWindow(
  history: SlackMessage[],
  startTs: string,
  threadLastTs: string | undefined,
  gapHours = BELOW_GAP_HOURS,
  maxMessages = BELOW_MAX_MESSAGES
): { messages: SlackMessage[]; lastActivity: number } {
  const gap = gapHours * 3600;
  let last = Math.max(Number(startTs), Number(threadLastTs ?? 0));
  const messages: SlackMessage[] = [];
  for (const m of [...history].sort((a, b) => Number(a.ts) - Number(b.ts))) {
    if (Number(m.ts) <= Number(startTs) || m.thread_ts === startTs || /^(channel|group)_(join|leave)$/.test(m.subtype ?? '')) continue;
    // A busy team channel never goes quiet for hours: past the first few messages it is another topic.
    if (Number(m.ts) - last > gap || messages.length >= maxMessages) break;
    messages.push(m);
    last = Math.max(last, Number(m.ts), Number(m.latest_reply ?? 0));
  }
  return { messages, lastActivity: last };
}

/** Newest activity in the window, as a Slack ts string: a message or a reply in a branching thread. */
const newestOf = (messages: SlackMessage[]) =>
  messages.reduce((n, m) => [m.ts, m.latest_reply ?? '0'].reduce((a, b) => (Number(b) > Number(a) ? b : a), n), '0');

async function renderBelow(
  client: SlackClient,
  channel: string,
  title: string,
  url: string,
  messages: SlackMessage[],
  seen: string,
  dir?: string
): Promise<string> {
  const branches = new Map<string, SlackMessage[]>();
  for (const m of messages.filter((x) => x.reply_count).slice(-MAX_BRANCHES)) {
    const page = await client.call<{ messages?: SlackMessage[] }>('conversations.replies', { channel, ts: m.ts, limit: '100' });
    branches.set(m.ts, (page.messages ?? []).filter((r) => r.ts !== m.ts));
  }
  const ids = new Set<string>();
  for (const m of [...messages, ...[...branches.values()].flat()]) {
    if (m.user) ids.add(m.user);
    for (const id of mentionedUsers(m.text ?? '')) ids.add(id);
  }
  const names = new Map<string, string>();
  for (const id of ids) names.set(id, await client.userName(id));
  // Screenshots posted below the thread land next to below.md (the thread's folder), like the thread's own.
  const { localFiles } = dir
    ? await downloadSlackFiles(client, [...messages, ...[...branches.values()].flat()], dir)
    : { localFiles: new Map<string, string>() };
  const body = (m: SlackMessage) => {
    const lines = messageBodyLines(m, names, localFiles);
    return lines.length ? lines : [''];
  };
  const isNew = (m: SlackMessage) => (Number(m.ts) > Number(seen) ? ' (new)' : '');
  const author = (m: SlackMessage) => (m.user ? names.get(m.user) ?? m.user : m.username ?? 'someone');
  const lines = [
    `# In the channel below "${title}"`,
    '',
    `- Linked message: ${url}`,
    `- Messages after it until the first quiet gap of ${BELOW_GAP_HOURS} h (at most ${BELOW_MAX_MESSAGES}), with the threads branching off them. Later ones can be about another topic.`,
    '',
  ];
  for (const m of messages) {
    lines.push(`## ${author(m)} · ${formatTs(m.ts)}${isNew(m)}`, '', ...body(m));
    for (const r of branches.get(m.ts) ?? []) {
      lines.push(`### ↳ in its thread: ${author(r)} · ${formatTs(r.ts)}${isNew(r)}`, '', ...body(r));
    }
  }
  return `${lines.join('\n').trimEnd()}\n`;
}

/**
 * New messages below the followed links since the last look (state in .slack-below.json): one
 * conversations.history call per open window, and the branching threads only when something changed.
 * The first look only records where the conversation is (the session has just read it).
 */
export async function belowChanges(
  outputDir: string,
  dryRun: boolean | undefined,
  client: SlackClient,
  dirs: Set<string> = followedBelow(),
  now = Date.now()
): Promise<Change[]> {
  if (!dirs.size) return [];
  const stateFile = path.join(outputDir, BELOW_STATE);
  const state: BelowState = existsSync(stateFile) ? (JSON.parse(readFileSync(stateFile, 'utf8')) as BelowState) : {};
  const changes: Change[] = [];
  for (const dir of dirs) {
    if (state[dir]?.closed) continue;
    const threadFile = path.join(outputDir, 'slack', dir, 'thread.md');
    const ts = /^([a-z0-9]+)-(\d{10})(\d{6})$/i.exec(dir);
    // The thread is exported in the background when the link is pasted: wait for it.
    if (!ts || !existsSync(threadFile)) continue;
    const fm = threadFrontmatter(readFileSync(threadFile, 'utf8'));
    const channel = ts[1]!.toUpperCase();
    const startTs = `${ts[2]}.${ts[3]}`;
    try {
      const page = await client.call<{ messages?: SlackMessage[] }>('conversations.history', {
        channel, oldest: startTs, inclusive: 'false', limit: String(MAX_HISTORY),
      });
      const { messages, lastActivity } = belowWindow(page.messages ?? [], startTs, fm.lastTs);
      const newest = newestOf(messages);
      const closed = now / 1000 - lastActivity > BELOW_GAP_HOURS * 3600;
      const prev = state[dir];
      if (prev && Number(newest) > Number(prev.newest)) {
        const fresh = messages.filter((m) => Number(m.ts) > Number(prev.newest)).length;
        const replies = messages.filter((m) => Number(m.latest_reply ?? 0) > Number(prev.newest)).length;
        const what = [fresh && `${fresh} new message${fresh === 1 ? '' : 's'}`, replies && `new replies in ${replies} thread${replies === 1 ? '' : 's'} there`]
          .filter(Boolean)
          .join(', ');
        if (!dryRun) {
          writeFileSync(path.join(outputDir, 'slack', dir, 'below.md'), await renderBelow(client, channel, fm.title ?? '', fm.url ?? '', messages, prev.newest, path.join(outputDir, 'slack', dir)));
        }
        changes.push({
          // "slack/<dir> below" is its own item: a reply line of the thread itself in the same round stays.
          line: `slack/${dir} below: ${what || 'new activity'} in the channel below "${fm.title ?? ''}" (may be another topic; slack/${dir}/below.md; once the channel is on another topic, stop with \`jirallm unfollow below/${dir}\`, after \`jirallm follow <link>\` of a thread there you still wait on)`,
          url: fm.url,
        });
      } else if (!prev && !dryRun) {
        writeFileSync(path.join(outputDir, 'slack', dir, 'below.md'), await renderBelow(client, channel, fm.title ?? '', fm.url ?? '', messages, newest, path.join(outputDir, 'slack', dir)));
      }
      state[dir] = { newest: prev && Number(prev.newest) > Number(newest) ? prev.newest : newest, ...(closed && { closed: true }) };
    } catch (err) {
      const msg = String(err instanceof Error ? err.message : err).split('\n')[0];
      changes.push({ line: `slack/${dir} below: check failed (${msg})`, error: true });
      if (/ratelimited|HTTP 429|invalid_auth|not_authed|token_revoked/.test(msg)) break;
    }
  }
  if (!dryRun) {
    mkdirSync(outputDir, { recursive: true });
    writeFileSync(stateFile, JSON.stringify(state, null, 1));
  }
  return changes;
}
