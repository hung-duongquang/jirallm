// `jirallm feedback "<what went wrong>"`: a bug report or request for jirallm, as an issue in the private
// feedback repo, with what a maintainer would otherwise have to ask for (versions, the app, doctor, the
// session's follows and last deliveries). Without gh, or when filing fails, it goes to the clipboard.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { doctorResults, type CheckResult } from './doctor.js';
import { workspaceOutputDir } from './slack.js';
import { writeClipboard } from './slackCopy.js';
import { readDeliveries } from './watch.js';

export const FEEDBACK_REPO = 'hung-duongquang/jirallm-feedback';
const SESSION_ID = /^[\w-]{1,100}$/;

export type FeedbackOptions = { session?: string; print?: boolean };

export type FeedbackFacts = {
  cli: string;
  plugin: string;
  app: string;
  os: string;
  node: string;
  session?: string;
  follows: string[];
  deliveries: Array<{ n: number; at: string; via: string; items: string[] }>;
  doctor: CheckResult[];
};

const symbol: Record<CheckResult['severity'], string> = { pass: '✔', warn: '⚠', fail: '✖' };

/** The issue: title from the first line of the text, body with the facts. */
export function feedbackIssue(text: string, f: FeedbackFacts): { title: string; body: string } {
  const first = text.trim().split('\n')[0]!.trim();
  const title = first.length > 80 ? `${first.slice(0, 79)}…` : first;
  const body = [
    '## What happened',
    '',
    text.trim(),
    '',
    '## Where',
    '',
    `- jirallm CLI ${f.cli}, plugin ${f.plugin}, app ${f.app}`,
    `- ${f.os}, Node ${f.node}`,
    `- session: ${f.session ?? 'none'}`,
    `- follows: ${f.follows.length ? f.follows.join(', ') : 'nothing'}`,
    '',
    '## Last deliveries to the session',
    '',
    ...(f.deliveries.length
      ? f.deliveries.map((d) => `- #${d.n} ${d.at} via ${d.via}: ${d.items.join(', ')}`)
      : ['- none']),
    '',
    '## jirallm doctor',
    '',
    // Without e-mail addresses (the Jira check names the account).
    ...f.doctor.map((r) => `- ${symbol[r.severity]} ${r.name}: ${r.detail.replace(/\s*<[^<>\s]+@[^<>\s]+>/g, '')}`),
    '',
  ].join('\n');
  return { title, body };
}

function pluginVersion(): string {
  try {
    const file = path.join(os.homedir(), '.claude', 'plugins', 'installed_plugins.json');
    const all = JSON.parse(readFileSync(file, 'utf8')) as { plugins?: Record<string, Array<{ version?: string }>> };
    return all.plugins?.['jirallm@jirallm']?.[0]?.version ?? 'not installed';
  } catch {
    return 'not installed';
  }
}

const readLines = (file: string) => {
  try {
    return readFileSync(file, 'utf8').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  } catch {
    return [];
  }
};

async function gatherFacts(session: string | undefined): Promise<FeedbackFacts> {
  const sessions = path.join(os.tmpdir(), 'jirallm-sessions');
  const start = session ? readLines(path.join(sessions, `${session}.start`)) : [];
  const outputDir = workspaceOutputDir(session);
  const require = createRequire(import.meta.url);
  return {
    cli: (require('../../../package.json') as { version: string }).version,
    plugin: pluginVersion(),
    app: start[4] ?? process.env.CLAUDE_CODE_ENTRYPOINT ?? 'terminal',
    os: `${os.type()} ${os.release()}`,
    node: process.versions.node,
    session,
    follows: session ? [...readLines(path.join(sessions, `${session}.keys`)), ...readLines(path.join(sessions, `${session}.follow`))] : [],
    deliveries:
      session && outputDir
        ? readDeliveries(outputDir, session).slice(-5).map(({ n, at, via, items }) => ({ n, at, via, items }))
        : [],
    doctor: await doctorResults(),
  };
}

export async function runFeedback(words: string[], opts: FeedbackOptions = {}): Promise<void> {
  const text = words.join(' ').trim();
  if (!text) throw new Error('Say what went wrong or what you would like: jirallm feedback "<text>".');
  const session = [opts.session, process.env.CLAUDE_CODE_SESSION_ID].find((s) => s && SESSION_ID.test(s));
  const { title, body } = feedbackIssue(text, await gatherFacts(session));
  if (opts.print) {
    console.log(`# ${title}\n\n${body}`);
    return;
  }
  const filed = spawnSync('gh', ['issue', 'create', '-R', FEEDBACK_REPO, '--title', title, '--body-file', '-'], {
    input: body,
    encoding: 'utf8',
  });
  const url = filed.status === 0 ? /https:\/\/\S+/.exec(filed.stdout ?? '')?.[0] : undefined;
  if (url) {
    console.log(`Filed: ${url}`);
    return;
  }
  const why = (filed.stderr || String(filed.error ?? '')).split('\n')[0]?.trim() || 'gh failed';
  const report = `${title}\n\n${body}`;
  try {
    writeClipboard(report, `<pre>${report.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</pre>`);
    console.log(`Could not file it (${why}). The report is on the clipboard: paste it in a Slack DM to Hung.`);
  } catch {
    console.log(`Could not file it (${why}). Send this to Hung on Slack:\n\n${report}`);
  }
}
