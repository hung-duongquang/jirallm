import { describe, expect, it } from 'vitest';
import { checksSignature, describePrChange, digestLog, jobIdFromUrl, latestRuns, notifiedPrs, parseHttp, renderPrStatus, snapshotOf, toCheck, type PrSnapshot, type PrState } from './prStatus.js';

const comment = (login: string, createdAt: string, body = 'b') => ({ author: { login }, createdAt, body, url: 'u' });

const state = (over: Partial<PrState> = {}): PrState => ({
  number: 7,
  title: 'ZOD-1: thing',
  url: 'https://github.com/o/r/pull/7',
  state: 'OPEN',
  isDraft: false,
  mergeable: 'MERGEABLE',
  reviewDecision: 'REVIEW_REQUIRED',
  headRefName: 'feature/ZOD-1-thing',
  baseRefName: 'main',
  headRefOid: 'abc123456789',
  lastPush: '2026-10-29T10:00:00Z',
  me: 'me',
  checks: [],
  reviews: [],
  threads: [],
  comments: [],
  ...over,
});

const snap = (over: Partial<PrSnapshot> = {}): PrSnapshot => ({
  number: 7, title: 't', key: 'ZOD-1', head: 'a', failed: [], pending: 0, reviews: {}, awaiting: 0, comments: 0, ...over,
});

describe('toCheck', () => {
  it('buckets check runs and status contexts', () => {
    expect(toCheck({ __typename: 'CheckRun', name: 'Unit', workflowName: 'CI', status: 'COMPLETED', conclusion: 'FAILURE' })).toEqual({ name: 'Unit (CI)', bucket: 'fail', url: undefined });
    expect(toCheck({ __typename: 'CheckRun', name: 'Unit', status: 'IN_PROGRESS', conclusion: '' }).bucket).toBe('pending');
    expect(toCheck({ __typename: 'CheckRun', name: 'Unit', status: 'COMPLETED', conclusion: 'SKIPPED' }).bucket).toBe('skip');
    expect(toCheck({ __typename: 'StatusContext', context: 'sonar', state: 'SUCCESS' }).bucket).toBe('pass');
    expect(toCheck({ __typename: 'StatusContext', context: 'sonar', state: 'PENDING' }).bucket).toBe('pending');
  });
});

describe('latestRuns', () => {
  it('keeps the latest run of a re-run check', () => {
    const runs = latestRuns([
      { name: 'Flag', workflowName: 'W', conclusion: 'FAILURE', startedAt: '2026-10-29T10:00:00Z' },
      { name: 'Flag', workflowName: 'W', conclusion: 'SUCCESS', startedAt: '2026-10-29T11:00:00Z' },
      { name: 'Unit', workflowName: 'W', conclusion: 'SUCCESS', startedAt: '2026-10-29T09:00:00Z' },
    ]);
    expect(runs.map((r) => `${r.name}:${r.conclusion}`)).toEqual(['Flag:SUCCESS', 'Unit:SUCCESS']);
  });
});

describe('jobIdFromUrl', () => {
  it('reads the job id of an Actions check', () => {
    expect(jobIdFromUrl('https://github.com/o/r/actions/runs/1/job/42')).toBe('42');
    expect(jobIdFromUrl('https://sonarcloud.io/x')).toBeUndefined();
  });
});

