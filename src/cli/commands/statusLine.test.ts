import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { statusLine } from './statusLine.js';
import { changesReport, deliveryLogReport, tagDelivery } from './watch.js';

describe('statusLine', () => {
  const now = Date.parse('2026-11-09T04:40:00Z');

  it('shows the last watch run and the changes this session has not been given', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'statusline-'));
    writeFileSync(path.join(dir, '.watch.at'), '2026-11-09T04:32:00.000Z');
    writeFileSync(path.join(dir, 'CHANGES.md'), '\n## 2026-11-09 11:30\n\n- ZOD-1: x\n- ZOD-2: y\n- ZOD-1: z\n');
    expect(statusLine(dir, 'abc', now, [])).toMatch(/^jirallm ✓ \d\d:\d\d · \+2 other$/);
    expect(statusLine(dir, 'abc', now, ['ZOD-1'])).toMatch(/^jirallm ✓ \d\d:\d\d · ⏳ 1 waiting for Claude · \+1 other$/);
  });

  it('shows the last delivery and whether a Claude turn has read it', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'statusline-'));
    writeFileSync(path.join(dir, '.watch.at'), '2026-11-09T04:32:00.000Z');
    writeFileSync(path.join(dir, 'CHANGES.md'), '\n## 2026-11-09 11:30\n\n- PR #12 (ZOD-1): CI failed\n- ZOD-2: y\n');
    const report = tagDelivery(dir, 'abc', 'monitor', changesReport(dir, false, 20, 'abc', { keys: ['ZOD-1'], pushOnly: true }));
    expect(report).toMatch(/^\[jirallm delivery #1 · monitor \d\d:\d\d\]\nChanges to this session's tickets/);
    expect(statusLine(dir, 'abc', now, ['ZOD-1'])).toMatch(/· 📥 #1 \d\d:\d\d PR #12 → ⏳ not read yet · \+1 other$/);
    writeFileSync(path.join(dir, '.changes.seen.d', 'abc.acked'), JSON.stringify({ n: 1, at: '2026-11-09T04:35:00.000Z', reply: 'CI failed on #12, fixing' }));
    expect(statusLine(dir, 'abc', now, ['ZOD-1'])).toMatch(/· 📥 #1 \d\d:\d\d PR #12 → ✓ read \d\d:\d\d · \+1 other$/);
    expect(deliveryLogReport(dir, undefined, 20)).toMatch(/#1 2026-\d\d-\d\d \d\d:\d\d via monitor: PR #12 \(ZOD-1\) — ✓ read\n.*"CI failed on #12, fixing"/);
    // A report naming only other tickets is not a delivery worth tracking.
    expect(tagDelivery(dir, 'abc', 'prompt', "Other changes, not this session's tickets: ZOD-2")).toBe("Other changes, not this session's tickets: ZOD-2");
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
