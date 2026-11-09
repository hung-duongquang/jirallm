import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { unseenCount, WATCH_AT_MARKER } from './watch.js';

export type StatusLineOptions = { outputDir?: string };

/** A watch run older than this means the scheduled task stopped (it normally runs every 1–15 minutes). */
const STALE_MINUTES = 20;

/**
 * One status-line segment for Claude Code: whether the scheduled `watch` is alive (time of its last
 * run, or how long it has been idle) and how many logged changes this session has not been given
 * yet. Empty when the workspace has no export directory.
 */
export function statusLine(outputDir: string, session: string | undefined, now = Date.now()): string {
  if (!existsSync(outputDir)) return '';
  const marker = path.join(outputDir, WATCH_AT_MARKER);
  const [iso, ...rest] = existsSync(marker) ? readFileSync(marker, 'utf-8').trim().split(' ') : [];
  const at = iso ? Date.parse(iso) : NaN;
  let watch: string;
  if (Number.isNaN(at)) watch = 'jirallm ⚠ watch not running';
  else {
    const minutes = Math.floor((now - at) / 60_000);
    const errors = rest.length ? ` ⚠ ${rest.join(' ')}` : '';
    watch =
      minutes > STALE_MINUTES
        ? `jirallm ⚠ watch idle ${minutes < 120 ? `${minutes}m` : `${Math.floor(minutes / 60)}h`}`
        : `jirallm ✓ ${new Date(at).toLocaleTimeString('sv-SE').slice(0, 5)}${errors}`;
  }
  let n = 0;
  try {
    n = unseenCount(outputDir, session && /^[\w-]{1,100}$/.test(session) ? session : undefined);
  } catch {
    // A status line never fails.
  }
  return `${watch} · ${n ? `${n} new for Claude` : 'Claude up to date'}`;
}

/** `jirallm status-line`: reads Claude Code's status-line JSON on stdin (session id, project dir) and prints the segment. */
export function runStatusLine(opts: StatusLineOptions): void {
  let input: { session_id?: string; workspace?: { project_dir?: string }; cwd?: string } = {};
  try {
    if (!process.stdin.isTTY) input = JSON.parse(readFileSync(0, 'utf-8') || '{}');
  } catch {
    // No or bad stdin: use the current directory.
  }
  const project = input.workspace?.project_dir ?? input.cwd ?? process.cwd();
  const outputDir = opts.outputDir ?? path.join(project, 'jira-export');
  const line = statusLine(outputDir, input.session_id);
  if (line) console.log(line);
}
