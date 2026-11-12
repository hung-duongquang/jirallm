// PreCompact hook of the jirallm Claude Code plugin. Claude Code uses its stdout as instructions for
// the compaction summary: keep the ticket keys and PR numbers worked on, and list what was decided
// but not yet saved as a ticket note, so the SessionStart hook (source "compact") can re-add the
// tickets' state and Claude can save those decisions afterwards. Never blocks compaction.
import { existsSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { outputDir } from './changes.mjs';

let input = {};
try {
  input = JSON.parse(readFileSync(0, 'utf8') || '{}');
} catch {
  // No stdin: still give the generic instruction.
}

if (existsSync(outputDir)) {
  const id = typeof input.session_id === 'string' && /^[\w-]{1,100}$/.test(input.session_id) ? input.session_id : '';
  const keysFile = path.join(os.tmpdir(), 'jirallm-sessions', `${id}.keys`);
  const keys = id && existsSync(keysFile) ? readFileSync(keysFile, 'utf8').split('\n').filter(Boolean) : [];
  console.log(
    [
      'jirallm: in the summary, keep every Jira key (e.g. ZOD-1234), PR number, branch and worktree path this conversation worked on' +
        (keys.length ? ` (at least ${keys.join(', ')})` : '') +
        '.',
      'Add a short "Not yet in ticket notes" list: decisions, settled review points, agreements with people, deploy environments and open questions per ticket ' +
        'that were not saved with `jirallm note`. Ticket state (status, PRs, notes) is re-added from jirallm after compaction, so do not repeat it at length.',
    ].join('\n')
  );
}
