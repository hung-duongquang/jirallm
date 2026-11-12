import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { COMPOUND_LABEL, isRunning, openSessions, parseJsonc, TASK_DETAIL, writeVsCodeTasks, type OpenSession } from './resume.js';

let dir: string;
let sessions: string;
let project: string;
const cli = { node: 'C:/node/node.exe', entry: 'C:/npm/jirallm/dist/cli/index.js' };

/** A session the plugin marked open, with a transcript (unless `transcript` is false) written `ageMs` ago. */
function session(id: string, { transcript = true, ageMs = 0, title = '' } = {}) {
  writeFileSync(path.join(sessions, `${id}.open`), project);
  const file = path.join(dir, `${id}.jsonl`);
  writeFileSync(path.join(sessions, `${id}.start`), [project, 'startup', file].join('\n'));
  if (title) writeFileSync(path.join(sessions, `${id}.title`), title);
  if (transcript) {
    writeFileSync(file, `${JSON.stringify({ type: 'user', message: { content: `first prompt of ${id}` } })}\n`);
    const t = new Date(Date.now() - ageMs);
    utimesSync(file, t, t);
  }
}

beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), 'jirallm-resume-'));
  sessions = path.join(dir, 'sessions');
  project = path.join(dir, 'workspace');
  mkdirSync(sessions);
  mkdirSync(project);
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('openSessions', () => {
  it('lists the sessions left open, oldest first, named by their title or first prompt', () => {
    session('bbb', { ageMs: 1000, title: 'ZOD-4155 BTW rules' });
    session('aaa', { ageMs: 60_000 });
    expect(openSessions(sessions).map((s) => [s.id, s.title, s.cwd])).toEqual([
      ['aaa', 'first prompt of aaa', project],
      ['bbb', 'ZOD-4155 BTW rules', project],
    ]);
  });

  it('skips sessions untouched for days and the throwaway ones without a transcript', () => {
    session('old', { ageMs: 4 * 24 * 3600 * 1000 });
    session('throwaway', { transcript: false });
    session('new');
    expect(openSessions(sessions).map((s) => s.id)).toEqual(['new']);
    expect(existsSync(path.join(sessions, 'throwaway.open'))).toBe(true);
    // A day later the throwaway marker is cleaned up.
    expect(openSessions(sessions, 3, Date.now() + 25 * 3600 * 1000).map((s) => s.id)).toEqual(['new']);
    expect(existsSync(path.join(sessions, 'throwaway.open'))).toBe(false);
  });
});

describe('isRunning', () => {
  it('needs a live monitor started after this boot', () => {
    writeFileSync(path.join(sessions, 'a.monitor'), String(process.pid));
    expect(isRunning('a', sessions, Date.now() - 60_000)).toBe(true);
    // The same pid from before a reboot is someone else's now.
    expect(isRunning('a', sessions, Date.now() + 60_000)).toBe(false);
    writeFileSync(path.join(sessions, 'b.monitor'), '99999999');
    expect(isRunning('b', sessions, 0)).toBe(false);
    expect(isRunning('none', sessions, 0)).toBe(false);
  });
});

describe('writeVsCodeTasks', () => {
  const open = (id: string, title: string): OpenSession => ({ id, cwd: project, title, lastActivity: 1 });
  const tasksFile = () => path.join(project, '.vscode', 'tasks.json');
  const tasks = () => (JSON.parse(readFileSync(tasksFile(), 'utf-8')) as { tasks: Array<Record<string, unknown>> }).tasks;

  it('writes one terminal task per session and a folder-open task that starts them all', () => {
    const r = writeVsCodeTasks(project, [open('70ab4bf2-f36a', 'ZOD-4155 a very long title that goes on and on and on'), open('50e8e96b-a6a3', 'review')], cli);
    expect(r).toMatchObject({ changed: true, count: 2 });
    const [a, b, all] = tasks();
    expect(a).toMatchObject({
      label: 'claude: ZOD-4155 a very long title that goes on… (70ab4bf2)',
      detail: TASK_DETAIL,
      command: cli.node,
      args: [cli.entry, 'resume', '70ab4bf2-f36a'],
      options: { cwd: project },
    });
    expect(b!.label).toBe('claude: review (50e8e96b)');
    expect(all).toMatchObject({ label: COMPOUND_LABEL, dependsOn: [a!.label, b!.label], runOptions: { runOn: 'folderOpen' } });
  });

  it('keeps the user\'s own tasks (comments and trailing commas allowed) and replaces only its own', () => {
    mkdirSync(path.dirname(tasksFile()));
    writeFileSync(
      tasksFile(),
      '// my tasks\n{\n  "version": "2.0.0",\n  "tasks": [\n    { "label": "build // not a comment", "type": "shell", "command": "dotnet build", },\n  ],\n}\n'
    );
    writeVsCodeTasks(project, [open('a', 'one'), open('b', 'two')], cli);
    writeVsCodeTasks(project, [open('b', 'two')], cli);
    expect(tasks().map((t) => t.label)).toEqual(['build // not a comment', 'claude: two (b)', COMPOUND_LABEL]);
    expect(writeVsCodeTasks(project, [open('b', 'two')], cli).changed).toBe(false);
    writeVsCodeTasks(project, [], cli);
    expect(tasks().map((t) => t.label)).toEqual(['build // not a comment']);
  });

  it('creates no file when nothing is open, and leaves a file it cannot parse alone', () => {
    expect(writeVsCodeTasks(project, [], cli)).toMatchObject({ changed: false });
    expect(existsSync(tasksFile())).toBe(false);
    mkdirSync(path.dirname(tasksFile()));
    writeFileSync(tasksFile(), '{ "tasks": [ oops');
    expect(writeVsCodeTasks(project, [open('a', 'one')], cli).error).toMatch(/does not parse/);
    expect(readFileSync(tasksFile(), 'utf-8')).toBe('{ "tasks": [ oops');
  });
});

describe('parseJsonc', () => {
  it('keeps comment markers and escaped quotes inside strings', () => {
    expect(parseJsonc('{ "a": "x \\" // y", /* c */ "b": [1,], }')).toEqual({ a: 'x " // y', b: [1] });
  });
});
