// Shared by the jirallm plugin hooks: run the CLI, read this session's unseen changes, and turn
// them into a one-line message the user sees in Claude Code (so they know Claude got them).
import { spawnSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
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

/**
 * This session's unseen changes as printed by `jirallm changes --unseen --session <id>` (which marks
 * them seen for this session only), or ''. With `quick`, the CLI is only started when CHANGES.md
 * changed after the session's marker: usually two stat calls per prompt.
 */
export function unseenChanges(sessionId, quick) {
  try {
    if (!existsSync(changesFile)) return '';
    const marker = markerOf(sessionId);
    if (quick && existsSync(marker) && statSync(changesFile).mtimeMs <= statSync(marker).mtimeMs) return '';
    const args = ['changes', '--unseen', '--output-dir', outputDir];
    if (sessionId && SESSION_ID.test(sessionId)) args.push('--session', sessionId);
    return jirallm(args, 10000);
  } catch {
    return ''; // Context is a bonus; never fail the prompt.
  }
}

/** "📥 jirallm: 3 changes added to Claude's context — ZOD-4083, PR #3017, Slack thread" from a change report. */
export function changesMessage(report) {
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
  return `📥 jirallm: ${items.length} change${items.length === 1 ? '' : 's'} added to Claude's context — ${shown}`;
}