describe('digestLog', () => {
  it('keeps failures with their message, drops prefixes, colours, echoed script and noise', () => {
    const log = [
      'Unit\tstep\t2026-10-29T04:04:33.0Z   digest-mismatch: error',
      'Unit\tstep\t2026-10-29T04:05:55.0Z \x1b[36;1m  echo "::error::not set"\x1b[0m',
      'Unit\tstep\t2026-10-29T04:06:12.0Z \x1b[31mfailed\x1b[90m (try 1)\x1b[m Then it works',
      'Unit\tstep\t2026-10-29T04:06:12.1Z   Shouldly.ShouldAssertException : x',
      'Unit\tstep\t2026-10-29T04:06:12.2Z       but was actually 2',
      'Unit\tstep\t2026-10-29T04:06:12.3Z     at System.Runtime.Throw()',
      'Unit\tstep\t2026-10-29T04:06:12.4Z     at Tests.Hidden()',
      'Unit\tstep\t2026-10-29T04:07:00.0Z ##[error]Process completed with exit code 2.',
      'Unit\tstep\t2026-10-29T04:07:00.1Z   list-tests: failed',
    ].join('\n');
    expect(digestLog(log)).toEqual([
      'failed (try 1) Then it works',
      '  Shouldly.ShouldAssertException : x',
      '      but was actually 2',
      '##[error]Process completed with exit code 2.',
    ]);
  });

  it('falls back to the tail and caps the length', () => {
    const log = Array.from({ length: 50 }, (_, i) => `line ${i}`).join('\n');
    const out = digestLog(log, 5);
    expect(out).toEqual(['line 45', 'line 46', 'line 47', 'line 48', 'line 49']);
  });
});

describe('renderPrStatus', () => {
  it('shows failed jobs with their log, and only threads awaiting me', () => {
    const out = renderPrStatus(state({
      checks: [{ name: 'Unit (CI)', bucket: 'fail', url: 'https://github.com/o/r/actions/runs/1/job/42' }, { name: 'Lint', bucket: 'pass' }],
      reviews: [{ author: { login: 'linh' }, state: 'CHANGES_REQUESTED', submittedAt: '2026-10-29T11:00:00Z' }],
      threads: [
        { isResolved: false, isOutdated: false, path: 'a.cs', line: 3, first: comment('linh', '2026-10-29T11:00:00Z', 'rename this'), last: comment('linh', '2026-10-29T11:00:00Z'), count: 1 },
        { isResolved: false, isOutdated: false, path: 'b.cs', line: 4, first: comment('linh', '2026-10-29T11:00:00Z'), last: comment('me', '2026-10-29T12:00:00Z'), count: 2 },
        { isResolved: true, isOutdated: false, path: 'c.cs', line: 5, first: comment('linh', '2026-10-29T11:00:00Z'), last: comment('linh', '2026-10-29T11:00:00Z'), count: 1 },
      ],
      comments: [comment('linh', '2026-10-29T09:00:00Z', 'old'), comment('trung', '2026-10-29T11:30:00Z', 'please also X')],
    }), (job) => [`log of ${job}`]);
    expect(out).toContain('# PR #7 (ZOD-1): ZOD-1: thing');
    expect(out).toContain('## Checks: 1 failed, 0 pending, 1 passed, 0 skipped');
    expect(out).toContain('    log of 42');
    expect(out).toContain('- linh: CHANGES_REQUESTED');
    expect(out).toContain('## Unresolved threads: 2 (1 awaiting my reply or fix)');
    expect(out).toContain('  > rename this');
    expect(out).toContain('- 1 more where I replied last');
    expect(out).toContain('please also X');
    expect(out).not.toContain('old');
  });
});

describe('parseHttp', () => {
  it('splits gh api -i output', () => {
    const res = parseHttp('HTTP/2.0 200 OK\r\nLast-Modified: Thu, 29 Oct 2026 07:07:41 GMT\r\nX-Poll-Interval: 60\r\n\r\n[{"a":1}]');
    expect(res).toEqual({ status: 200, headers: { 'last-modified': 'Thu, 29 Oct 2026 07:07:41 GMT', 'x-poll-interval': '60' }, body: '[{"a":1}]' });
  });
});

