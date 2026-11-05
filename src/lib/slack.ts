import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { extractFrames, isVideoFile } from 'framewise';
import { getSecret } from './credentials.js';

export const SLACK_TOKEN_ACCOUNT = 'slack:token';
export const SLACK_COOKIE_ACCOUNT = 'slack:cookie';

export type SlackLink = {
  workspace: string;
  channel: string;
  /** Timestamp of the linked message, e.g. 1793370497.363139. */
  ts: string;
  /** Parent of the thread when the link points at a reply. */
  threadTs?: string;
};

/**
 * Parses a Slack message link: https://<ws>.slack.com/archives/<channel>/p<16 digits>[?thread_ts=…].
 * The `p` id is the message ts without its dot (10 digits of seconds, 6 of microseconds).
 */
export function parseSlackUrl(url: string): SlackLink {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    throw new Error(`Not a URL: ${url}`);
  }
  const host = parsed.hostname.toLowerCase();
  const m = /^\/archives\/([A-Z0-9]+)\/p(\d{10})(\d{6})\/?$/i.exec(parsed.pathname);
  if (!host.endsWith('.slack.com') || !m) {
    throw new Error(`Not a Slack message link (https://<workspace>.slack.com/archives/<channel>/p<id>): ${url}`);
  }
  const threadTs = parsed.searchParams.get('thread_ts') ?? undefined;
  return {
    workspace: host.slice(0, -'.slack.com'.length),
    channel: m[1].toUpperCase(),
    ts: `${m[2]}.${m[3]}`,
    threadTs: threadTs && /^\d+\.\d+$/.test(threadTs) ? threadTs : undefined,
  };
}

/**
 * The file id of a Slack file link (what "Copy link" on an image gives):
 * https://<ws>.slack.com/files/<user>/<F…>/<name>. Undefined for any other URL.
 */
export function parseSlackFileUrl(url: string): { workspace: string; fileId: string } | undefined {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return undefined;
  }
  const host = parsed.hostname.toLowerCase();
  const m = /^\/files\/[A-Z0-9]+\/(F[A-Z0-9]+)(\/|$)/i.exec(parsed.pathname);
  if (!host.endsWith('.slack.com') || !m) return undefined;
  return { workspace: host.slice(0, -'.slack.com'.length), fileId: m[1].toUpperCase() };
}

/** Message link for a channel + ts, in the shape parseSlackUrl reads. */
export function slackMessageUrl(link: SlackLink): string {
  const base = `https://${link.workspace}.slack.com/archives/${link.channel}/p${link.ts.replace('.', '')}`;
  return link.threadTs && link.threadTs !== link.ts ? `${base}?thread_ts=${link.threadTs}` : base;
}

type FileShare = { ts: string; thread_ts?: string };
export type SlackFileInfo = SlackFile & { shares?: { public?: Record<string, FileShare[]>; private?: Record<string, FileShare[]> } };

export type SlackFile = {
  id: string;
  name?: string;
  title?: string;
  mimetype?: string;
  url_private?: string;
  url_private_download?: string;
  permalink?: string;
};

export type SlackAttachment = {
  title?: string;
  title_link?: string;
  text?: string;
  fallback?: string;
  author_name?: string;
  from_url?: string;
};

export type SlackMessage = {
  ts: string;
  thread_ts?: string;
  user?: string;
  username?: string;
  bot_profile?: { name?: string };
  text?: string;
  files?: SlackFile[];
  attachments?: SlackAttachment[];
  edited?: { ts: string };
  subtype?: string;
  reply_count?: number;
};

/** Channel messages read after a thread: until this long after its last message, at most CHANNEL_MAX. */
export const CHANNEL_WINDOW_HOURS = 12;
export const CHANNEL_MAX = 15;

export type SlackSearchMatch = {
  ts: string;
  text?: string;
  user?: string;
  username?: string;
  permalink: string;
  channel?: { id?: string; name?: string; is_im?: boolean; is_mpim?: boolean };
};

type SlackResponse = { ok: boolean; error?: string; needed?: string; response_metadata?: { next_cursor?: string } };

export type SlackAuth = { token: string; cookie?: string };

/** Printed instead of results when no Slack token is set, so agents skip their Slack steps. */
export const SLACK_NOT_SET_UP = 'Slack not set up (no token): skipped. `jirallm slack:auth` enables it.';

