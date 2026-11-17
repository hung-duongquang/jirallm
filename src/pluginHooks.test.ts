// The plugin's hook scripts (hooks/*.mjs) run as Claude Code starts them: a process with a JSON prompt on
// stdin, or a long-running monitor. Each test points the OS temp dir (jirallm-sessions) at its own folder.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function workspace() {
  const root = mkdtempSync(path.join(tmpdir(), 'jl-hooks-'));
  const project = path.join(root, 'project');
  const temp = path.join(root, 'temp');
  mkdirSync(path.join(project, 'jira-export', 'zod-1'), { recursive: true });
  mkdirSync(path.join(temp, 'jirallm-sessions'), { recursive: true });
  // No real CLI: the state card call fails quietly instead of reading real tickets.
  const env = { ...process.env, TEMP: temp, TMP: temp, TMPDIR: temp, CLAUDE_PROJECT_DIR: project, PATH: path.dirname(process.execPath) };
  return { project, sessions: path.join(temp, 'jirallm-sessions'), env };
}

const promptHook = (env: NodeJS.ProcessEnv, prompt: string) =>
  spawnSync(process.execPath, ['hooks/prompt-submit.mjs'], { env, input: JSON.stringify({ session_id: 's1', prompt }), encoding: 'utf8', timeout: 20000 });

describe('prompt hook', () => {
  it('takes tickets from what the user wrote, not from a background task notification', () => {
    const { sessions, env } = workspace();
    const notification = '<task-notification>\n<summary>Monitor event</summary>\n<event>Changes to this session\'s tickets (ZOD-1): PR #12 (ZOD-1): CI green</event>\n</task-notification>';
    promptHook(env, notification);
    expect(existsSync(path.join(sessions, 's1.keys'))).toBe(false);
    expect(existsSync(path.join(sessions, 's1.follow'))).toBe(false);

    promptHook(env, 'look at ZOD-1 please');
    expect(readFileSync(path.join(sessions, 's1.keys'), 'utf8')).toBe('ZOD-1');
  });
});

describe('monitor', () => {
  it('serves the session of its own Claude Code process when several start together', async () => {
    const { project, sessions, env } = workspace();
    const start = (id: string, claudePid: string, secondsAgo: number) => {
      const file = path.join(sessions, `${id}.start`);
      writeFileSync(file, [project, 'resume', '', claudePid].join('\n'));
      const t = new Date(Date.now() - secondsAgo * 1000);
      utimesSync(file, t, t);
    };
    // Ours started first; another session started a second later (the newest, which the old claim took).
    start('ours', '111', 2);
    start('theirs', '222', 1);
    const monitor = spawn(process.execPath, ['hooks/monitor.mjs', project], { env: { ...env, CLAUDE_PID: '111' }, stdio: 'ignore' });
    try {
      for (let i = 0; i < 50 && !existsSync(path.join(sessions, 'ours.monitor')); i++) await new Promise((r) => setTimeout(r, 100));
      expect(readFileSync(path.join(sessions, 'ours.monitor'), 'utf8')).toBe(String(monitor.pid));
      expect(existsSync(path.join(sessions, 'theirs.monitor'))).toBe(false);
    } finally {
      monitor.kill();
    }
  });
});
