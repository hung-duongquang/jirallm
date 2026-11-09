import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { statusLine } from './statusLine.js';

describe('statusLine', () => {
  const now = Date.parse('2026-11-09T04:40:00Z');

  it('shows the last watch run and the changes this session has not been given', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'statusline-'));
    writeFileSync(path.join(dir, '.watch.at'), '2026-11-09T04:32:00.000Z');
    writeFileSync(path.join(dir, 'CHANGES.md'), '\n## 2026-11-09 11:30\n\n- ZOD-1: x\n- ZOD-2: y\n- ZOD-1: z\n');
    const line = statusLine(dir, 'abc', now);
    expect(line).toMatch(/^jirallm ✓ \d\d:\d\d · 2 new for Claude$/);
  });

  it('warns when the watcher stopped or never ran, and is empty without an export folder', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'statusline-'));
    expect(statusLine(dir, undefined, now)).toBe('jirallm ⚠ watch not running · Claude up to date');
    writeFileSync(path.join(dir, '.watch.at'), '2026-11-09T04:00:00.000Z 1 error(s)');
    expect(statusLine(dir, undefined, now)).toBe('jirallm ⚠ watch idle 40m · Claude up to date');
    expect(statusLine(path.join(dir, 'missing'), undefined, now)).toBe('');
  });

  it('shows watch errors while the watcher is alive', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'statusline-'));
    writeFileSync(path.join(dir, '.watch.at'), '2026-11-09T04:39:00.000Z 1 error(s)');
    expect(statusLine(dir, undefined, now)).toMatch(/^jirallm ✓ \d\d:\d\d ⚠ 1 error\(s\) · Claude up to date$/);
  });
});
