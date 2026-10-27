import { describe, expect, it } from 'vitest';
import { changeEntries, commentEditedSince, describeChange, frontmatter } from './watch.js';

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

describe('commentEditedSince', () => {
  const issue = (...updated: string[]) => ({
    key: 'ZOD-1',
    fields: { comment: { comments: updated.map((u) => ({ created: '2026-10-26T09:00:00.000+0100', updated: u })) } },
  });

  it('flags a comment edited after the export, although the issue updated did not move', () => {
    const known = { key: 'ZOD-1', updatedAt: '2026-10-27T04:58:01.948+0100' };
    expect(commentEditedSince(known, issue('2026-10-27T05:06:14.152+0100'))).toBe(true);
  });

  it('compares with commentsUpdatedAt when the export has it', () => {
    const known = {
      key: 'ZOD-1',
      updatedAt: '2026-10-27T04:00:00.000+0100',
      commentsUpdatedAt: '2026-10-27T05:29:40.860+0100',
    };
    expect(commentEditedSince(known, issue('2026-10-27T05:29:40.860+0100', '2026-10-26T10:00:00.000+0100'))).toBe(false);
    expect(commentEditedSince(known, issue('2026-10-27T06:29:40.860+0200'))).toBe(false);
  });

  it('ignores issues without comments', () => {
    expect(commentEditedSince({ key: 'ZOD-1', updatedAt: '2026-10-27T04:00:00.000+0100' }, { key: 'ZOD-1', fields: {} })).toBe(false);
  });
});
