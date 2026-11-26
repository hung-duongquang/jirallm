import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/credentials.js', () => ({
  getSecret: vi.fn(async () => undefined),
  setSecret: vi.fn(),
  removeSecret: vi.fn(),
}));

import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { exportSlackThread, SlackClient } from '../../lib/slack.js';
import { followThreadRefs, refreshAfterRead, runSlackSearch, slackTitleLine, ticketThreadTitle, workspaceOutputDir } from './slack.js';
import { changesReport, seenMarkerPath } from './watch.js';

describe('slackTitleLine', () => {
  it('puts the thread title first and the channel last', () => {
    expect(slackTitleLine('healthcare-claim-invoicing', 'ZOD-3165 export')).toBe('ZOD-3165 export · #healthcare-claim-invoicing');
    expect(slackTitleLine('direct message', 'hi')).toBe('hi · DM');
    expect(slackTitleLine(undefined, 'hi')).toBe('hi');
    expect(slackTitleLine('mpdm-trung--hung--linh-1', 'hi')).toBe('hi · group DM');
  });
});

describe('ticketThreadTitle', () => {
  it('names a thread that opens with only a ticket link after the ticket', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'jl-title-'));
    mkdirSync(path.join(dir, 'zod-4243'));
    writeFileSync(path.join(dir, 'zod-4243', 'task.md'), '---\nkey: "ZOD-4243"\n---\n\n# Allow the regression job\n');
    expect(ticketThreadTitle('topicushealthcare.atlassian.net/browse/ZOD-4243', dir)).toBe('ZOD-4243 Allow the regression job');
    expect(ticketThreadTitle('https://x.atlassian.net/browse/ZOD-9', dir)).toBe('ZOD-9');
    expect(ticketThreadTitle('Please check ZOD-4243', dir)).toBe('Please check ZOD-4243');
  });

  it('keeps what the message says besides the link and its mentions, cutting the summary to fit', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'jl-title-'));
    mkdirSync(path.join(dir, 'zod-4101'));
    writeFileSync(path.join(dir, 'zod-4101', 'task.md'), '---\nkey: "ZOD-4101"\n---\n\n# BE - Automatically populate RHO debtor details based on connection\n');
    const title = ticketThreadTitle('topicushealthcare.atlassian.net/browse/ZOD-4101 @Hung Duong Quang feature8', dir, ['Hung Duong Quang']);
    expect(title).toBe('ZOD-4101 BE - Automatically populate RHO debtor deta… · feature8');
    expect(title.length).toBeLessThanOrEqual(64);
    expect(ticketThreadTitle('https://x.atlassian.net/browse/ZOD-9 deploy feature8', dir)).toBe('ZOD-9 · deploy feature8');
  });
});

