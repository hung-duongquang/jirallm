import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { extensionAvailable, installExtension, openUri, resumeUri } from '../../lib/vscodeExtension.js';
import { firstPrompt } from './sessions.js';

/**
 * Bringing Claude Code sessions back after a reboot. The plugin's SessionStart hook leaves
 * `<id>.open` (holding the session's project dir) in the sessions dir, and its SessionEnd hook
 * removes it when the user ends the session (/exit, /clear, logout). A reboot or a closed window
 * ends no session that way, so what is left are the sessions that were still open. `jirallm resume
 * --vscode <workspace>` turns them into VS Code tasks (one terminal each, run when the folder opens),
 * and each task runs `jirallm resume <id>`, which starts `claude --resume <id>` unless that session is
 * still running.
 */

export const defaultSessionsDir = () => path.join(os.tmpdir(), 'jirallm-sessions');
const SESSION_ID = /^[\w-]{1,100}$/;
/** Sessions untouched for longer are not brought back (an "open" marker of a session killed long ago). */
const MAX_AGE_DAYS = 3;
/** Marks the tasks jirallm owns in tasks.json; every other task there is left alone. */
export const TASK_DETAIL = 'jirallm resume';
export const COMPOUND_LABEL = 'Resume Claude sessions';
const MAX_LABEL_TITLE = 40;

export type OpenSession = { id: string; cwd: string; title: string; lastActivity: number };

const read = (file: string) => {
  try {
    return readFileSync(file, 'utf-8').trim();
  } catch {
    return '';
  }
};
const pad = (n: number) => String(n).padStart(2, '0');
const mtime = (file: string) => {
  try {
    return statSync(file).mtimeMs;
  } catch {
    return 0;
  }
};

/** Where Claude Code keeps a session's transcript: from the start handshake, else its default location. */
function transcriptOf(sessionsDir: string, id: string, cwd: string): string {
  const fromStart = read(path.join(sessionsDir, `${id}.start`)).split('\n')[2]?.trim();
  return fromStart || path.join(os.homedir(), '.claude', 'projects', path.resolve(cwd).replace(/[^a-zA-Z0-9]/g, '-'), `${id}.jsonl`);
}

/**
 * The sessions left open: an `.open` marker and a transcript written in the last `maxDays` days,
 * oldest first (the order they get their terminals). A marker without a transcript is the
 * throwaway session `claude --resume` starts before switching ids; those are dropped after a day.
 */
export function openSessions(sessionsDir = defaultSessionsDir(), maxDays = MAX_AGE_DAYS, now = Date.now()): OpenSession[] {
  if (!existsSync(sessionsDir)) return [];
  const out: OpenSession[] = [];
  for (const f of readdirSync(sessionsDir)) {
    if (!f.endsWith('.open')) continue;
    const id = f.slice(0, -'.open'.length);
    const marker = path.join(sessionsDir, f);
    const cwd = read(marker);
    if (!SESSION_ID.test(id) || !cwd) continue;
    const transcript = transcriptOf(sessionsDir, id, cwd);
    const wrote = mtime(transcript);
    if (!wrote) {
      if (now - mtime(marker) > 24 * 3600 * 1000) forget(id, sessionsDir);
      continue;
    }
    if (now - wrote > maxDays * 24 * 3600 * 1000) continue;
    const title = read(path.join(sessionsDir, `${id}.title`)) || firstPrompt(transcript) || id.slice(0, 8);
    out.push({ id, cwd, title, lastActivity: wrote });
  }
  return out.sort((a, b) => a.lastActivity - b.lastActivity);
}

/** Drops a session from the ones brought back. */
export function forget(id: string, sessionsDir = defaultSessionsDir()): boolean {
  try {
    unlinkSync(path.join(sessionsDir, `${id}.open`));
    return true;
  } catch {
    return false;
  }
}

/**
 * True while the session runs: its plugin monitor is alive and was started after this boot (a pid
 * from before a reboot may belong to another process now).
 */
