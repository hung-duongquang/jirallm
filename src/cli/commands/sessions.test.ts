import { describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { claudeSessions } from './sessions.js';
import { changesReport, tagDelivery } from './watch.js';

describe('claudeSessions', () => {
  it('lists recent sessions with what they were handed and whether Claude read it', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'sessions-'));
    const tmp = mkdtempSync(path.join(tmpdir(), 'sessions-tmp-'));
    writeFileSync(path.join(dir, 'CHANGES.md'), '\n## 2026-11-12 10:00\n\n- PR #12 (ZOD-1): CI failed\n');
    writeFileSync(path.join(tmp, 'abc.keys'), 'ZOD-1\n');
    writeFileSync(path.join(tmp, 'abc.title'), 'Fix the ION mock');
    tagDelivery(dir, 'abc', 'monitor', changesReport(dir, false, 20, 'abc', { keys: ['ZOD-1'], pushOnly: true }));
    writeFileSync(path.join(dir, 'CHANGES.md'), '\n## 2026-11-12 10:00\n\n- PR #12 (ZOD-1): CI failed\n\n## 2026-11-12 10:05\n\n- ZOD-1: Comments changed\n');
    tagDelivery(dir, 'abc', 'prompt', changesReport(dir, true, 20, 'abc', { keys: ['ZOD-1'] }));
    writeFileSync(path.join(dir, '.changes.seen.d', 'abc.acked'), JSON.stringify({ n: 1, at: new Date().toISOString(), reply: 'Fixing CI' }));

    const [s, ...rest] = claudeSessions(dir, 7, tmp);
    expect(rest).toEqual([]);
    expect(s).toMatchObject({ id: 'abc', title: 'Fix the ION mock', keys: ['ZOD-1'], monitor: false, waiting: 0, reply: 'Fixing CI' });
    expect(s!.deliveries.map((d) => [d.n, d.via, d.read, d.items])).toEqual([
      [2, 'prompt', false, ['ZOD-1']],
      [1, 'monitor', true, ['PR #12 (ZOD-1)']],
    ]);
    expect(s!.deliveries[1]!.text).toMatch(/^Changes to this session's tickets \(ZOD-1;[^\n]*\n- PR #12 \(ZOD-1\): CI failed/);
  });

  it('lists a live session before its first delivery, titled from its transcript, and never a throwaway resume session', () => {
    const dir = path.join(mkdtempSync(path.join(tmpdir(), 'sessions-')), 'jira-export');
    mkdirSync(dir);
    const tmp = mkdtempSync(path.join(tmpdir(), 'sessions-tmp-'));
    const transcript = path.join(tmp, 'real.jsonl');
    writeFileSync(
      transcript,
      [
        { type: 'user', isMeta: true, message: { content: '<local-command-caveat>x</local-command-caveat>' } },
        { type: 'user', message: { content: '<command-message>jirallm:implement</command-message>\n<command-name>/jirallm:implement</command-name>\n<command-args>ZOD-4155</command-args>' } },
      ].map((e) => JSON.stringify(e)).join('\n') + '\n'
    );
    const project = path.dirname(dir);
    writeFileSync(path.join(tmp, 'real.start'), `${project}\nresume\n${transcript}`);
    writeFileSync(path.join(tmp, 'throwaway.start'), `${project}\nstartup\n${path.join(tmp, 'missing.jsonl')}`);
    writeFileSync(path.join(tmp, 'throwaway.monitor'), String(process.pid));
    writeFileSync(path.join(tmp, 'elsewhere.start'), `${tmp}\nstartup\n${transcript}`);
    const list = claudeSessions(dir, 7, tmp);
    expect(list.map((s) => [s.id, s.live, s.title, s.deliveries.length])).toEqual([['real', true, '/jirallm:implement ZOD-4155', 0]]);
  });

  it('leaves out sessions idle for longer than the window', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'sessions-'));
    mkdirSync(path.join(dir, '.changes.seen.d'));
    const log = path.join(dir, '.changes.seen.d', 'old.log');
    writeFileSync(log, JSON.stringify({ n: 1, at: '2026-01-01T00:00:00Z', via: 'prompt', items: ['ZOD-1'] }) + '\n');
    const old = new Date('2026-01-01T00:00:00Z');
    utimesSync(log, old, old);
    expect(claudeSessions(dir, 7, dir)).toEqual([]);
  });
});
