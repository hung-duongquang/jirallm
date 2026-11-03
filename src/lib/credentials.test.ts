import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const store = new Map<string, string>();
const k = (s: string, a: string) => `${s}::${a}`;

vi.mock('@napi-rs/keyring', () => {
  class Entry {
    private key: string;
    constructor(service: string, account: string) {
      this.key = k(service, account);
    }
    getPassword(): string | null {
      return store.get(this.key) ?? null;
    }
    setPassword(password: string): void {
      store.set(this.key, password);
    }
    deletePassword(): boolean {
      return store.delete(this.key);
    }
  }
  return { Entry };
});

import {
  getToken,
  getTokenSource,
  setToken,
  removeToken,
  hasStoredToken,
  __test,
} from './credentials.js';

beforeEach(() => {
  store.clear();
  __test.resetKeytarCache();
});

afterEach(() => {
  store.clear();
});

describe('credentials', () => {
  it('round-trips token via keychain', async () => {
    await setToken('work', 'tok-1');
    expect(await hasStoredToken('work')).toBe(true);
    expect(await getToken('work')).toBe('tok-1');
    expect(await removeToken('work')).toBe(true);
    expect(await getToken('work')).toBeUndefined();
  });

  it('returns undefined when no keychain entry exists', async () => {
    expect(await getToken('anything')).toBeUndefined();
  });

  describe('env fallback', () => {
    afterEach(() => {
      delete process.env.JIRALLM_API_TOKEN;
      delete process.env.JIRALLM_API_TOKEN_WORK;
    });

    it('falls back to JIRALLM_API_TOKEN when keyring misses', async () => {
      process.env.JIRALLM_API_TOKEN = 'env-tok';
      expect(await getToken('work')).toBe('env-tok');
    });

    it('prefers the keyring value over the env var', async () => {
      process.env.JIRALLM_API_TOKEN = 'env-tok';
      await setToken('work', 'keyring-tok');
      expect(await getToken('work')).toBe('keyring-tok');
    });

    it('treats an empty-string keyring value as a miss and falls back to the env var', async () => {
      process.env.JIRALLM_API_TOKEN = 'env-tok';
      store.set(k('jirallm', 'work:api_token'), '');
      expect(await getToken('work')).toBe('env-tok');
    });

    it('prefers the org-specific env var over the generic one', async () => {
      process.env.JIRALLM_API_TOKEN = 'generic-tok';
      process.env.JIRALLM_API_TOKEN_WORK = 'work-tok';
      expect(await getToken('work')).toBe('work-tok');
    });
  });

  describe('getTokenSource', () => {
    afterEach(() => {
      delete process.env.JIRALLM_API_TOKEN;
      delete process.env.JIRALLM_API_TOKEN_WORK;
    });

    it('returns "keychain" when the keyring holds a non-empty token', async () => {
      await setToken('work', 'keyring-tok');
      expect(await getTokenSource('work')).toBe('keychain');
    });

    it('returns "env" when the keyring is missing but a generic env var is set', async () => {
      process.env.JIRALLM_API_TOKEN = 'env-tok';
      expect(await getTokenSource('work')).toBe('env');
    });

    it('returns "env" when the keyring value is empty but a generic env var is set', async () => {
      process.env.JIRALLM_API_TOKEN = 'env-tok';
      store.set(k('jirallm', 'work:api_token'), '');
      expect(await getTokenSource('work')).toBe('env');
    });

    it('recognizes an org-specific env var as "env"', async () => {
      process.env.JIRALLM_API_TOKEN_WORK = 'work-tok';
      expect(await getTokenSource('work')).toBe('env');
    });

    it('returns null when neither the keyring nor an env var provides a token', async () => {
      expect(await getTokenSource('work')).toBeNull();
    });
  });
});

describe('long secrets (Windows Credential Manager limit)', () => {
  it('splits a long secret over several entries and reads it back', async () => {
    const { getSecret, setSecret, removeSecret } = await import('./credentials.js');
    const long = 'x'.repeat(2500) + 'end';
    await setSecret('sharepoint:cookie', long);
    expect(store.get(k('jirallm', 'sharepoint:cookie'))).toBe('jirallm-chunks:3');
    expect([...store.values()].every((v) => v.length <= 1000)).toBe(true);
    expect(await getSecret('sharepoint:cookie', 'NOPE')).toBe(long);

    await setSecret('sharepoint:cookie', 'short');
    expect(store.size).toBe(1);
    expect(await getSecret('sharepoint:cookie', 'NOPE')).toBe('short');

    await setSecret('sharepoint:cookie', long);
    expect(await removeSecret('sharepoint:cookie')).toBe(true);
    expect(store.size).toBe(0);
  });
});