export function isRunning(id: string, sessionsDir = defaultSessionsDir(), bootMs = Date.now() - os.uptime() * 1000): boolean {
  const file = path.join(sessionsDir, `${id}.monitor`);
  const pid = Number(read(file));
  if (!(pid > 0) || mtime(file) < bootMs) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

type Task = Record<string, unknown> & { label?: string; detail?: string };

/** The tasks: one terminal per session, named after it, and a compound one that starts them all when the folder opens. */
export function resumeTasks(sessions: OpenSession[], cli: { node: string; entry: string }): Task[] {
  if (!sessions.length) return [];
  const tasks: Task[] = sessions.map((s) => {
    const title = s.title.replace(/\s+/g, ' ').trim();
    return {
      label: `claude: ${title.length > MAX_LABEL_TITLE ? `${title.slice(0, MAX_LABEL_TITLE - 1)}…` : title} (${s.id.slice(0, 8)})`,
      detail: TASK_DETAIL,
      type: 'process',
      command: cli.node,
      args: [cli.entry, 'resume', s.id],
      options: { cwd: s.cwd },
      problemMatcher: [],
      presentation: { reveal: 'always', panel: 'dedicated', focus: false, echo: false, close: true, showReuseMessage: false },
    };
  });
  tasks.push({
    label: COMPOUND_LABEL,
    detail: TASK_DETAIL,
    dependsOn: tasks.map((t) => t.label),
    dependsOrder: 'parallel',
    runOptions: { runOn: 'folderOpen' },
    problemMatcher: [],
  });
  return tasks;
}

/** JSON with comments and trailing commas (VS Code's tasks.json), or undefined when it does not parse. */
export function parseJsonc(text: string): unknown {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (c === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '"') j += text[j] === '\\' ? 2 : 1;
      out += text.slice(i, j + 1);
      i = j;
    } else if (c === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++;
      out += '\n';
    } else if (c === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      i = end < 0 ? text.length : end + 1;
    } else {
      out += c;
    }
  }
  try {
    return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1'));
  } catch {
    return undefined;
  }
}

export type TasksResult = { file: string; changed: boolean; count: number; error?: string };

/**
 * Writes the resume tasks into `<workspace>/.vscode/tasks.json`, replacing the ones jirallm wrote
 * before and keeping every other task. Comments in the file are lost when it is rewritten, so it is
 * only rewritten when the tasks changed. With no open sessions no file is created.
 */
export function writeVsCodeTasks(workspace: string, sessions: OpenSession[], cli: { node: string; entry: string }): TasksResult {
  const file = path.join(workspace, '.vscode', 'tasks.json');
  const ours = resumeTasks(sessions, cli);
  let doc: { version?: string; tasks?: Task[] } = { version: '2.0.0', tasks: [] };
  const before = existsSync(file) ? readFileSync(file, 'utf-8') : '';
  if (before.trim()) {
    const parsed = parseJsonc(before);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { file, changed: false, count: 0, error: `${file} does not parse as JSON; left unchanged` };
    doc = parsed as typeof doc;
  } else if (!ours.length) {
    return { file, changed: false, count: 0 };
  }
  const others = (Array.isArray(doc.tasks) ? doc.tasks : []).filter((t) => t?.detail !== TASK_DETAIL);
  const next = { ...doc, version: doc.version ?? '2.0.0', tasks: [...others, ...ours] };
  const text = `${JSON.stringify(next, null, 2)}\n`;
  const old = before.trim() ? JSON.stringify(parseJsonc(before)) : '';
  if (old === JSON.stringify(next)) return { file, changed: false, count: sessions.length };
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, text);
  return { file, changed: true, count: sessions.length };
}

/**
 * This CLI as a task or terminal should start it: node and the real path of its entry script (not
 * the .cmd shim), found from this module so it is right whether the CLI or `jirallm ui` asks.
 */
export function cliCommand(): { node: string; entry: string } {
  const entry = fileURLToPath(new URL('../index.js', import.meta.url));
  let real = entry;
  try {
    real = realpathSync(entry);
  } catch {
    // Keep the path as given.
  }
  return { node: process.execPath, entry: real };
}

/** Marks a session open again (it is brought back after a reboot), in the folder its start handshake names. */
export function markOpen(id: string, sessionsDir = defaultSessionsDir()): boolean {
  if (!SESSION_ID.test(id)) return false;
  const cwd = read(path.join(sessionsDir, `${id}.start`)).split('\n')[0]?.trim();
  if (!cwd) return false;
  writeFileSync(path.join(sessionsDir, `${id}.open`), cwd);
  return true;
}

export const isMarkedOpen = (id: string, sessionsDir = defaultSessionsDir()) => SESSION_ID.test(id) && existsSync(path.join(sessionsDir, `${id}.open`));

/** Rewrites `<workspace>/.vscode/tasks.json` from the sessions left open now. */
export function refreshVsCodeTasks(workspace: string, sessionsDir = defaultSessionsDir()): TasksResult {
  return writeVsCodeTasks(workspace, openSessions(sessionsDir), cliCommand());
}

