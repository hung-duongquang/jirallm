import { intro, outro, password, isCancel, cancel } from '@clack/prompts';
import { removeSecret, setSecret } from '../../lib/credentials.js';
import {
  SLACK_COOKIE_ACCOUNT,
  SLACK_TOKEN_ACCOUNT,
  SlackClient,
  exportSlackThread,
  loadSlackAuth,
  loadSlackThread,
  renderThread,
} from '../../lib/slack.js';
import { printJson } from '../jsonOutput.js';

export type SlackOptions = {
  outputDir?: string;
  files?: boolean;
  json?: boolean;
};

/**
 * Prints a Slack message with its whole thread as Markdown, or with --output-dir writes
 * <dir>/slack/<channel>-<ts>/thread.md and downloads the thread's files next to it.
 */
export async function runSlack(url: string, opts: SlackOptions): Promise<void> {
  if (opts.outputDir && !opts.json) {
    const thread = await exportSlackThread(url, { outputDir: opts.outputDir, files: opts.files });
    for (const err of thread.fileErrors) console.error(`# ${err}`);
    console.log(thread.path);
    return;
  }
  const { link, channelName, messages, names } = await loadSlackThread(url);
  if (opts.json) {
    printJson({ link, channelName, users: Object.fromEntries(names), messages });
    return;
  }
  process.stdout.write(renderThread({ url, channelName, messages, linkedTs: link.ts, names }));
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