/** Whether a Slack token is stored or in the environment; no network call. */
export async function hasSlackToken(): Promise<boolean> {
  return Boolean(await getSecret(SLACK_TOKEN_ACCOUNT, 'JIRALLM_SLACK_TOKEN'));
}

/** Token from the keychain (`jirallm slack:auth`) or JIRALLM_SLACK_TOKEN / JIRALLM_SLACK_COOKIE. */
export async function loadSlackAuth(): Promise<SlackAuth> {
  const token = await getSecret(SLACK_TOKEN_ACCOUNT, 'JIRALLM_SLACK_TOKEN');
  if (!token) throw new Error('No Slack token. Run `jirallm slack:auth` (or set JIRALLM_SLACK_TOKEN).');
  const cookie = token.startsWith('xoxc-') ? await getSecret(SLACK_COOKIE_ACCOUNT, 'JIRALLM_SLACK_COOKIE') : undefined;
  if (token.startsWith('xoxc-') && !cookie) {
    throw new Error('An xoxc- token also needs the "d" cookie. Run `jirallm slack:auth` again.');
  }
  return { token, cookie };
}

export class SlackClient {
  private readonly names = new Map<string, string>();

  constructor(
    private readonly auth: SlackAuth,
    private readonly fetchImpl: typeof fetch = fetch
  ) {}

  private headers(): Record<string, string> {
    const headers: Record<string, string> = { Authorization: `Bearer ${this.auth.token}` };
    if (this.auth.cookie) headers.Cookie = `d=${encodeURIComponent(decodeURIComponent(this.auth.cookie))}`;
    return headers;
  }

