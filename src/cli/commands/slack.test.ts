import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/credentials.js', () => ({
  getSecret: vi.fn(async () => undefined),
  setSecret: vi.fn(),
  removeSecret: vi.fn(),
}));

import { runSlackSearch, slackTitleLine } from './slack.js';

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
