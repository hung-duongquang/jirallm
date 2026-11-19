import { describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { claudeSessions, removeSession } from './sessions.js';
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

describe('removeSession', () => {
  const id = '70ab4bf2-f36a-44e8-aa11-497a0c125fc3';
  const other = '22fe6fe9-0000-4000-8000-000000000000';
  const setup = () => {
    const dir = path.join(mkdtempSync(path.join(tmpdir(), 'sessions-')), 'jira-export');
    const seen = path.join(dir, '.changes.seen.d');
    mkdirSync(seen, { recursive: true });
    const tmp = mkdtempSync(path.join(tmpdir(), 'sessions-tmp-'));
    for (const s of [id, other]) {
      for (const ext of ['', '.start', '.keys', '.title', '.follow', '.open']) writeFileSync(path.join(tmp, s + ext), 'x');
      for (const ext of ['', '.log', '.acked', '.pushed', '.reply']) writeFileSync(path.join(seen, s + ext), 'x');
    }
    return { dir, seen, tmp };
  };

  it('hides the session and stops its reopen, but keeps its records for a later /resume', () => {
    const { dir, seen, tmp } = setup();
    // A transcript written just now: both sessions are live, so the view lists them.
    for (const s of [id, other]) {
      writeFileSync(path.join(tmp, s + '.jsonl'), '');
      writeFileSync(path.join(tmp, s + '.start'), [path.dirname(dir), 'startup', path.join(tmp, s + '.jsonl')].join('\n'));
    }
    expect(claudeSessions(dir, 7, tmp).map((s) => s.id).sort()).toEqual([other, id].sort());
    expect(removeSession(id, dir, tmp)).toBe(2);
    expect(claudeSessions(dir, 7, tmp).map((s) => s.id)).toEqual([other]);
    expect(existsSync(path.join(tmp, id + '.open'))).toBe(false);
    for (const ext of ['.keys', '.follow', '.title']) expect(existsSync(path.join(tmp, id + ext))).toBe(true);
    expect(existsSync(path.join(seen, id + '.log'))).toBe(true);
    expect(readdirSync(tmp).filter((f) => f.startsWith(other) && !f.endsWith('.jsonl'))).toHaveLength(6);
    // Resumed: the SessionStart hook drops the hidden mark, and the session is listed again.
    rmSync(path.join(tmp, id + '.hidden'));
    expect(claudeSessions(dir, 7, tmp).map((s) => s.id)).toContain(id);
  });

  it('refuses a running session and anything that is not a session id', () => {
    const { dir, tmp } = setup();
    writeFileSync(path.join(tmp, id + '.monitor'), String(process.pid));
    expect(() => removeSession(id, dir, tmp)).toThrow(/running/);
    expect(existsSync(path.join(tmp, id + '.start'))).toBe(true);
    expect(() => removeSession('..', dir, tmp)).toThrow(/Not a session id/);
  });
});
