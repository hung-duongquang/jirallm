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
import { refreshAfterRead, runSlackSearch, slackTitleLine, workspaceOutputDir } from './slack.js';
import { changesReport, seenMarkerPath } from './watch.js';

describe('slackTitleLine', () => {
  it('puts the thread title first and the channel last', () => {
    expect(slackTitleLine('healthcare-claim-invoicing', 'ZOD-3165 export')).toBe('ZOD-3165 export · #healthcare-claim-invoicing');
    expect(slackTitleLine('direct message', 'hi')).toBe('hi · DM');
    expect(slackTitleLine(undefined, 'hi')).toBe('hi');
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
