import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ResolvedProfile } from '../../lib/config.js';
import { adfText, forMeLine, forMeRound, mentionsIn, ticketPrompt, webUrl, type ForMeItem } from './forMe.js';

const ME = '5f1-me';
const T = Date.parse('2026-11-25T08:00:00Z');
const adf = (...content: unknown[]) => ({ type: 'doc', content: [{ type: 'paragraph', content }] });

describe('for me', () => {
  it('finds comments since that mention me, not my own or older ones', () => {
    const issues = [
      {
        key: 'ZOD-1',
        fields: {
          summary: 'Export',
          comment: {
            comments: [
              { id: '1', created: new Date(T + 1000).toISOString(), author: { accountId: 'ba', displayName: 'Phuong' }, body: adf({ type: 'mention', attrs: { id: ME, text: '@Hung' } }, { type: 'text', text: ' can you check?' }) },
              { id: '2', created: new Date(T + 2000).toISOString(), author: { accountId: ME, displayName: 'Hung' }, body: adf({ type: 'mention', attrs: { id: ME, text: '@Hung' } }) },
              { id: '3', created: new Date(T - 1000).toISOString(), author: { accountId: 'ba', displayName: 'Phuong' }, body: adf({ type: 'mention', attrs: { id: ME, text: '@Hung' } }) },
              { id: '4', created: new Date(T + 3000).toISOString(), author: { accountId: 'ba', displayName: 'Phuong' }, body: adf({ type: 'text', text: 'no mention' }) },
              { id: '5', created: new Date(T + 4000).toISOString(), author: { accountId: 'ba', displayName: 'Anne' }, body: `[~accountid:${ME}] wiki style` },
            ],
          },
        },
      },
    ];
    const found = mentionsIn(issues, ME, T, 'https://jira.example');
    expect(found.map((f) => f.id)).toEqual(['jira-comment:1', 'jira-comment:5']);
    expect(forMeLine(found[0])).toBe('ZOD-1: Phuong mentioned you in a comment: "@Hung can you check?"');
    expect(found[0].url).toBe('https://jira.example/browse/ZOD-1?focusedCommentId=1');
    expect(found[1].text).toBe('@… wiki style');
  });

  it('reads ADF as plain text and GitHub API links as web links', () => {
    expect(adfText(adf({ type: 'text', text: 'a' }, { type: 'hardBreak' }, { type: 'text', text: 'b' })).trim()).toBe('a b');
    expect(webUrl('https://api.github.com/repos/o/r/pulls/12', 'o/r')).toBe('https://github.com/o/r/pull/12');
    expect(webUrl('https://api.github.com/repos/o/r/issues/3', 'o/r')).toBe('https://github.com/o/r/issues/3');
    expect(webUrl(null, 'o/r')).toBe('https://github.com/o/r');
  });

  it('starts quiet, then tells each item once, and keeps the clock when a source fails', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'forme-'));
    const profile = {} as ResolvedProfile;
    const item = (id: string, at: number): ForMeItem => ({ id, kind: 'jira-mention', key: 'ZOD-1', from: 'A', title: 't', text: 'x', url: 'u', at });
    let calls: number[] = [];
    const ok = async (since: number) => {
      calls.push(since);
      return [item('a', T + 10), item('b', T + 20)];
    };
    expect(await forMeRound(dir, profile, { now: T, sources: [ok] })).toEqual({ items: [], errors: [] });
    expect(calls).toEqual([]); // the first round only starts the clock

    const r1 = await forMeRound(dir, profile, { now: T + 60_000, sources: [ok] });
    expect(r1.items.map((i) => i.id)).toEqual(['a', 'b']);
    expect(calls).toEqual([T - 60_000]);

    calls = [];
    const failing = async () => Promise.reject(new Error('Confluence: 503'));
    const r2 = await forMeRound(dir, profile, { now: T + 120_000, sources: [ok, failing] });
    expect(r2.items).toEqual([]); // told already
    expect(r2.errors).toEqual(['Confluence: 503']);
    calls = [];
    await forMeRound(dir, profile, { now: T + 180_000, sources: [ok] });
    expect(calls).toEqual([T]); // the failed round did not move the clock
  });

  it('asks the new session to read the ticket and wait', () => {
    expect(ticketPrompt('ZOD-9')).toMatch(/^ZOD-9 was just assigned to me\.[\s\S]*Don't start work yet/);
  });
});
