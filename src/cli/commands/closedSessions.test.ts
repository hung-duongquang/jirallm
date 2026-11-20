import { appendFileSync, mkdirSync, mkdtempSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { IMPORTANT, MARKER, notifyClosedSessions, sessionsNewsText, stampOf } from './closedSessions.js';

const T0 = Date.parse('2026-11-19T10:00:00Z');

/** A workspace with a closed session on ZOD-1 / PR #12 and a running one on ZOD-2. */
function workspace() {
  const root = mkdtempSync(path.join(tmpdir(), 'closed-'));
  const outputDir = path.join(root, 'jira-export');
  const sessionsDir = path.join(root, 'sessions');
  mkdirSync(outputDir, { recursive: true });
  mkdirSync(sessionsDir, { recursive: true });
  for (const [id, keys] of [['closed1', 'ZOD-1\npr/12'], ['running', 'ZOD-2']] as const) {
    const transcript = path.join(root, `${id}.jsonl`);
    writeFileSync(transcript, '{}\n');
    writeFileSync(path.join(sessionsDir, `${id}.start`), `${root}\nstartup\n${transcript}\n`);
    writeFileSync(path.join(sessionsDir, `${id}.keys`), keys);
    writeFileSync(path.join(sessionsDir, `${id}.title`), `Work on ${keys.split('\n')[0]}`);
  }
  writeFileSync(path.join(sessionsDir, 'running.monitor'), String(process.pid));
  const log = (ms: number, lines: string[]) =>
    appendFileSync(path.join(outputDir, 'CHANGES.md'), `\n## ${stampOf(ms)}\n\n${lines.map((l) => `- ${l}`).join('\n')}\n`);
  return { root, outputDir, sessionsDir, log };
}

describe('closed sessions with news', () => {
  it('counts reviews, failed CI, merges and comments, not status or sprint moves', () => {
    for (const l of ['PR #12 (ZOD-1): trung-nguyenduc reviewed: CHANGES_REQUESTED', 'PR #12 (ZOD-1): CI failed: Integration tests — jirallm pr-status 12', 'PR #12: merged', 'ZOD-1: 2 new comments (Trung)', 'slack/c1-1: 1 new reply in "x"'])
      expect(IMPORTANT.test(l), l).toBe(true);
    for (const l of ['ZOD-1: status: Test → Resolved; History changed', 'ZOD-1: sprint: Project sprint 33 → Project sprint 34', 'PR #12 (ZOD-1): CI green — jirallm pr-status 12', 'ZOD-1: Description changed'])
      expect(IMPORTANT.test(l), l).toBe(false);
  });

  it('toasts each closed session once, only for news after the option was switched on, never a running one', () => {
    const w = workspace();
    const shown: { title: string; lines: string[] }[] = [];
    const show = (title: string, lines: string[]) => void shown.push({ title, lines });
    w.log(T0 - 3600_000, ['PR #12 (ZOD-1): CI failed: old backlog']);
    // Switched on: the old failure stays quiet.
    expect(notifyClosedSessions(w.outputDir, { sessionsDir: w.sessionsDir, now: T0, show })).toEqual([]);

    w.log(T0 + 60_000, ['PR #12 (ZOD-1): trung-nguyenduc reviewed: CHANGES_REQUESTED — jirallm pr-status 12', 'ZOD-1: sprint: 33 → 34', 'ZOD-2: 1 new comment (Ann)']);
    const told = notifyClosedSessions(w.outputDir, { sessionsDir: w.sessionsDir, now: T0 + 120_000, show });
    expect(told.map((n) => n.id)).toEqual(['closed1']);
    expect(shown).toEqual([{ title: 'Closed session: Work on ZOD-1', lines: ['PR #12 (ZOD-1): trung-nguyenduc reviewed: CHANGES_REQUESTED'] }]);

    // More news for the same closed session: no second toast until it runs again.
    w.log(T0 + 180_000, ['PR #12 (ZOD-1): CI failed: Integration tests']);
    expect(notifyClosedSessions(w.outputDir, { sessionsDir: w.sessionsDir, now: T0 + 240_000, show })).toEqual([]);
    expect(shown).toHaveLength(1);
  });

  it('names closed sessions with news after a time away, only while the watch has the option on', () => {
    const w = workspace();
    w.log(Date.now() - 3600_000, ['PR #12 (ZOD-1): trung-nguyenduc reviewed: COMMENTED; 2 new review comments', 'ZOD-2: 1 new comment (Ann)']);
    expect(sessionsNewsText(w.outputDir, 'other', w.sessionsDir)).toBe(''); // option off: no marker
    writeFileSync(path.join(w.outputDir, MARKER), new Date().toISOString());
    const text = sessionsNewsText(w.outputDir, 'other', w.sessionsDir);
    expect(text).toMatch(/^Closed Claude sessions with news/);
    expect(text).toContain('- Work on ZOD-1 (closed1): PR #12 (ZOD-1): trung-nguyenduc reviewed: COMMENTED');
    expect(text).not.toContain('ZOD-2');
    expect(sessionsNewsText(w.outputDir, 'closed1', w.sessionsDir)).toBe(''); // the asking session itself
    const old = new Date(Date.now() - 2 * 24 * 3600_000);
    utimesSync(path.join(w.outputDir, MARKER), old, old);
    expect(sessionsNewsText(w.outputDir, 'other', w.sessionsDir)).toBe(''); // the watch stopped running with it
  });
});
