import { describe, expect, it } from 'vitest';
import { renderReviewHistory, type ReviewData } from './reviewHistory.js';

const c = (login: string, body: string, createdAt = '2026-11-01T10:00:00Z') => ({ author: { login }, body, createdAt, url: `https://pr/${body.length}` });

const data: ReviewData = {
  me: 'me',
  number: 3093,
  title: 'ZOD-3733: change RHO debtor',
  url: 'https://github.com/o/r/pull/3093',
  state: 'OPEN',
  author: 'linh',
  headRefName: 'feature/ZOD-3733-change-debtor',
  headOid: 'cccccccccccc',
  reviews: [
    { author: { login: 'me' }, state: 'CHANGES_REQUESTED', body: 'see threads', submittedAt: '2026-11-02T10:00:00Z', commit: { oid: 'aaaaaaaaaaaa' } },
    { author: { login: 'trung' }, state: 'APPROVED', body: '', submittedAt: '2026-11-03T10:00:00Z', commit: { oid: 'aaaaaaaaaaaa' } },
  ],
  threads: [
    { isResolved: true, isOutdated: true, path: 'A.cs', line: null, originalLine: 10, comments: { nodes: [c('me', 'rename this'), c('linh', 'done')] } },
    { isResolved: false, isOutdated: false, path: 'B.cs', line: 5, originalLine: 5, comments: { nodes: [c('me', 'missing null check'), c('linh', 'cannot be null, see BA')] } },
    { isResolved: false, isOutdated: false, path: 'C.cs', line: 7, originalLine: 7, comments: { nodes: [c('me', 'add a test')] } },
    { isResolved: false, isOutdated: false, path: 'D.cs', line: 1, originalLine: 1, comments: { nodes: [c('trung', 'not mine')] } },
  ],
  comments: [c('me', 'overall fine', '2026-11-02T10:01:00Z'), c('linh', 'thanks, fixed', '2026-11-04T10:00:00Z'), c('github-actions[bot]', 'coverage', '2026-11-04T11:00:00Z')],
  commits: [
    { oid: 'aaaaaaaaaaaa', messageHeadline: 'first', committedDate: '2026-11-01T09:00:00Z' },
    { oid: 'bbbbbbbbbbbb', messageHeadline: 'fix review', committedDate: '2026-11-04T09:00:00Z' },
    { oid: 'cccccccccccc', messageHeadline: 'add test', committedDate: '2026-11-05T09:00:00Z' },
  ],
};

describe('renderReviewHistory', () => {
  const text = renderReviewHistory(data, { files: [{ filename: 'C.cs', additions: 3, deletions: 1 }] }, ['- 2026-11-03: PR #3093: debtor reset intended']);

  it('lists my reviews only', () => {
    expect(text).toContain('# Review history: PR #3093 (ZOD-3733)');
    expect(text).toContain('## My reviews: 1');
    expect(text).toContain('**CHANGES_REQUESTED** on aaaaaaaaa: see threads');
    expect(text).not.toContain('trung: APPROVED');
  });

  it('groups my threads by outcome and skips threads I am not in', () => {
    expect(text).toContain('## Review threads I took part in: 3');
    expect(text).toMatch(/### Answered by someone else[^\n]*: 1\n\n- B\.cs:5[^\n]*\n {2}> me: missing null check\n {2}> linh: cannot be null, see BA/);
    expect(text).toMatch(/### Still waiting on the author[^\n]*: 1\n\n- C\.cs:7/);
    expect(text).toMatch(/### Resolved[^\n]*: 1\n\n- A\.cs:10 \(outdated[^\n]*\n {2}> me: rename this\n {2}> linh \(last\): done/);
    expect(text).not.toContain('D.cs');
  });

  it('shows replies to my comments without bots', () => {
    expect(text).toContain('- (reply) linh');
    expect(text).not.toContain('coverage');
  });

  it('lists commits and files since my last reviewed commit, and the notes', () => {
    expect(text).toContain('): 2 commit(s)');
    expect(text).toContain('bbbbbbbbb');
    expect(text).not.toMatch(/aaaaaaaaa \d{4}/);
    expect(text).toContain('- C.cs +3 -1');
    expect(text).toContain('git diff aaaaaaaaaaaa cccccccccccc');
    expect(text).toContain('- 2026-11-03: PR #3093: debtor reset intended');
  });

  it('falls back to dates when my reviewed commit was rebased away', () => {
    const rebased = renderReviewHistory({ ...data, reviews: [{ ...data.reviews[0]!, commit: { oid: 'gone00000000' } }] }, undefined, []);
    expect(rebased).toContain('no longer on the branch');
    expect(rebased).toContain('): 2 commit(s)');
  });

  it('says when there is no earlier review', () => {
    expect(renderReviewHistory({ ...data, reviews: [], threads: [], comments: [] }, undefined, [])).toContain('none (first review');
  });
});