  async call<T>(method: string, params: Record<string, string>): Promise<T & SlackResponse> {
    const res = await this.fetchImpl(`https://slack.com/api/${method}`, {
      method: 'POST',
      headers: { ...this.headers(), 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(params).toString(),
    });
    if (!res.ok) throw new Error(`Slack ${method}: HTTP ${res.status}`);
    const body = (await res.json()) as T & SlackResponse;
    if (!body.ok) {
      const hint = body.error === 'missing_scope' && body.needed ? ` (token needs scope ${body.needed})` : '';
      throw new Error(`Slack ${method}: ${body.error ?? 'unknown error'}${hint}`);
    }
    return body;
  }

  /** The whole thread around `link` (parent first), or just the message when it has no thread. */
  async thread(link: SlackLink): Promise<SlackMessage[]> {
    let threadTs = link.threadTs ?? link.ts;
    let messages = await this.replies(link.channel, threadTs);
    // A link to a reply without ?thread_ts= returns only the reply; follow it to the parent.
    const parent = messages[0]?.thread_ts;
    if (!link.threadTs && parent && parent !== threadTs) {
      threadTs = parent;
      messages = await this.replies(link.channel, threadTs);
    }
    return messages;
  }

  private async replies(channel: string, ts: string): Promise<SlackMessage[]> {
    const out: SlackMessage[] = [];
    let cursor: string | undefined;
    do {
      const page = await this.call<{ messages?: SlackMessage[] }>('conversations.replies', {
        channel,
        ts,
        limit: '200',
        ...(cursor ? { cursor } : {}),
      });
      out.push(...(page.messages ?? []));
      cursor = page.response_metadata?.next_cursor || undefined;
    } while (cursor);
    return out;
  }

  /**
   * Top-level channel messages posted after the thread parent `threadTs` up to `latest`, oldest
   * first, at most `max`: people often answer in the channel instead of in the thread. Join/leave
   * notices and "also send to channel" copies of this thread's replies are left out.
   */
  async channelAfter(channel: string, threadTs: string, latest: string, max: number): Promise<SlackMessage[]> {
    const out: SlackMessage[] = [];
    let cursor: string | undefined;
    do {
      const page = await this.call<{ messages?: SlackMessage[] }>('conversations.history', {
        channel,
        oldest: threadTs,
        latest,
        inclusive: 'false',
        limit: '200',
        ...(cursor ? { cursor } : {}),
      });
      out.push(...(page.messages ?? []));
      cursor = page.response_metadata?.next_cursor || undefined;
    } while (cursor);
    return out
      .filter((m) => m.ts !== threadTs && m.thread_ts !== threadTs && !/^(channel|group)_(join|leave)$/.test(m.subtype ?? ''))
      .sort((a, b) => Number(a.ts) - Number(b.ts))
      .slice(0, max);
  }

  /** Messages matching a Slack search query, newest first, up to `max` (search.messages, 100 per page). */
  async search(query: string, max: number): Promise<{ total: number; matches: SlackSearchMatch[] }> {
    const matches: SlackSearchMatch[] = [];
    let total = 0;
    for (let page = 1; matches.length < max; page++) {
      const res = await this.call<{ messages?: { total?: number; matches?: SlackSearchMatch[]; paging?: { pages?: number } } }>(
        'search.messages',
        { query, sort: 'timestamp', sort_dir: 'desc', count: String(Math.min(100, max)), page: String(page) }
      );
      total = res.messages?.total ?? 0;
      matches.push(...(res.messages?.matches ?? []));
      if (page >= (res.messages?.paging?.pages ?? 1)) break;
    }
    return { total, matches: matches.slice(0, max) };
  }

  /** Messages matching any of `queries`, each message once, newest first, up to `max`. */
  async searchAny(queries: string[], max: number): Promise<{ total: number; matches: SlackSearchMatch[] }> {
    const seen = new Map<string, SlackSearchMatch>();
    let total = 0;
    for (const q of queries) {
      const res = await this.search(q, max);
      total += res.total;
      for (const m of res.matches) seen.set(`${m.channel?.id ?? ''}:${m.ts}`, m);
    }
    const matches = [...seen.values()].sort((a, b) => Number(b.ts) - Number(a.ts));
    return { total, matches: matches.slice(0, max) };
  }

  /**
   * Message link for a Slack message or file link. A file link is resolved with files.info to the
   * first message that shares the file (the thread parent stays in thread_ts), so an image can be
   * read before anyone replies to it.
   */
  async resolveLink(url: string): Promise<SlackLink> {
    const file = parseSlackFileUrl(url);
    if (!file) return parseSlackUrl(url);
    const res = await this.call<{ file?: SlackFileInfo }>('files.info', { file: file.fileId });
    const shares = { ...res.file?.shares?.public, ...res.file?.shares?.private };
    const found = Object.entries(shares)
      .flatMap(([channel, list]) => list.map((s) => ({ channel, ...s })))
      .sort((a, b) => Number(a.ts) - Number(b.ts))[0];
    if (!found) throw new Error(`Slack file ${file.fileId} is not shared in any conversation you can read.`);
    return { workspace: file.workspace, channel: found.channel, ts: found.ts, threadTs: found.thread_ts };
  }

  async channelName(channel: string): Promise<string | undefined> {
    try {
      const res = await this.call<{ channel?: { name?: string; is_im?: boolean } }>('conversations.info', { channel });
      return res.channel?.is_im ? 'direct message' : res.channel?.name;
    } catch {
      return undefined;
    }
  }

  async userName(id: string): Promise<string> {
    const cached = this.names.get(id);
    if (cached) return cached;
    let name = id;
    try {
      const res = await this.call<{ user?: { real_name?: string; name?: string; profile?: { display_name?: string; real_name?: string } } }>(
        'users.info',
        { user: id }
      );
      const u = res.user;
      name = u?.profile?.real_name || u?.real_name || u?.profile?.display_name || u?.name || id;
    } catch {
      // Unknown or deleted user: keep the id
    }
    this.names.set(id, name);
    return name;
  }

  async download(file: SlackFile): Promise<Buffer> {
    const url = file.url_private_download ?? file.url_private;
    if (!url) throw new Error(`File ${file.name ?? file.id} has no download URL`);
    const res = await this.fetchImpl(url, { headers: this.headers() });
    if (!res.ok) throw new Error(`Download ${file.name ?? file.id}: HTTP ${res.status}`);
    // Without a valid session Slack answers 200 with its login page.
    if ((res.headers.get('content-type') ?? '').startsWith('text/html') && !(file.mimetype ?? '').startsWith('text/html')) {
      throw new Error(`Download ${file.name ?? file.id}: got an HTML page (not authorized)`);
    }
    return Buffer.from(await res.arrayBuffer());
  }
}

const ENTITIES: Record<string, string> = { '&lt;': '<', '&gt;': '>', '&amp;': '&' };

/**
 * Converts Slack mrkdwn to Markdown. Mentions are resolved with `names` (user id → name);
 * code spans and blocks are left alone.
 */
export function mrkdwnToMarkdown(text: string, names: Map<string, string>): string {
  const parts = text.split(/(```[\s\S]*?```|`[^`\n]+`)/);
  return parts
    .map((part, i) => {
      if (i % 2 === 1) {
        const decoded = part.replace(/&(lt|gt|amp);/g, (e) => ENTITIES[e]);
        // Slack sends ```code``` on one line; Markdown needs the fences on their own lines.
        return decoded.startsWith('```') ? decoded.replace(/^```\n?/, '\n```\n').replace(/\n?```$/, '\n```\n') : decoded;
      }
      return part
        .replace(/<([^<>]+)>/g, (_, inner: string) => {
          const [target, label] = inner.split('|', 2);
          if (target.startsWith('@')) return `@${label ?? names.get(target.slice(1)) ?? target.slice(1)}`;
          if (target.startsWith('#')) return `#${label ?? target.slice(1)}`;
          if (target.startsWith('!subteam^')) return label ?? '@group';
          if (target.startsWith('!date^')) return label ?? target;
          if (target.startsWith('!')) return `@${target.slice(1)}`;
          return label ? `[${label}](${target})` : target;
        })
        .replace(/(^|[\s(])\*([^*\n]+)\*(?=$|[\s).,!?:;])/gm, '$1**$2**')
        .replace(/(^|[\s(])~([^~\n]+)~(?=$|[\s).,!?:;])/gm, '$1~~$2~~')
        .replace(/^&gt; ?/gm, '> ')
        .replace(/&(lt|gt|amp);/g, (e) => ENTITIES[e]);
    })
    .join('')
    .trim();
}

