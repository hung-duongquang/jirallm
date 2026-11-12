// Shared by the jirallm plugin hooks: run the CLI, read this session's unseen changes, and turn
// them into a one-line message the user sees in Claude Code (so they know Claude got them).
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const outputDir = path.join(process.env.CLAUDE_PROJECT_DIR || process.cwd(), 'jira-export');
const changesFile = path.join(outputDir, 'CHANGES.md');
const SESSION_ID = /^[\w-]{1,100}$/;

// On Windows the global command is a .cmd/.ps1 shim, which needs a shell; pass one quoted string there.
export function jirallm(args, timeout) {
  const r =
    process.platform === 'win32'
      ? spawnSync(['jirallm', ...args].map((a) => (/[\s"&|<>^]/.test(a) ? `"${a}"` : a)).join(' '), { encoding: 'utf8', shell: true, timeout })
      : spawnSync('jirallm', args, { encoding: 'utf8', timeout });
  return r.status === 0 ? r.stdout.trim() : '';
}

/** The session's seen marker, else the shared one (a session from before per-session markers). */
function markerOf(sessionId) {
  const own = sessionId && SESSION_ID.test(sessionId) ? path.join(outputDir, '.changes.seen.d', sessionId) : '';
  if (own && existsSync(own)) return own;
  return path.join(outputDir, '.changes.seen');
}

const lines = (file) => {
  try {
    return existsSync(file) ? readFileSync(file, 'utf8').split('\n').map((l) => l.trim()).filter(Boolean) : [];
  } catch {
    return [];
  }
};

/**
 * What this session follows, for change delivery: the ticket keys its prompts named (`<id>.keys`)
 * and the Slack threads they linked (`<id>.follow`, as "slack/<channel>-<ts>", the export folder
 * name that `watch` logs new replies under). Both written by the prompt hook.
 */
export function sessionKeys(sessionId) {
  if (!sessionId || !SESSION_ID.test(sessionId)) return [];
  const dir = path.join(os.tmpdir(), 'jirallm-sessions');
  return [...lines(path.join(dir, `${sessionId}.keys`)), ...lines(path.join(dir, `${sessionId}.follow`))];
}

const newerThan = (file, marker) => !existsSync(marker) || statSync(file).mtimeMs > statSync(marker).mtimeMs;

/**
 * This session's unseen changes as printed by `jirallm changes --unseen --session <id> --keys …`
 * (which marks them seen for this session only), or ''. Changes to the session's tickets come in
 * full; others as one line of names, so a session is not drawn into unrelated work. With `quick`,
 * the CLI is only started when CHANGES.md changed after the session's marker: usually two stat
 * calls per prompt.
 */
export function unseenChanges(sessionId, quick, keys = sessionKeys(sessionId), via = 'prompt') {
  try {
    if (!existsSync(changesFile)) return '';
    if (quick && !newerThan(changesFile, markerOf(sessionId))) return '';
    const args = ['changes', '--unseen', '--output-dir', outputDir];
    if (sessionId && SESSION_ID.test(sessionId)) args.push('--session', sessionId, `--keys=${keys.join(',')}`, '--via', via);
    return jirallm(args, 10000);
  } catch {
    return ''; // Context is a bonus; never fail the prompt.
  }
}

/**
 * For the background monitor: unseen changes to the session's own tickets only, remembered as
 * pushed so the next prompt does not repeat them. '' without keys (a session not on a ticket yet
 * is never interrupted) or when CHANGES.md did not move since the last push.
 */
export function pushChanges(sessionId) {
  try {
    const keys = sessionKeys(sessionId);
    if (!keys.length || !existsSync(changesFile)) return '';
    const own = path.join(outputDir, '.changes.seen.d', sessionId);
    if (!newerThan(changesFile, `${own}.pushed`) || !newerThan(changesFile, markerOf(sessionId))) return '';
    return jirallm(['changes', '--output-dir', outputDir, '--session', sessionId, `--keys=${keys.join(',')}`, '--push-only', '--via', 'monitor'], 10000);
  } catch {
    return '';
  }
}

/** "📥 jirallm #4: 3 changes added to Claude's context — ZOD-4083, PR #3017, Slack thread" from a change report. */
export function changesMessage(report) {
  const n = report.match(/^\[jirallm delivery (#\d+)/)?.[1];
  const items = [];
  for (const line of report.split('\n')) {
    if (!line.startsWith('- ') || line.startsWith('- …')) continue;
    let item = line.slice(2).split(':')[0].trim();
    if (item.startsWith('slack/')) item = 'Slack thread';
    else item = item.replace(/^PR (#\d+) \(([^)]+)\)$/, '$1 $2');
    items.push(item);
  }
  if (items.length === 0) return '';
  const names = [...new Set(items)];
  const shown = names.slice(0, 5).join(', ') + (names.length > 5 ? `, +${names.length - 5} more` : '');
  return `📥 jirallm${n ? ` ${n}` : ''}: ${items.length} change${items.length === 1 ? '' : 's'} added to Claude's context — ${shown}`;
}
