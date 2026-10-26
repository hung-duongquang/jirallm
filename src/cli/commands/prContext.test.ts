import { describe, expect, it } from 'vitest';
import { jiraEventsSince, keyFromBranch, lineDiff, workStart } from './prContext.js';

const history = (created: string, field: string, from: string | null, to: string | null) => ({
  author: { displayName: 'Ann' },
  created,
  items: [{ field, fromString: from, toString: to }],
});

describe('keyFromBranch', () => {
  it('finds the key in a branch name', () => {
    expect(keyFromBranch('feature/zod-3825-held-credit')).toBe('ZOD-3825');
    expect(keyFromBranch('main')).toBeUndefined();
  });
});

describe('lineDiff', () => {
  it('lists removed then added lines', () => {
    expect(lineDiff('a\nb\nc', 'a\nc\nd')).toEqual(['  - b', '  + d']);
  });
});

describe('workStart', () => {
  it('prefers the first commit, else the last move to In Progress', () => {
    const h = [history('2026-10-01T09:00:00.000+0200', 'status', 'To Do', 'In Progress'), history('2026-10-05T09:00:00.000+0200', 'status', 'To Do', 'In Progress')];
    expect(workStart([{ hash: 'abcdef123', date: '2026-10-03T10:00:00+02:00', subject: 's' }], h)?.why).toBe('first commit abcdef12');
    expect(workStart([], h)?.at).toBe(Date.parse('2026-10-05T09:00:00.000+02:00'));
    expect(workStart([], [])).toBeUndefined();
  });
});

describe('jiraEventsSince', () => {
  it('keeps events after the start, oldest first, with long fields as line diffs', () => {
    const since = Date.parse('2026-10-02T00:00:00+02:00');
    const lines = jiraEventsSince(
      [
        history('2026-10-01T09:00:00.000+0200', 'status', 'To Do', 'In Progress'),
        history('2026-10-04T09:00:00.000+0200', 'Acceptance criteria', 'Given A\nThen B', 'Given A\nThen C'),
      ],
      [{ id: '1', author: { displayName: 'Bob' }, created: '2026-10-03T09:00:00.000+0200', body: 'Please also handle X' }],
      since,
      (b) => String(b),
    );
    expect(lines).toEqual([
      expect.stringMatching(/^- 2026-10-03 \d\d:\d\d Bob commented:$/),
      '  > Please also handle X',
      expect.stringMatching(/^- 2026-10-04 \d\d:\d\d Ann changed \*\*Acceptance criteria\*\*:$/),
      '  - Then B',
      '  + Then C',
    ]);
  });
});
