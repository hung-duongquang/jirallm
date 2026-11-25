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

  it('follows the PR and ticket an exported Slack thread names, not those of channel messages outside it', () => {
    const { project, sessions, env } = workspace();
    const dir = path.join(project, 'jira-export', 'slack', 'c1-1700000000000001');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      path.join(dir, 'thread.md'),
      [
        '---', 'slack:', '  title: "x"', '---',
        '## Trung · 2026-11-17 14:38', '', 'resolve the comments in this PR (ZOD-1)',
        '[github.com/o/r/pull/3270#…](https://github.com/o/r/pull/3270#pullrequestreview-1)', '',
        '# In the channel, outside the thread', '', 'unrelated https://github.com/o/r/pull/9999',
      ].join('\n')
    );
    promptHook(env, 'https://ws.slack.com/archives/C1/p1700000000000001');
    expect(readFileSync(path.join(sessions, 's1.follow'), 'utf8').split('\n')).toEqual(['slack/c1-1700000000000001', 'pr/o/r/3270']);
    expect(readFileSync(path.join(sessions, 's1.keys'), 'utf8')).toBe('ZOD-1');
  });

  it('follows the channel below a Slack link only when asked ("and below")', () => {
    const { sessions, env } = workspace();
    promptHook(env, 'https://ws.slack.com/archives/C1/p1700000000000001');
    expect(readFileSync(path.join(sessions, 's1.follow'), 'utf8')).toBe('slack/c1-1700000000000001');
    promptHook(env, 'https://ws.slack.com/archives/C2/p1700000000000002 and below');
    expect(readFileSync(path.join(sessions, 's1.follow'), 'utf8').split('\n').sort()).toEqual([
      'below/c2-1700000000000002',
      'slack/c1-1700000000000001',
      'slack/c2-1700000000000002',
    ]);
  });

  it('follows nothing the user hands to another session', () => {
    const { sessions, env } = workspace();
    promptHook(env, 'https://ws.slack.com/archives/C1/p1700000000000001?thread_ts=1700000000.000001 about ZOD-1, I will leave to another claude session');
    expect(existsSync(path.join(sessions, 's1.follow'))).toBe(false);
    expect(existsSync(path.join(sessions, 's1.keys'))).toBe(false);
  });

  it('follows a GitHub Actions run linked in the prompt', () => {
    const { sessions, env } = workspace();
    promptHook(env, 'watch https://github.com/o/aws/actions/runs/44 until it is deployed');
    expect(readFileSync(path.join(sessions, 's1.follow'), 'utf8')).toBe('run/o/aws/44');
  });

  it('tells Claude the user is back after a time away, and only then', () => {
    const { sessions, env } = workspace();
    expect(promptHook(env, 'hello').stdout).not.toContain('back after');
    writeFileSync(path.join(sessions, 's1.last'), new Date(Date.now() - 15 * 3600000).toISOString());
    const back = JSON.parse(promptHook(env, 'where were we').stdout);
    expect(back.hookSpecificOutput.additionalContext).toMatch(/The user is back after 15 h \d+ min away/);
    expect(back.systemMessage).toContain('welcome back');
    expect(promptHook(env, 'go on').stdout).not.toContain('back after');
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

describe('Claude Desktop (runs hooks, starts no plugin monitors)', () => {
  const sessionStart = (env: NodeJS.ProcessEnv) =>
    spawnSync(process.execPath, ['hooks/session-start.mjs'], {
      env,
      input: JSON.stringify({ session_id: 'd1', source: 'startup' }),
      encoding: 'utf8',
      timeout: 20000,
    });

  it('asks Claude to start the monitor for its session; the CLI is told it runs already', () => {
    const { env } = workspace();
    const desktop = JSON.parse(sessionStart({ ...env, CLAUDE_CODE_ENTRYPOINT: 'claude-desktop' }).stdout);
    expect(desktop.hookSpecificOutput.additionalContext).toMatch(/start it yourself, once[\s\S]*monitor\.mjs" "[^"]+" --session d1`[\s\S]*Do not delay an answer for it/);
    const cli = JSON.parse(sessionStart({ ...env, CLAUDE_CODE_ENTRYPOINT: 'cli' }).stdout);
    expect(cli.hookSpecificOutput.additionalContext).not.toContain('start it yourself');
  });

  it('a monitor given --session serves that session without a handshake', async () => {
    const { project, sessions, env } = workspace();
    const monitor = spawn(process.execPath, ['hooks/monitor.mjs', project, '--session', 'late'], { env, stdio: 'ignore' });
    try {
      for (let i = 0; i < 50 && !existsSync(path.join(sessions, 'late.monitor')); i++) await new Promise((r) => setTimeout(r, 100));
      expect(readFileSync(path.join(sessions, 'late.monitor'), 'utf8')).toBe(String(monitor.pid));
    } finally {
      monitor.kill();
    }
  });
});