describe('notifiedPrs', () => {
  const pr = (repo: string, n: number, type = 'PullRequest') => ({ repository: { full_name: repo }, subject: { type, url: `https://api.github.com/repos/${repo}/pulls/${n}` } });

  it('returns PRs of the repo from a 200 and the new Last-Modified', () => {
    const body = JSON.stringify([pr('o/r', 7), pr('o/r', 7), pr('o/other', 8), pr('o/r', 9, 'Issue')]);
    const gh = (_cwd: string, args: string[]) => {
      expect(args).toContain('If-Modified-Since: old');
      return `HTTP/2.0 200 OK\nLast-Modified: new\n\n${body}`;
    };
    expect(notifiedPrs(gh, '.', 'O/R', 'old', '2026-10-29T10:00:00Z')).toEqual({ prs: [7], lastModified: 'new' });
  });

  it('treats a 304 (gh exits 1) as nothing new and a failure as unknown', () => {
    const notModified = () => { throw Object.assign(new Error('exit 1'), { stdout: 'HTTP/2.0 304 Not Modified\n\n' }); };
    expect(notifiedPrs(notModified, '.', 'o/r', 'old', undefined)).toEqual({ prs: [], lastModified: 'old' });
    const broken = () => { throw new Error('network'); };
    expect(notifiedPrs(broken, '.', 'o/r', 'old', undefined)).toEqual({ lastModified: 'old' });
  });
});

describe('checksSignature', () => {
  it('changes with the head and with check buckets, not with order', () => {
    const a = { name: 'A', status: 'COMPLETED', conclusion: 'SUCCESS', __typename: 'CheckRun' };
    const b = { name: 'B', status: 'IN_PROGRESS', __typename: 'CheckRun' };
    expect(checksSignature('h', [a, b])).toBe(checksSignature('h', [b, a]));
    expect(checksSignature('h', [a, b])).not.toBe(checksSignature('h2', [a, b]));
    expect(checksSignature('h', [a, b])).not.toBe(checksSignature('h', [a, { ...b, status: 'COMPLETED', conclusion: 'FAILURE' }]));
  });
});

describe('snapshotOf', () => {
  it('summarises the state watch compares', () => {
    const s = snapshotOf(state({
      checks: [{ name: 'B', bucket: 'fail' }, { name: 'A', bucket: 'fail' }, { name: 'C', bucket: 'pending' }],
      reviews: [{ author: { login: 'linh' }, state: 'APPROVED', submittedAt: 't' }, { author: { login: 'me' }, state: 'COMMENTED', submittedAt: 't' }],
    }));
    expect(s).toMatchObject({ key: 'ZOD-1', failed: ['A', 'B'], pending: 1, reviews: { linh: 'APPROVED@t' } });
  });
});

describe('describePrChange', () => {
  it('reports only news on a first sighting', () => {
    expect(describePrChange(undefined, snap())).toBeUndefined();
    expect(describePrChange(undefined, snap({ failed: ['Unit'] }))).toBe('PR #7 (ZOD-1): CI failed: Unit — jirallm pr-status 7');
  });

  it('reports new failures, green after pending or failing, reviews, threads and comments', () => {
    expect(describePrChange(snap({ pending: 3 }), snap({ failed: ['Unit'] }))).toContain('CI failed: Unit');
    expect(describePrChange(snap({ failed: ['Unit'] }), snap({ failed: ['Unit'] }))).toBeUndefined();
    expect(describePrChange(snap({ failed: ['Unit'] }), snap({ head: 'b', failed: ['Unit'] }))).toContain('CI failed: Unit');
    expect(describePrChange(snap({ pending: 2 }), snap())).toContain('CI green');
    expect(describePrChange(snap({ pending: 2 }), snap({ pending: 1 }))).toBeUndefined();
    expect(describePrChange(snap(), snap({ reviews: { linh: 'APPROVED@t' } }))).toContain('linh reviewed: APPROVED');
    expect(describePrChange(snap(), snap({ awaiting: 2, comments: 1 }))).toBe('PR #7 (ZOD-1): 2 new review thread(s)/repl(ies) awaiting me; 1 new comment(s) — jirallm pr-status 7');
  });
});
