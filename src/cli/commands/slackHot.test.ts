import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { hotFollows } from './slackHot.js';

const NOW = Date.parse('2026-11-18T13:00:00Z');

function setup() {
  const root = mkdtempSync(path.join(tmpdir(), 'jl-hot-'));
  const out = path.join(root, 'out');
  const sessions = path.join(root, 'sessions');
  mkdirSync(sessions, { recursive: true });
  const thread = (dir: string, minutesAgo: number) => {
    mkdirSync(path.join(out, 'slack', dir), { recursive: true });
    const at = new Date(NOW - minutesAgo * 60_000).toISOString();
    writeFileSync(path.join(out, 'slack', dir, 'thread.md'), `---\nslack:\n  title: "x"\n  lastReplyAt: "${at}"\n---\n`);
  };
  thread('c1-1700000000000001', 5); // a reply 5 minutes ago: going on now
  thread('c2-1700000000000002', 120); // quiet for 2 hours
  writeFileSync(
    path.join(out, '.slack-below.json'),
    JSON.stringify({
      'c1-1700000000000001': { newest: String((NOW - 60_000) / 1000) },
      'c2-1700000000000002': { newest: String((NOW - 60_000) / 1000), closed: true },
    })
  );
  writeFileSync(
    path.join(sessions, 's.follow'),
    ['slack/c1-1700000000000001', 'below/c1-1700000000000001', 'slack/C2-1700000000000002', 'below/c2-1700000000000002', 'pr/12'].join('\n')
  );
  return { out, sessions };
}

describe('hotFollows', () => {
  it('names the followed threads and open below windows with activity in the last 30 minutes', () => {
    const { out, sessions } = setup();
    const hot = hotFollows(out, 's', sessions, NOW);
    expect([...hot.threads]).toEqual(['c1-1700000000000001']);
    expect([...hot.below]).toEqual(['c1-1700000000000001']);
    expect(hotFollows(out, 's', sessions, NOW + 31 * 60_000).threads.size).toBe(0);
    expect(hotFollows(out, 'other', sessions, NOW).threads.size).toBe(0);
  });

  it('agrees with the monitor hook check (hasHotThread)', async () => {
    const { out, sessions } = setup();
    // The hook reads the sessions folder of the OS temp dir and the export of CLAUDE_PROJECT_DIR.
    const project = path.dirname(out);
    const exportDir = path.join(project, 'jira-export');
    mkdirSync(exportDir, { recursive: true });
    const { cpSync } = await import('node:fs');
    cpSync(out, exportDir, { recursive: true });
    const id = `hot-test-${process.pid}`;
    const sessionsDir = path.join(tmpdir(), 'jirallm-sessions');
    mkdirSync(sessionsDir, { recursive: true });
    cpSync(path.join(sessions, 's.follow'), path.join(sessionsDir, `${id}.follow`));
    process.env.CLAUDE_PROJECT_DIR = project;
    const hook = (await import(`${pathToFileURL(path.resolve('hooks/changes.mjs')).href}?t=${Date.now()}`)) as {
      hasHotThread: (id: string, now?: number) => boolean;
    };
    try {
      expect(hook.hasHotThread(id, NOW)).toBe(true);
      expect(hook.hasHotThread(id, NOW + 31 * 60_000)).toBe(false);
    } finally {
      const { rmSync } = await import('node:fs');
      rmSync(path.join(sessionsDir, `${id}.follow`), { force: true });
    }
  });
});
