import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { intro, outro, password, isCancel, cancel } from '@clack/prompts';
import { removeSecret, setSecret } from '../../lib/credentials.js';
import {
  SLACK_COOKIE_ACCOUNT,
  SLACK_TOKEN_ACCOUNT,
  SlackClient,
  loadSlackAuth,
  mentionedUsers,
  parseSlackUrl,
  renderThread,
} from '../../lib/slack.js';
import { printJson } from '../jsonOutput.js';

export type SlackOptions = {
  outputDir?: string;
  files?: boolean;
  json?: boolean;
};

function safeName(name: string): string {
  return name.replace(/[^\w.-]+/g, '_').slice(0, 80) || 'file';
}

/**
 * Prints a Slack message with its whole thread as Markdown, or with --output-dir writes
 * <dir>/slack/<channel>-<ts>/thread.md and downloads the thread's files next to it.
 */
export async function runSlack(url: string, opts: SlackOptions): Promise<void> {
  const link = parseSlackUrl(url);
  const client = new SlackClient(await loadSlackAuth());
  const [messages, channelName] = await Promise.all([client.thread(link), client.channelName(link.channel)]);
  if (messages.length === 0) throw new Error('Slack returned no messages for this link.');

  const ids = new Set<string>();
  for (const m of messages) {
    if (m.user) ids.add(m.user);
    for (const id of mentionedUsers(m.text ?? '')) ids.add(id);
  }
  const names = new Map<string, string>();
  for (const id of ids) names.set(id, await client.userName(id));

  if (opts.json) {
    printJson({ link, channelName, users: Object.fromEntries(names), messages });
    return;
  }

  const localFiles = new Map<string, string>();
  let dir: string | undefined;
  if (opts.outputDir) {
    dir = join(opts.outputDir, 'slack', `${link.channel.toLowerCase()}-${(link.threadTs ?? messages[0].ts).replace('.', '')}`);
    mkdirSync(dir, { recursive: true });
    if (opts.files !== false) {
      for (const file of messages.flatMap((m) => m.files ?? [])) {
        const name = `${file.id}-${safeName(file.name ?? file.title ?? 'file')}`;
        try {
          writeFileSync(join(dir, name), await client.download(file));
          localFiles.set(file.id, `./${name}`);
        } catch (err) {
          console.error(`# ${(err as Error).message}`);
        }
      }
    }
  }

  const markdown = renderThread({ url, channelName, messages, linkedTs: link.ts, names, localFiles });
  if (dir) {
    const file = join(dir, 'thread.md');
    writeFileSync(file, markdown);
    console.log(file);
  } else {
    process.stdout.write(markdown);
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
        'Slack token (xoxp- user token from a Slack app with channels:history, groups:history, im:history, mpim:history, users:read; or an xoxc- browser token)',
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
