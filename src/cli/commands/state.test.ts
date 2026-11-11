import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { noteLine, runNote, ticketState, worktreesFor } from './state.js';

let out: string;
beforeEach(() => {
  out = mkdtempSync(path.join(os.tmpdir(), 'jirallm-state-'));
  vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

const porcelain = [
  'worktree /repo\nHEAD abc\nbranch refs/heads/main',
  'worktree /w/3943\nHEAD def\nbranch refs/heads/feature/ZOD-3943-ignore-reject',
  'worktree /w/x\nHEAD 123\ndetached',
].join('\n\n');

describe('worktreesFor', () => {
  it('keeps worktrees whose branch carries the key', () => {
    expect(worktreesFor(porcelain, 'ZOD-3943')).toEqual([{ path: '/w/3943', branch: 'feature/ZOD-3943-ignore-reject' }]);
    expect(worktreesFor(porcelain, 'ZOD-394')).toEqual([]);
  });
});

describe('ticketState', () => {
  it('combines the export, my PR from the watch state, worktrees, own files and notes', () => {
    const dir = path.join(out, 'zod-3943');
    mkdirSync(dir);
    writeFileSync(path.join(dir, 'task.md'), '---\nkey: "ZOD-3943"\nstatus: "Code Review"\nissueType: "Story"\nassignee: "Me"\nupdatedAt: "2026-11-09T11:18:53.491+0100"\n---\n\n# Ignore and reject\n');
    writeFileSync(path.join(dir, 'context.md'), 'x');
    writeFileSync(path.join(dir, '.task.previous.md'), 'x');
    writeFileSync(path.join(dir, 'notes.md'), '# ZOD-3943 notes\n\n- 2026-11-09: retour code settled\n');
    writeFileSync(path.join(out, '.prs.json'), JSON.stringify({
      meta: { repoPath: out },
      prs: { 3017: { number: 3017, title: 't', key: 'ZOD-3943', head: 'h', failed: [], pending: 0, reviews: { trung: 'APPROVED@2026-11-10', 'copilot-pull-request-reviewer': 'COMMENTED@x' }, awaiting: 1, comments: 0, url: 'https://pr/3017' },
        1: { number: 1, title: 'other', key: 'ZOD-1', head: 'h', failed: [], pending: 0, reviews: {}, awaiting: 0, comments: 0 } },
    }));
    const git = (cwd: string, args: string[]) => {
      if (args[0] === 'worktree') return porcelain;
      if (args[0] === 'status') return ' M a.cs\n';
      return '2\n';
    };
    const card = ticketState('ZOD-3943', out, undefined, git);
    expect(card).toContain('## ZOD-3943: Ignore and reject');
    expect(card).toContain('Code Review · Story · assignee Me');
    expect(card).toContain('- PR #3017 (mine, open): CI green; reviews: trung APPROVED; 1 thread(s) awaiting me');
    expect(card).not.toContain('copilot');
    expect(card).not.toContain('#1 ');
    expect(card).toContain('- Worktree /w/3943 · feature/ZOD-3943-ignore-reject · 1 uncommitted · 2 unpushed');
    expect(card).toMatch(/Files: .*zod-3943\/context\.md$/m);
    expect(card).not.toContain('previous');
    expect(card).toContain('  - 2026-11-09: retour code settled');
  });

  it('says when the ticket is not exported', () => {
    expect(ticketState('ZOD-1', out, undefined, () => '')).toContain('Not exported');
  });
});

describe('note', () => {
  it('appends dated one-line notes, creating the file with a heading', () => {
    runNote('zod-5', ['first', 'note'], { outputDir: out });
    writeFileSync(path.join(out, 'zod-5', 'notes.md'), `${readFileSync(path.join(out, 'zod-5', 'notes.md'), 'utf8').trimEnd()}`);
    runNote('ZOD-5', ['two\nlines'], { outputDir: out });
    const text = readFileSync(path.join(out, 'zod-5', 'notes.md'), 'utf8');
    expect(text).toMatch(/^# ZOD-5 notes\n\n- \d{4}-\d\d-\d\d: first note\n- \d{4}-\d\d-\d\d: two lines\n$/);
  });

  it('rejects bad keys and empty text', () => {
    expect(() => runNote('nope', ['x'], { outputDir: out })).toThrow(/Not an issue key/);
    expect(() => runNote('ZOD-1', [' '], { outputDir: out })).toThrow(/Nothing to note/);
  });

  it('formats a line', () => {
    expect(noteLine(' a \n b ', new Date(2026, 10, 11))).toBe('- 2026-11-11: a b');
  });
});
