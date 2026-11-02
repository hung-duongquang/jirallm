import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/credentials.js', () => ({
  getSecret: vi.fn(async () => undefined),
  setSecret: vi.fn(),
  removeSecret: vi.fn(),
}));

import { runSlackSearch } from './slack.js';

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