/** User ids mentioned as <@U…> in a message, so their names can be looked up first. */
export function mentionedUsers(text: string): string[] {
  return [...text.matchAll(/<@([A-Z0-9]+)(?:\|[^>]*)?>/g)].map((m) => m[1]);
}

export function formatTs(ts: string): string {
  const d = new Date(Number(ts) * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export type RenderInput = {
  url: string;
  channelName?: string;
  messages: SlackMessage[];
  linkedTs: string;
  names: Map<string, string>;
  /** Local path per file id, for files that were downloaded. */
  localFiles?: Map<string, string>;
  /** Folder (relative, ending in /) and frame count per video file id whose frames were extracted. */
  localFrames?: Map<string, { dir: string; count: number }>;
  /** Messages after this ts arrived since the previous export; their headings say "(new)". */
  newSince?: string;
  /** Top-level channel messages posted after the thread started (see SlackClient.channelAfter). */
  channelMessages?: SlackMessage[];
};

export function renderThread(input: RenderInput): string {
  const { messages, names } = input;
  const where = input.channelName ? (input.channelName === 'direct message' ? 'direct message' : `#${input.channelName}`) : 'Slack';
  const lines: string[] = [
    `# Slack thread in ${where}`,
    '',
    `- Source: ${input.url}`,
    `- Messages: ${messages.length}${messages.length > 1 ? ` (1 + ${messages.length - 1} replies)` : ''}`,
    '',
  ];
  const renderMessage = (msg: SlackMessage, inChannel = false) => {
    const author = msg.user ? names.get(msg.user) ?? msg.user : msg.bot_profile?.name ?? msg.username ?? 'unknown';
    const marker = msg.ts === input.linkedTs && messages.length > 1 ? ' (linked message)' : '';
    const edited = msg.edited ? ' (edited)' : '';
    const isNew = input.newSince && Number(msg.ts) > Number(input.newSince) ? ' (new)' : '';
    const ownThread = inChannel && msg.reply_count ? ` (own thread, ${msg.reply_count} repl${msg.reply_count === 1 ? 'y' : 'ies'})` : '';
    lines.push(`## ${author} · ${formatTs(msg.ts)}${edited}${marker}${ownThread}${isNew}`, '');
    const body = mrkdwnToMarkdown(msg.text ?? '', names);
    if (body) lines.push(body, '');
    for (const att of msg.attachments ?? []) {
      const head = att.title ? (att.title_link ? `[${att.title}](${att.title_link})` : att.title) : att.author_name;
      const text = att.text ?? (head ? '' : att.fallback ?? '');
      const quoted = [head ? `**${head}**` : '', mrkdwnToMarkdown(text, names)].filter(Boolean).join('\n');
      if (quoted) lines.push(quoted.split('\n').map((l) => `> ${l}`).join('\n'), '');
    }
    for (const file of msg.files ?? []) {
      const name = file.name ?? file.title ?? file.id;
      const local = input.localFiles?.get(file.id);
      const isImage = (file.mimetype ?? '').startsWith('image/');
      if (local) lines.push(isImage ? `![${name}](${local})` : `- File: [${name}](${local})`);
      else lines.push(`- File: ${name}${file.permalink ? ` (${file.permalink})` : ''}`);
      const frames = input.localFrames?.get(file.id);
      if (frames) lines.push(`- Video frames: [${frames.count} extracted frames](${frames.dir}) (read these to see the video)`);
    }
    if (msg.files?.length) lines.push('');
  };
  for (const msg of messages) renderMessage(msg);
  const channel = input.channelMessages ?? [];
  if (channel.length) {
    lines.push(
      '# In the channel, outside the thread',
      '',
      `Top-level messages posted after the thread started (up to ${CHANNEL_WINDOW_HOURS} h after its last message, at most ${CHANNEL_MAX}): replies people posted in the channel instead of the thread. They can also be unrelated.`,
      ''
    );
    for (const msg of channel) renderMessage(msg, true);
  }
  return `${lines.join('\n').trimEnd()}\n`;
}

export type ExportedSlackThread = {
  /** Folder name below `<outputDir>/slack/`. */
  dirName: string;
  path: string;
  title: string;
  messageCount: number;
  fileCount: number;
  /** Files that could not be downloaded, with the reason. */
  fileErrors: string[];
  /** Replies that arrived since the previous export (0 on the first export). */
  newReplies: number;
};

/**
 * A short title for the list: the first line of the thread's first message that is more than a
 * bare link (a thread often opens with the ticket URL), else that link; for a message that is only
 * a file (a screenshot or recording), the file's title.
 */
export function threadTitle(messages: SlackMessage[], names: Map<string, string>): string {
  const lines = mrkdwnToMarkdown(messages[0]?.text ?? '', names)
    .split('\n')
    .map((l) => l.replace(/\*\*|`|~~/g, '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/^[>\s•*-]+/, '').trim())
    .filter(Boolean);
  const isLink = (l: string) => /^(https?:\/\/)?[\w.-]+\.[a-z]{2,}\/\S*$/i.test(l);
  const plain = lines.find((l) => !isLink(l)) ?? lines[0] ?? '';
  const file = messages[0]?.files?.[0];
  const title = plain || (file ? `[file] ${file.title ?? file.name ?? file.id}` : '');
  return title.length > 100 ? `${title.slice(0, 99)}…` : title || '(no text)';
}

export type LoadedThread = {
  link: SlackLink;
  /** Message link of `link` (a file link is replaced by the message that shares the file). */
  url: string;
  channelName?: string;
  messages: SlackMessage[];
  /** Top-level channel messages after the thread started (empty with `channel: false`). */
  channelMessages: SlackMessage[];
  names: Map<string, string>;
};

/** Fetches the thread around `url` (message or file link), with the names of its authors and mentioned users. */
export async function loadSlackThread(
  url: string,
  client?: SlackClient,
  opts: { channel?: boolean } = {}
): Promise<LoadedThread & { client: SlackClient }> {
  // Refuse a non-Slack URL before asking for a token.
  if (!parseSlackFileUrl(url)) parseSlackUrl(url);
  const slack = client ?? new SlackClient(await loadSlackAuth());
  const link = await slack.resolveLink(url);
  const [messages, channelName] = await Promise.all([slack.thread(link), slack.channelName(link.channel)]);
  if (messages.length === 0) throw new Error('Slack returned no messages for this link.');
  const threadTs = messages[0].thread_ts ?? messages[0].ts;
  const latest = String(Number(messages.at(-1)!.ts) + CHANNEL_WINDOW_HOURS * 3600);
  const channelMessages = opts.channel === false ? [] : await slack.channelAfter(link.channel, threadTs, latest, CHANNEL_MAX);
  const ids = new Set<string>();
  for (const m of [...messages, ...channelMessages]) {
    if (m.user) ids.add(m.user);
    for (const id of mentionedUsers(m.text ?? '')) ids.add(id);
  }
  const names = new Map<string, string>();
  for (const id of ids) names.set(id, await slack.userName(id));
  const messageUrl = parseSlackFileUrl(url) ? slackMessageUrl(link) : url;
  return { link, url: messageUrl, channelName, messages, channelMessages, names, client: slack };
}

/** Same frame settings as Jira video attachments (exporter DEFAULT_VIDEO_OPTS). */
const SLACK_VIDEO_FRAMES = { fps: 5, quality: 85, maxFrames: 10 };

/** Frames of a video as JPEGs in `framesDir` (kept from an earlier export when present); returns their count. */
async function videoFrames(videoPath: string, framesDir: string): Promise<number> {
  const existing = () => (existsSync(framesDir) ? readdirSync(framesDir).filter((f) => f.startsWith('frame-') && f.endsWith('.jpg')).length : 0);
  if (existing() > 0) return existing();
  await extractFrames(videoPath, framesDir, { ...SLACK_VIDEO_FRAMES, format: 'jpeg' });
  return existing();
}

/**
 * Writes `<outputDir>/slack/<channel>-<thread ts>/thread.md` and downloads the thread's files
 * next to it (unless `files` is false). Exporting the same thread again overwrites it.
 */
export async function exportSlackThread(
  fileOrMessageUrl: string,
  opts: { outputDir: string; files?: boolean; client?: SlackClient; channel?: boolean; frames?: boolean }
): Promise<ExportedSlackThread> {
  // Frontmatter and Source keep the message link, so watch can re-read the thread.
  const { link, url, channelName, messages, channelMessages, names, client } = await loadSlackThread(fileOrMessageUrl, opts.client, {
    channel: opts.channel,
  });
  const dirName = `${link.channel.toLowerCase()}-${(messages[0].thread_ts ?? messages[0].ts).replace('.', '')}`;
  const dir = join(opts.outputDir, 'slack', dirName);
  mkdirSync(dir, { recursive: true });

  const localFiles = new Map<string, string>();
  const localFrames = new Map<string, { dir: string; count: number }>();
  const fileErrors: string[] = [];
  if (opts.files !== false) {
    for (const file of [...messages, ...channelMessages].flatMap((m) => m.files ?? [])) {
      const name = `${file.id}-${(file.name ?? file.title ?? 'file').replace(/[^\w.-]+/g, '_').slice(0, 80)}`;
      const filePath = join(dir, name);
      try {
        // A Slack file id never gets new content, so a re-export (watch) does not fetch it again.
        if (!existsSync(filePath)) writeFileSync(filePath, await client.download(file));
        localFiles.set(file.id, `./${name}`);
      } catch (err) {
        fileErrors.push((err as Error).message);
        continue;
      }
      if (opts.frames === false || !isVideoFile(name)) continue;
      try {
        const count = await videoFrames(filePath, join(dir, `${name}-frames`));
        if (count > 0) localFrames.set(file.id, { dir: `./${name}-frames/`, count });
      } catch (err) {
        fileErrors.push(`${name}: no video frames (${(err as Error).message})`);
      }
    }
  }

  // Replies newer than the last message of the previous export are new. When nothing new came in,
  // the marks of the update that brought replies stay, so a quick second update does not drop them.
  const path = join(dir, 'thread.md');
  const prev = existsSync(path) ? threadFrontmatter(readFileSync(path, 'utf8')) : undefined;
  const lastTs = messages.at(-1)!.ts;
  let newSince = prev?.newSince;
  let newRepliesAt = prev?.newRepliesAt;
  if (prev?.lastTs && Number(lastTs) > Number(prev.lastTs)) {
    newSince = prev.lastTs;
    newRepliesAt = new Date().toISOString();
  }
  const newReplies = newSince ? messages.filter((m) => Number(m.ts) > Number(newSince)).length : 0;

  const title = threadTitle(messages, names);
  const frontmatter = [
    '---',
    'slack:',
    `  title: ${JSON.stringify(title)}`,
    `  channel: ${JSON.stringify(channelName ?? link.channel)}`,
    `  messages: ${messages.length}`,
    ...(channelMessages.length ? [`  channelMessages: ${channelMessages.length}`] : []),
    `  lastReplyAt: ${JSON.stringify(new Date(Number(lastTs) * 1000).toISOString())}`,
    `  lastTs: ${JSON.stringify(lastTs)}`,
    ...(newReplies
      ? [`  newSince: ${JSON.stringify(newSince)}`, `  newReplies: ${newReplies}`, `  newRepliesAt: ${JSON.stringify(newRepliesAt)}`]
      : []),
    `  url: ${JSON.stringify(url)}`,
    '---',
    '',
  ].join('\n');
  const body = renderThread({
    url, channelName, messages, channelMessages, linkedTs: link.ts, names, localFiles, localFrames,
    newSince: newReplies ? newSince : undefined,
  });
  writeFileSync(path, frontmatter + body);
  return { dirName, path, title, messageCount: messages.length, fileCount: localFiles.size, fileErrors, newReplies };
}

/**
 * Builds search.messages queries. Slack's API has no OR (all terms must match), so the query is
 * split on OR (outside quotes) into one query per alternative. Slack splits ZOD-3988 on the hyphen
 * and would match any "ZOD", so bare Jira keys are quoted; `after` (YYYY-MM-DD) becomes the after:
 * modifier (exclusive day) on each.
 */
export function slackSearchQueries(query: string, after?: string): string[] {
  if (after && !/^\d{4}-\d{2}-\d{2}$/.test(after)) throw new Error(`--after needs a date as YYYY-MM-DD, got: ${after}`);
  const alternatives: string[] = [''];
  for (const [i, part] of query.split(/("[^"]*")/).entries()) {
    if (i % 2 === 1) {
      alternatives[alternatives.length - 1] += part;
      continue;
    }
    const [first, ...rest] = part.replace(/\b[A-Z][A-Z0-9]+-\d+\b/g, '"$&"').split(/\s+OR\s+/);
    alternatives[alternatives.length - 1] += first;
    alternatives.push(...rest);
  }
  return alternatives
    .map((q) => q.trim())
    .filter(Boolean)
    .map((q) => (after ? `${q} after:${after}` : q));
}

export type SlackSearchHit = {
  date: string;
  channel: string;
  author: string;
  text: string;
  url: string;
  /** Other matches in the same thread, folded into this (newest) one. */
  more: number;
};

/** The thread a match belongs to: its permalink's thread_ts, else the message itself. */
function threadKey(m: SlackSearchMatch): string {
  let threadTs: string | null = null;
  try {
    threadTs = new URL(m.permalink).searchParams.get('thread_ts');
  } catch {
    // keep the message ts
  }
  return `${m.channel?.id ?? ''}:${threadTs ?? m.ts}`;
}

/**
 * One hit per thread (the newest match; its permalink opens the thread with `jirallm slack <url>`),
 * text flattened to one line of at most `width` characters.
 */
export function searchHits(matches: SlackSearchMatch[], names: Map<string, string>, width = 150): SlackSearchHit[] {
  const byThread = new Map<string, SlackSearchHit>();
  for (const m of matches) {
    const key = threadKey(m);
    const seen = byThread.get(key);
    if (seen) {
      seen.more++;
      continue;
    }
    const ch = m.channel;
    const channel = ch?.is_im ? 'DM' : ch?.is_mpim ? 'group DM' : ch?.name ? `#${ch.name}` : ch?.id ?? '?';
    const text = mrkdwnToMarkdown(m.text ?? '', names)
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/\s+/g, ' ')
      .trim();
    byThread.set(key, {
      date: formatTs(m.ts),
      channel,
      author: (m.user && names.get(m.user)) || m.username || m.user || '?',
      text: text.length > width ? `${text.slice(0, width - 1)}…` : text,
      url: m.permalink,
      more: 0,
    });
  }
  return [...byThread.values()];
}

/** The fields under `slack:` in a thread.md written by exportSlackThread. */
export function threadFrontmatter(text: string): Record<string, string> {
  const block = text.replace(/\r/g, '').match(/^---\n([\s\S]*?)\n---\n/)?.[1] ?? '';
  const fields: Record<string, string> = {};
  for (const m of block.matchAll(/^\s+(\w+):\s*(.*)$/gm)) {
    try {
      fields[m[1]] = String(JSON.parse(m[2]));
    } catch {
      fields[m[1]] = m[2];
    }
  }
  // Exports from before lastTs was written: lastReplyAt is cut to the millisecond, so round up.
  if (!fields.lastTs && fields.lastReplyAt) fields.lastTs = String(Date.parse(fields.lastReplyAt) / 1000 + 0.000999);
  return fields;
}
