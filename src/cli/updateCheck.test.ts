import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchLatestVersion, isNewer, RELEASE_PACKAGE_JSON_URL, updateCheckDisabled } from './updateCheck.js';

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
