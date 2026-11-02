import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
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
};

type SlackResponse = { ok: boolean; error?: string; needed?: string; response_metadata?: { next_cursor?: string } };

export type SlackAuth = { token: string; cookie?: string };

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
  for (const msg of messages) {
    const author = msg.user ? names.get(msg.user) ?? msg.user : msg.bot_profile?.name ?? msg.username ?? 'unknown';
    const marker = msg.ts === input.linkedTs && messages.length > 1 ? ' (linked message)' : '';
    const edited = msg.edited ? ' (edited)' : '';
    lines.push(`## ${author} · ${formatTs(msg.ts)}${edited}${marker}`, '');
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
    }
    if (msg.files?.length) lines.push('');
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
};

/** A short title for the list: the first line of the thread's first message. */
export function threadTitle(messages: SlackMessage[], names: Map<string, string>): string {
  const first = mrkdwnToMarkdown(messages[0]?.text ?? '', names).split('\n').find((l) => l.trim()) ?? '';
  const plain = first.replace(/\*\*|`|~~/g, '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').trim();
  return plain.length > 100 ? `${plain.slice(0, 99)}…` : plain || '(no text)';
}

export type LoadedThread = { link: SlackLink; channelName?: string; messages: SlackMessage[]; names: Map<string, string> };

/** Fetches the thread around `url`, with the names of its authors and mentioned users. */
export async function loadSlackThread(url: string, client?: SlackClient): Promise<LoadedThread & { client: SlackClient }> {
  const link = parseSlackUrl(url);
  const slack = client ?? new SlackClient(await loadSlackAuth());
  const [messages, channelName] = await Promise.all([slack.thread(link), slack.channelName(link.channel)]);
  if (messages.length === 0) throw new Error('Slack returned no messages for this link.');
  const ids = new Set<string>();
  for (const m of messages) {
    if (m.user) ids.add(m.user);
    for (const id of mentionedUsers(m.text ?? '')) ids.add(id);
  }
  const names = new Map<string, string>();
  for (const id of ids) names.set(id, await slack.userName(id));
  return { link, channelName, messages, names, client: slack };
}

/**
 * Writes `<outputDir>/slack/<channel>-<thread ts>/thread.md` and downloads the thread's files
 * next to it (unless `files` is false). Exporting the same thread again overwrites it.
 */
export async function exportSlackThread(
  url: string,
  opts: { outputDir: string; files?: boolean; client?: SlackClient }
): Promise<ExportedSlackThread> {
  const { link, channelName, messages, names, client } = await loadSlackThread(url, opts.client);
  const dirName = `${link.channel.toLowerCase()}-${(messages[0].thread_ts ?? messages[0].ts).replace('.', '')}`;
  const dir = join(opts.outputDir, 'slack', dirName);
  mkdirSync(dir, { recursive: true });

  const localFiles = new Map<string, string>();
  const fileErrors: string[] = [];
  if (opts.files !== false) {
    for (const file of messages.flatMap((m) => m.files ?? [])) {
      const name = `${file.id}-${(file.name ?? file.title ?? 'file').replace(/[^\w.-]+/g, '_').slice(0, 80)}`;
      try {
        writeFileSync(join(dir, name), await client.download(file));
        localFiles.set(file.id, `./${name}`);
      } catch (err) {
        fileErrors.push((err as Error).message);
      }
    }
  }

  const title = threadTitle(messages, names);
  const frontmatter = [
    '---',
    'slack:',
    `  title: ${JSON.stringify(title)}`,
    `  channel: ${JSON.stringify(channelName ?? link.channel)}`,
    `  messages: ${messages.length}`,
    `  lastReplyAt: ${JSON.stringify(new Date(Number(messages.at(-1)!.ts) * 1000).toISOString())}`,
    `  url: ${JSON.stringify(url)}`,
    '---',
    '',
  ].join('\n');
  const path = join(dir, 'thread.md');
  writeFileSync(path, frontmatter + renderThread({ url, channelName, messages, linkedTs: link.ts, names, localFiles }));
  return { dirName, path, title, messageCount: messages.length, fileCount: localFiles.size, fileErrors };
}
