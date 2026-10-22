import { describe, expect, it } from 'vitest';
import { describeChange, frontmatter } from './watch.js';

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
