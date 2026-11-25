import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { finishedItems, itemsNamed, RETIRE_AFTER_MS, retireFollows, unfollow } from './follows.js';
import { mergedTicketHint } from './watch.js';

const dirs = () => {
  const root = mkdtempSync(path.join(tmpdir(), 'jl-follows-'));
  const out = path.join(root, 'out');
  const sessions = path.join(root, 'sessions');
  mkdirSync(out);
  mkdirSync(sessions);
  return { out, sessions };
};

describe('finishedItems', () => {
  it('names merged PRs, other-repo PRs that closed, completed runs and closed below windows', () => {
    const { out } = dirs();
    writeFileSync(path.join(out, '.prs.json'), JSON.stringify({ meta: { repo: 'o/app' }, prs: {}, finished: { 12: 'merged' } }));
    writeFileSync(path.join(out, '.repo-prs.json'), JSON.stringify({ 'pr/o/aws/5': { state: 'MERGED' }, 'pr/o/aws/6': { state: 'OPEN' } }));
    writeFileSync(path.join(out, '.runs.json'), JSON.stringify({ 'run/o/aws/44': { status: 'completed' }, 'run/o/aws/45': { status: 'waiting' } }));
    writeFileSync(path.join(out, '.slack-below.json'), JSON.stringify({ 'c1-17': { newest: '1', closed: true }, 'c2-18': { newest: '1' } }));
    expect(finishedItems(out).sort()).toEqual(['below/c1-17', 'pr/12', 'pr/o/app/12', 'pr/o/aws/5', 'run/o/aws/44']);
  });
});

describe('retireFollows', () => {
  it('drops a finished item from every session an hour after it was first seen finished', () => {
    const { sessions } = dirs();
    writeFileSync(path.join(sessions, 'a.follow'), 'slack/c1-17\npr/12\nrun/o/aws/44');
    writeFileSync(path.join(sessions, 'b.follow'), 'PR/12');
    const t0 = 1_000_000;
    expect(retireFollows(['pr/12'], sessions, t0)).toEqual([]);
    expect(retireFollows(['pr/12'], sessions, t0 + RETIRE_AFTER_MS - 1)).toEqual([]);
    expect(retireFollows(['pr/12'], sessions, t0 + RETIRE_AFTER_MS).sort()).toEqual(['a: pr/12', 'b: PR/12']);
    expect(readFileSync(path.join(sessions, 'a.follow'), 'utf8')).toBe('slack/c1-17\nrun/o/aws/44');
    expect(readFileSync(path.join(sessions, 'b.follow'), 'utf8')).toBe('');
  });
});

describe('unfollow', () => {
  it('drops what a link or "PR #N" names: a Slack link ends the thread and its below', () => {
    const { sessions } = dirs();
    writeFileSync(path.join(sessions, 's.follow'), 'slack/c1-1700000000000001\nbelow/c1-1700000000000001\npr/o/r/12\npr/3\nrun/o/aws/44');
    expect(unfollow('s', ['https://ws.slack.com/archives/C1/p1700000000000001'], sessions).removed).toEqual([
      'slack/c1-1700000000000001',
      'below/c1-1700000000000001',
    ]);
    const { removed, left } = unfollow('s', ['PR #12', 'https://github.com/o/aws/actions/runs/44'], sessions);
    expect(removed).toEqual(['pr/o/r/12', 'run/o/aws/44']);
    expect(left).toEqual(['pr/3']);
    expect(unfollow('s', ['#99'], sessions).removed).toEqual([]);
    // A reply link names its thread (thread_ts), not the reply.
    writeFileSync(path.join(sessions, 's.follow'), 'slack/c1-1700000000000001');
    expect(unfollow('s', ['https://ws.slack.com/archives/C1/p1700000000000009?thread_ts=1700000000.000001&cid=C1'], sessions).removed).toEqual(['slack/c1-1700000000000001']);
  });

  it('reads the items a target names', () => {
    expect(itemsNamed('https://github.com/o/r/pull/7')).toEqual(['pr/o/r/7']);
    expect(itemsNamed('pr 7')).toEqual(['pr/7', 'pr/*/7']);
    expect(itemsNamed('below/c1-17')).toEqual(['below/c1-17']);
  });
});

describe('mergedTicketHint', () => {
  it('asks to move the ticket on only when its export is not past the merge yet', () => {
    const { out } = dirs();
    mkdirSync(path.join(out, 'zod-1'));
    writeFileSync(path.join(out, 'zod-1', 'task.md'), '---\nkey: "ZOD-1"\nstatus: "In Review"\n---\n');
    expect(mergedTicketHint(out, 'ZOD-1')).toMatch(/^; ZOD-1 is still In Review \(last export\): if this PR finishes it, offer to move the ticket on/);
    writeFileSync(path.join(out, 'zod-1', 'task.md'), '---\nkey: "ZOD-1"\nstatus: "Resolved"\n---\n');
    expect(mergedTicketHint(out, 'ZOD-1')).toBe('');
    expect(mergedTicketHint(out, 'ZOD-2')).toBe('');
    expect(mergedTicketHint(out, undefined)).toBe('');
  });
});