describe('slack:search without a token', () => {
  afterEach(() => vi.restoreAllMocks());

  it('prints that Slack is not set up and calls nothing', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    await runSlackSearch('ZOD-1 OR pull/2', {});
    expect(log).toHaveBeenCalledWith(expect.stringContaining('Slack not set up'));
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('reading an exported thread with new replies', () => {
  afterEach(() => vi.restoreAllMocks());

  const thread = (texts: string[]) => {
    const parent = { ts: '1000000000.000000', thread_ts: '1000000000.000000', user: 'U1', text: 'question' };
    const replies = texts.map((text, i) => ({ ts: `10000000${60 + i * 60}.000000`, thread_ts: parent.ts, user: 'U1', text }));
    return {
      link: { workspace: 'x', channel: 'C1', ts: parent.ts },
      url: 'https://x.slack.com/archives/C1/p1000000000000000',
      channelName: 'dev',
      messages: [parent, ...replies],
      channelMessages: [],
      names: new Map([['U1', 'Linh']]),
      client: new SlackClient({ token: 'xoxp-1' }),
    };
  };

  it('updates the export, logs the change for other sessions and not for the one that read it', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const outputDir = mkdtempSync(path.join(tmpdir(), 'jl-slack-read-'));
    await exportSlackThread(thread(['one']).url, { outputDir, loaded: thread(['one']) });
    // No new replies: nothing to log.
    await refreshAfterRead(thread(['one']), undefined, outputDir, 'reader');
    expect(existsSync(path.join(outputDir, 'CHANGES.md'))).toBe(false);

    await refreshAfterRead(thread(['one', 'two']), undefined, outputDir, 'reader');
    expect(readFileSync(path.join(outputDir, 'slack', 'c1-1000000000000000', 'thread.md'), 'utf8')).toContain('two');
    expect(readFileSync(path.join(outputDir, 'CHANGES.md'), 'utf8')).toContain('slack/c1-1000000000000000: 1 new reply in "question"');
    const focus = { keys: ['slack/c1-1000000000000000'], pushOnly: true };
    // Both sessions started before the change.
    for (const s of ['reader', 'other']) writeFileSync(seenMarkerPath(outputDir, s), '2000-01-01 00:00');
    expect(changesReport(outputDir, true, 50, 'reader', focus)).toBeNull();
    expect(changesReport(outputDir, true, 50, 'other', focus)).toContain('1 new reply');
  });

  it('leaves a thread that was never exported alone, and an export read without channel messages', async () => {
    const outputDir = mkdtempSync(path.join(tmpdir(), 'jl-slack-read-'));
    await refreshAfterRead(thread(['one']), undefined, outputDir, 'reader');
    expect(existsSync(path.join(outputDir, 'slack'))).toBe(false);
    await exportSlackThread(thread(['one']).url, { outputDir, loaded: thread(['one']) });
    await refreshAfterRead(thread(['one', 'two']), false, outputDir, 'reader');
    expect(readFileSync(path.join(outputDir, 'slack', 'c1-1000000000000000', 'thread.md'), 'utf8')).not.toContain('two');
  });

  it('finds the export folder of the session project, else above the current directory', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'jl-ws-'));
    const project = path.join(root, 'project');
    const sessions = path.join(root, 'sessions');
    mkdirSync(path.join(project, 'jira-export'), { recursive: true });
    mkdirSync(path.join(project, 'a', 'b'), { recursive: true });
    mkdirSync(sessions);
    writeFileSync(path.join(sessions, 's1.start'), `${project}\n2026-11-16T10:00:00Z\n`);
    expect(workspaceOutputDir('s1', root, sessions)).toBe(path.join(project, 'jira-export'));
    expect(workspaceOutputDir(undefined, path.join(project, 'a', 'b'), sessions)).toBe(path.join(project, 'jira-export'));
  });
});

describe('followThreadRefs', () => {
  it('makes the session follow the PRs linked and tickets named in the thread', () => {
    const out = mkdtempSync(path.join(tmpdir(), 'jl-refs-'));
    mkdirSync(path.join(out, 'zod-1'));
    const sessions = mkdtempSync(path.join(tmpdir(), 'jl-refs-s-'));
    writeFileSync(path.join(sessions, 's1.follow'), 'slack/c1-1');
    followThreadRefs(['resolve <https://github.com/o/r/pull/3270#pullrequestreview-1|the PR> for ZOD-1, UTF-8 ok'], out, 's1', sessions);
    expect(readFileSync(path.join(sessions, 's1.follow'), 'utf8')).toBe('slack/c1-1\npr/o/r/3270');
    expect(readFileSync(path.join(sessions, 's1.keys'), 'utf8')).toBe('ZOD-1');
    followThreadRefs(['again https://github.com/o/r/pull/3270'], out, 's1', sessions);
    expect(readFileSync(path.join(sessions, 's1.follow'), 'utf8')).toBe('slack/c1-1\npr/o/r/3270');
    followThreadRefs(['<https://github.com/o/aws/actions/runs/44|rolt uit naar productie> approve bro'], out, 's1', sessions);
    expect(readFileSync(path.join(sessions, 's1.follow'), 'utf8')).toBe('slack/c1-1\npr/o/r/3270\nrun/o/aws/44');
    followThreadRefs(['https://github.com/o/r/pull/1'], out, undefined, sessions);
    expect(existsSync(path.join(sessions, 'undefined.follow'))).toBe(false);
  });
});
