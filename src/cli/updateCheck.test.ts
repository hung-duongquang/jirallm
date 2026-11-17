import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fetchLatestVersion, isNewer, RELEASE_PACKAGE_JSON_URL, updateCheckDisabled, updateNotice, writeState } from './updateCheck.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('isNewer', () => {
  it.each([
    ['0.21.0', '0.20.3', true],
    ['1.0.0', '0.99.99', true],
    ['0.20.10', '0.20.9', true],
    ['0.20.3', '0.20.3', false],
    ['0.20.2', '0.20.3', false],
    ['v0.21.0', '0.20.3', true],
    ['0.21.0-beta.1', '0.21.0', false],
  ])('%s newer than %s: %s', (latest, current, expected) => {
    expect(isNewer(latest, current)).toBe(expected);
  });
});

describe('updateCheckDisabled', () => {
  it('runs in an interactive terminal by default', () => {
    expect(updateCheckDisabled(['node', 'jirallm', 'ZOD-1'], {}, true)).toBe(false);
  });

  it.each([
    ['NO_UPDATE_NOTIFIER', ['node', 'jirallm'], { NO_UPDATE_NOTIFIER: '1' }, true],
    ['CI', ['node', 'jirallm'], { CI: 'true' }, true],
    ['--json', ['node', 'jirallm', 'search', '--json'], {}, true],
    ['no TTY', ['node', 'jirallm'], {}, false],
  ] as const)('is off with %s', (_label, argv, env, isTTY) => {
    expect(updateCheckDisabled([...argv], env, isTTY)).toBe(true);
  });
});

describe('fetchLatestVersion', () => {
  it('reads the version from the release branch package.json', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ name: 'jirallm', version: '0.21.0' }), { status: 200 }));
    await expect(fetchLatestVersion()).resolves.toBe('0.21.0');
    expect(fetchSpy).toHaveBeenCalledWith(RELEASE_PACKAGE_JSON_URL, expect.any(Object));
  });

  it('throws on a non-OK response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('nope', { status: 404, statusText: 'Not Found' }));
    await expect(fetchLatestVersion()).rejects.toThrow(/404/);
  });
});

describe('updateNotice', () => {
  const file = () => path.join(mkdtempSync(path.join(tmpdir(), 'jl-notice-')), 'update-check.json');
  const noRefresh = () => {};

  it('names a newer release once a day, and a plugin/CLI mismatch', () => {
    const f = file();
    writeState({ lastCheck: 1, latest: '0.41.0' }, f);
    expect(updateNotice('0.40.5', '0.40.5', 1000, f, noRefresh)).toBe('⬆ jirallm 0.41.0 is available (you have 0.40.5): run `jirallm upgrade` in a terminal, then restart Claude Code');
    expect(updateNotice('0.40.5', '0.40.5', 2000, f, noRefresh)).toBe('');
    expect(updateNotice('0.40.5', '0.40.4', 3000, f, noRefresh)).toContain('the jirallm plugin (0.40.4) and CLI (0.40.5) differ');
    expect(updateNotice('0.40.5', '0.40.5', 1000 + 25 * 3600 * 1000, f, noRefresh)).toContain('0.41.0 is available');
    expect(updateNotice('0.41.0', '0.41.0', 1000, f, noRefresh)).toBe('');
  });
});
