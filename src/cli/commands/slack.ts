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
  mentionedUsers,
  renderThread,
  searchHits,
  slackSearchQueries,
  threadTitle,
} from '../../lib/slack.js';
import { printJson } from '../jsonOutput.js';

export type SlackOptions = {
  outputDir?: string;
  files?: boolean;
  /** false (--no-channel): leave out channel messages posted outside the thread. */
  channel?: boolean;
  /** false (--no-frames): keep videos but skip extracting their frames. */
  frames?: boolean;
  json?: boolean;
  /** Print only `<thread title> · #channel` (the plugin's prompt hook names Claude Code sessions with it). */
  title?: boolean;
};

/** One line naming the thread, most telling part first: `<first line of its first message> · #channel`. */
export function slackTitleLine(channelName: string | undefined, title: string): string {
  const where = !channelName ? '' : channelName === 'direct message' ? ' · DM' : ` · #${channelName}`;
  return `${title}${where}`;
}

/**
 * Prints a Slack message with its whole thread as Markdown, or with --output-dir writes
 * <dir>/slack/<channel>-<ts>/thread.md and downloads the thread's files next to it.
 */
export async function runSlack(url: string, opts: SlackOptions): Promise<void> {
  if (opts.title) {
    const { channelName, messages, names } = await loadSlackThread(url, undefined, { channel: false });
    console.log(slackTitleLine(channelName, threadTitle(messages, names)));
    return;
  }
  if (opts.outputDir && !opts.json) {
    const thread = await exportSlackThread(url, { outputDir: opts.outputDir, files: opts.files, channel: opts.channel, frames: opts.frames });
    for (const err of thread.fileErrors) console.error(`# ${err}`);
    console.log(thread.path);
    return;
  }
  const { link, url: messageUrl, channelName, messages, channelMessages, names } = await loadSlackThread(url, undefined, {
    channel: opts.channel,
  });
  if (opts.json) {
    printJson({ link, channelName, users: Object.fromEntries(names), messages, channelMessages });
    return;
  }
  process.stdout.write(renderThread({ url: messageUrl, channelName, messages, channelMessages, linkedTs: link.ts, names }));
}

export type SlackSearchOptions = {
  after?: string;
  max?: string;
  json?: boolean;
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

  if (opts.json) {
    printJson({ query: q, total, hits });
    return;
  }
  console.error(`# ${q}: ${total} message(s)${total > matches.length ? `, showing the newest ${matches.length}` : ''}, ${hits.length} thread(s)`);
  if (hits.length === 0) return;
  console.log(['date', 'channel', 'author', 'matches', 'text', 'url'].join('\t'));
  for (const h of hits) {
    console.log([h.date, h.channel, h.author, String(h.more + 1), h.text.replace(/\t/g, ' '), h.url].join('\t'));
  }
}

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

