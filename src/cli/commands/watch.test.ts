import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { changeEntries, commentsChangedSince, describeChange, frontmatter, prChanges } from './watch.js';

const task = (status: string, comments: string) =>
  `---\nkey: "ZOD-1"\nstatus: "${status}"\nupdatedAt: "2026-10-22T04:35:11.422+0200"\n---\n\n# ZOD-1\n\n## Description\n\nSame.\n\n## Comments\n\n${comments}\n`;

describe('frontmatter', () => {
  it('reads top-level and nested keys without quotes', () => {
    expect(frontmatter('---\nconfluence:\n  id: "42"\n  version: 3\n---\n# x')).toEqual({ id: '42', version: '3' });
  });
});

describe('describeChange', () => {
  it('names a new file', () => {
    expect(describeChange(null, task('To Do', ''))).toBe('new');
  });

  it('lists changed fields and sections, ignoring updatedAt', () => {
    expect(describeChange(task('To Do', 'a'), task('In Progress', 'a\nb').replace('04:35', '05:00'))).toBe(
      'status: To Do → In Progress; Comments changed'
    );
  });

  it('marks added and removed fields with ∅', () => {
    expect(describeChange(task('To Do', 'a'), task('To Do', 'a').replace('status: "To Do"\n', 'status: "To Do"\nlabels: ["X"]\n'))).toBe(
      'labels: ∅ → ["X"]'
    );
  });
});

describe('changeEntries', () => {
  it('splits CHANGES.md into stamped entries with their list lines', () => {
    expect(changeEntries('\n## 2026-10-22 10:00\n\n- ZOD-1: new\n- ZOD-2: status: A → B\n\n## 2026-10-22 10:15\n\n- ZOD-1: Comments changed\n')).toEqual([
      { stamp: '2026-10-22 10:00', lines: ['- ZOD-1: new', '- ZOD-2: status: A → B'] },
      { stamp: '2026-10-22 10:15', lines: ['- ZOD-1: Comments changed'] },
    ]);
  });
});

describe('commentsChangedSince', () => {
  const issue = (...updated: string[]) => ({
    key: 'ZOD-1',
    fields: { comment: { comments: updated.map((u) => ({ created: '2026-10-26T09:00:00.000+0100', updated: u })) } },
  });

  it('flags a comment edited after the export, although the issue updated did not move', () => {
    const known = { key: 'ZOD-1', updatedAt: '2026-10-27T04:58:01.948+0100' };
    expect(commentsChangedSince(known, issue('2026-10-27T05:06:14.152+0100'))).toBe(true);
  });

  it('compares with commentsUpdatedAt when the export has it', () => {
    const known = {
      key: 'ZOD-1',
      updatedAt: '2026-10-27T04:00:00.000+0100',
      commentsUpdatedAt: '2026-10-27T05:29:40.860+0100',
    };
    expect(commentsChangedSince(known, issue('2026-10-27T05:29:40.860+0100', '2026-10-26T10:00:00.000+0100'))).toBe(false);
    expect(commentsChangedSince(known, issue('2026-10-27T06:29:40.860+0200'))).toBe(false);
  });

  it('ignores issues without comments', () => {
    expect(commentsChangedSince({ key: 'ZOD-1', updatedAt: '2026-10-27T04:00:00.000+0100' }, { key: 'ZOD-1', fields: {} })).toBe(false);
  });
});

describe('commentsChangedSince: deletions', () => {
  const comments = (n: number) => ({
    key: 'ZOD-1',
    fields: {
      comment: {
        total: n,
        comments: Array.from({ length: n }, () => ({ created: '2026-10-26T09:00:00.000+0100', updated: '2026-10-26T09:00:00.000+0100' })),
      },
    },
  });
  const known = { key: 'ZOD-1', updatedAt: '2026-10-27T05:00:00.000+0100', commentCount: 4 };

  it('flags a deleted comment by the lower count', () => {
    expect(commentsChangedSince(known, comments(3))).toBe(true);
  });

  it('flags the last comment being deleted', () => {
    expect(commentsChangedSince({ ...known, commentCount: 1 }, comments(0))).toBe(true);
  });

  it('does not flag an unchanged count, nor exports without commentCount', () => {
    expect(commentsChangedSince(known, comments(4))).toBe(false);
    expect(commentsChangedSince({ key: 'ZOD-1', updatedAt: known.updatedAt }, comments(3))).toBe(false);
  });
});

describe('prChanges', () => {
  const view = (failed: boolean) => JSON.stringify({
    number: 7, title: 'ZOD-1: x', url: 'https://github.com/o/r/pull/7', state: 'OPEN', isDraft: false, mergeable: 'MERGEABLE', reviewDecision: '',
    headRefName: 'feature/ZOD-1-x', baseRefName: 'main', headRefOid: 'h1', latestReviews: [], comments: [], commits: [{ committedDate: '2026-10-29T10:00:00Z' }],
    statusCheckRollup: [{ __typename: 'CheckRun', name: 'Unit', status: 'COMPLETED', conclusion: failed ? 'FAILURE' : 'SUCCESS' }],
  });
  const fakeGh = (opts: { failed: boolean; notifications: string }) => {
    const calls: string[] = [];
    const gh = (_cwd: string, args: string[]) => {
      calls.push(args.slice(0, 2).join(' '));
      if (args[0] === 'repo') return 'o/r';
      if (args[0] === 'api' && args[1] === '-i') return opts.notifications;
      if (args[0] === 'api') return JSON.stringify({ data: { viewer: { login: 'me' }, repository: { pullRequest: { reviewThreads: { nodes: [] } } } } });
      if (args[1] === 'list') return JSON.stringify([{ number: 7, headRefOid: 'h1', statusCheckRollup: JSON.parse(view(opts.failed)).statusCheckRollup }]);
      return view(opts.failed);
    };
    return { gh, calls };
  };

  it('reads a PR in full only when its checks changed or it got a notification', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'prs-'));
    const first = fakeGh({ failed: true, notifications: 'HTTP/2.0 200 OK\nLast-Modified: t1\n\n[]' });
    expect(prChanges('.', dir, false, first.gh).map((c) => c.line)).toEqual(['PR #7 (ZOD-1): CI failed: Unit — jirallm pr-status 7']);

    const quiet = fakeGh({ failed: true, notifications: 'HTTP/2.0 304 Not Modified\n\n' });
    expect(prChanges('.', dir, false, quiet.gh)).toEqual([]);
    expect(quiet.calls).toEqual(['api -i', 'pr list']);

    const green = fakeGh({ failed: false, notifications: 'HTTP/2.0 304 Not Modified\n\n' });
    expect(prChanges('.', dir, false, green.gh)).toEqual([{ line: 'PR #7 (ZOD-1): CI green — jirallm pr-status 7', url: 'https://github.com/o/r/pull/7' }]);

    const review = fakeGh({ failed: false, notifications: 'HTTP/2.0 200 OK\nLast-Modified: t2\n\n[{"repository":{"full_name":"o/r"},"subject":{"type":"PullRequest","url":"https://api.github.com/repos/o/r/pulls/7"}}]' });
    prChanges('.', dir, false, review.gh);
    expect(review.calls).toContain('pr view');
  });
});