/** The program and arguments that open a new terminal window running `jirallm resume <id>` in `cwd`. */
export function terminalCommand(id: string, cwd: string, title: string, platform = process.platform, hasWt = false): { cmd: string; args: string[] } {
  const { node, entry } = cliCommand();
  if (platform === 'win32') {
    return hasWt
      ? { cmd: 'wt.exe', args: ['new-tab', '--title', title, '-d', cwd, node, entry, 'resume', id] }
      : // Passed verbatim (cmd's own quoting): the first quoted argument of `start` is the window title.
        { cmd: 'cmd.exe', args: ['/c', 'start', `"${title.replace(/"/g, '')}"`, '/D', `"${cwd}"`, `"${node}"`, `"${entry}"`, 'resume', id] };
  }
  const sh = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
  const line = `cd ${sh(cwd)} && ${sh(node)} ${sh(entry)} resume ${id}`;
  if (platform === 'darwin') return { cmd: 'osascript', args: ['-e', `tell application "Terminal" to do script ${JSON.stringify(line)}`, '-e', 'tell application "Terminal" to activate'] };
  return { cmd: 'x-terminal-emulator', args: ['-e', 'sh', '-c', line] };
}

/** Opens a terminal window that resumes the session (Windows Terminal when installed). */
/**
 * Brings the session back in a terminal: in VS Code (through the jirallm sessions extension, installed
 * on first use) when VS Code is there, else in a terminal window of its own. `note` says why VS Code was not used.
 */
export function openInTerminal(id: string, title: string, sessionsDir = defaultSessionsDir()): { where: 'vscode' | 'window'; note?: string } {
  if (!SESSION_ID.test(id)) throw new Error(`Not a session id: ${id}`);
  const saved = read(path.join(sessionsDir, `${id}.open`)) || read(path.join(sessionsDir, `${id}.start`)).split('\n')[0]?.trim() || '';
  const cwd = saved && existsSync(saved) ? saved : os.homedir();
  let note: string | undefined;
  if (extensionAvailable()) {
    note = installExtension() || undefined;
    if (!note) {
      openUri(resumeUri(id, cwd, title));
      return { where: 'vscode' };
    }
  }
  openInWindow(id, cwd, title);
  return { where: 'window', ...(note && { note }) };
}

function openInWindow(id: string, cwd: string, title: string): void {
  const hasWt = process.platform === 'win32' && !!process.env.LOCALAPPDATA && existsSync(path.join(process.env.LOCALAPPDATA, 'Microsoft', 'WindowsApps', 'wt.exe'));
  const { cmd, args } = terminalCommand(id, cwd, `claude: ${title.slice(0, 40)}`, process.platform, hasWt);
  const child = spawn(cmd, args, { detached: true, stdio: 'ignore', windowsVerbatimArguments: cmd === 'cmd.exe' });
  child.on('error', () => {});
  child.unref();
}

export type ResumeOptions = { vscode?: string; forget?: boolean; sessionsDir?: string };

export async function runResume(id: string | undefined, opts: ResumeOptions): Promise<void> {
  const sessionsDir = opts.sessionsDir ?? defaultSessionsDir();
  if (id !== undefined && !SESSION_ID.test(id)) throw new Error(`Not a session id: ${id}`);
  if (opts.forget) {
    if (!id) throw new Error('--forget needs a session id.');
    console.log(forget(id, sessionsDir) ? `Session ${id} will not be brought back.` : `Session ${id} was not marked open.`);
  }
  if (opts.vscode) {
    const r = refreshVsCodeTasks(path.resolve(opts.vscode), sessionsDir);
    if (r.error) throw new Error(r.error);
    console.log(r.changed ? `${r.file}: ${r.count} session task(s) written.` : `${r.file}: up to date (${r.count} session(s)).`);
    return;
  }
  if (opts.forget) return;
  if (!id) {
    const list = openSessions(sessionsDir);
    if (!list.length) return console.log('No Claude sessions left open.');
    for (const s of list) {
      const state = isRunning(s.id, sessionsDir) ? 'running' : 'not running';
      const at = new Date(s.lastActivity);
      const local = `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())} ${pad(at.getHours())}:${pad(at.getMinutes())}`;
      console.log(`${s.id}  ${local}  ${state}  ${s.title}`);
    }
    return;
  }
  if (isRunning(id, sessionsDir)) {
    console.log(`Claude session ${id} is already running in another terminal.`);
    return;
  }
  // The folder it ran in (Claude Code finds the transcript by it), if that still exists.
  const saved = read(path.join(sessionsDir, `${id}.open`));
  const cwd = saved && existsSync(saved) ? saved : process.cwd();
  // Ctrl+C belongs to Claude (cancel, twice to quit); this process only waits for it.
  process.on('SIGINT', () => {});
  const child = spawn(`claude --resume ${id}`, { cwd, stdio: 'inherit', shell: true });
  await new Promise<void>((resolve) => {
    child.on('exit', (code) => {
      process.exitCode = code ?? 0;
      resolve();
    });
    child.on('error', (err) => {
      console.error(`Could not start claude: ${err.message}`);
      process.exitCode = 1;
      resolve();
    });
  });
}
