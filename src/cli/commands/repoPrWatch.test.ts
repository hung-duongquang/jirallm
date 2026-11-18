import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { followThreadLinks, prItems, repoPrChanges, splitByRepo } from './repoPrWatch.js';
import { concerns, prChanges } from './watch.js';

const ITEM = 'pr/topicus/aws/884';

/** A fake `gh` answering for one PR in another repo whose state the test changes between rounds. */
function fakeGh() {
  const state = { state: 'OPEN', reviews: [] as unknown[], calls: [] as string[] };
  const gh = (_cwd: string, args: string[]) => {
    state.calls.push(args.slice(0, 3).join(' '));
    if (args[0] === 'api') return JSON.stringify({ data: { viewer: { login: 'me' }, repository: { pullRequest: { reviewThreads: { nodes: [] } } } } });
    return JSON.stringify({
      number: 884, title: 'ZOD-3243: bucket access', url: 'https://github.com/topicus/aws/pull/884', state: state.state, isDraft: false,
      mergeable: 'MERGEABLE', reviewDecision: '', headRefName: 'feature/ZOD-3243-bucket', baseRefName: 'main', headRefOid: 'h1',
      latestReviews: state.reviews, comments: [], commits: [{ committedDate: '2026-11-18T01:00:00Z' }], author: { login: 'me' },
      statusCheckRollup: [{ __typename: 'CheckRun', name: 'plan', status: 'COMPLETED', conclusion: 'SUCCESS' }],
    });
  };
  return { state, gh };
}

describe('prItems', () => {
  it('names the linked PRs with their repo', () => {
    expect(prItems('<https://github.com/topicus/aws/pull/884|aws #884> and github.com/o/octo/pull/330/files, again https://github.com/topicus/aws/pull/884')).toEqual([
      ITEM,
      'pr/o/octo/330',
    ]);
  });
});

describe('splitByRepo', () => {
  it('gives the numbers of the watched repo to prChanges and keeps the rest', () => {
    expect(splitByRepo([ITEM, 'pr/O/R/12', 'pr/12', 'run/o/r/1'], 'o/r')).toEqual({ local: [12], other: [ITEM] });
    expect(splitByRepo([ITEM], undefined)).toEqual({ local: [], other: [ITEM] });
  });
});

describe('repoPrChanges', () => {
  it('reports the approval and the merge of a PR in another repo, then stops asking', () => {
    const out = mkdtempSync(path.join(tmpdir(), 'jl-repoprs-'));
    const f = fakeGh();
    expect(repoPrChanges(out, false, [ITEM], f.gh)).toEqual([]);
    expect(f.state.calls[0]).toBe('pr view https://github.com/topicus/aws/pull/884');
    f.state.reviews = [{ author: { login: 'trung' }, state: 'APPROVED', submittedAt: '2026-11-18T02:57:22Z' }];
    expect(repoPrChanges(out, false, [ITEM], f.gh).map((c) => c.line)).toEqual([
      'PR #884 (topicus/aws, ZOD-3243): trung reviewed: APPROVED — jirallm pr-status 884',
    ]);
    f.state.state = 'MERGED';
    expect(repoPrChanges(out, false, [ITEM], f.gh).map((c) => c.line)).toEqual(['PR #884 (topicus/aws, ZOD-3243): merged']);
    const calls = f.state.calls.length;
    expect(repoPrChanges(out, false, [ITEM], f.gh)).toEqual([]);
    expect(f.state.calls).toHaveLength(calls);
  });

  it('a failing look is an error line and keeps the last state', () => {
    const out = mkdtempSync(path.join(tmpdir(), 'jl-repoprs-'));
    const changes = repoPrChanges(out, false, [ITEM], () => { throw new Error('HTTP 404'); });
    expect(changes).toEqual([{ line: 'PR #884 (topicus/aws): status check failed (HTTP 404)', error: true }]);
  });
});

describe('concerns for a PR link', () => {
  it('matches its own repo, and the watched repo\'s line without a repo, not the same number elsewhere', () => {
    expect(concerns('PR #884 (topicus/aws, ZOD-3243): merged', [ITEM])).toBe(true);
    expect(concerns('PR #884 (o/octo): merged', [ITEM])).toBe(false);
    expect(concerns('PR #884 (ZOD-1): CI green', [ITEM])).toBe(true);
    expect(concerns('PR #8840 (topicus/aws): merged', [ITEM])).toBe(false);
  });
});

describe('prChanges', () => {
  it('follows a PR linked into the watched repo like a named one', () => {
    const out = mkdtempSync(path.join(tmpdir(), 'jl-repoprs-local-'));
    const calls: string[] = [];
    const gh = (_cwd: string, args: string[]) => {
      calls.push(args.slice(0, 3).join(' '));
      if (args[0] === 'repo') return 'o/r';
      if (args[0] === 'api' && args[1] === '-i') return 'HTTP/2.0 304 Not Modified\r\n\r\n';
      if (args[0] === 'api') return JSON.stringify({ data: { viewer: { login: 'me' }, repository: { pullRequest: { reviewThreads: { nodes: [] } } } } });
      if (args[1] === 'list' && args.includes('@me')) return '[]';
      if (args[1] === 'list') return JSON.stringify([{ number: 12, title: 'x', headRefName: 'b', headRefOid: 'h', statusCheckRollup: [] }]);
      return JSON.stringify({
        number: 12, title: 'x', url: 'https://github.com/o/r/pull/12', state: 'OPEN', isDraft: false, mergeable: 'MERGEABLE', reviewDecision: '',
        headRefName: 'b', baseRefName: 'main', headRefOid: 'h', latestReviews: [], comments: [], commits: [], author: { login: 'trung' }, statusCheckRollup: [],
      });
    };
    prChanges('.', out, false, gh, { keys: [], prs: [], repoPrs: ['pr/O/R/12', ITEM] });
    expect(calls).toContain('pr view 12');
    expect(Object.keys(JSON.parse(readFileSync(path.join(out, '.prs.json'), 'utf8')).prs)).toEqual(['12']);
  });
});

describe('followThreadLinks', () => {
  it('adds PR and run links of later replies in a followed thread, not those outside the thread', () => {
    const out = mkdtempSync(path.join(tmpdir(), 'jl-thread-'));
    const sessions = mkdtempSync(path.join(tmpdir(), 'jl-thread-s-'));
    mkdirSync(path.join(out, 'slack', 'c1-17'), { recursive: true });
    writeFileSync(
      path.join(out, 'slack', 'c1-17', 'thread.md'),
      ['---', 'lastTs: "17"', '---', '', 'approve <https://github.com/topicus/aws/pull/884|aws #884> pls', 'https://github.com/o/r/actions/runs/4',
        '# In the channel, outside the thread', '', 'https://github.com/o/r/pull/9999'].join('\n')
    );
    writeFileSync(path.join(sessions, 'live.follow'), 'slack/C1-17\nrun/o/r/4');
    writeFileSync(path.join(sessions, 'live.monitor'), String(process.pid));
    writeFileSync(path.join(sessions, 'gone.follow'), 'slack/c1-17');
    followThreadLinks(out, sessions);
    followThreadLinks(out, sessions);
    expect(readFileSync(path.join(sessions, 'live.follow'), 'utf8')).toBe(`slack/C1-17\nrun/o/r/4\n${ITEM}`);
    expect(readFileSync(path.join(sessions, 'gone.follow'), 'utf8')).toBe('slack/c1-17');
  });
});
