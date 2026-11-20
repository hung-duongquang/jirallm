// SessionEnd hook of the jirallm Claude Code plugin. When the user ends a session (/exit, /clear,
// logout), it is no longer brought back after a reboot: its open marker goes, and the workspace's
// VS Code resume tasks are rewritten in the background. A session that ends any other way (a reboot,
// a closed terminal or window) stays marked, so `jirallm resume` reopens it. It never fails.
import { readFileSync } from 'node:fs';
import { markOpen, refreshResumeTasks } from './changes.mjs';

const ENDED_BY_USER = new Set(['prompt_input_exit', 'clear', 'logout']);

let input = {};
try {
  input = JSON.parse(readFileSync(0, 'utf8') || '{}');
} catch {
  // No or bad stdin: nothing to unmark.
}
if (typeof input.session_id === 'string' && ENDED_BY_USER.has(input.reason)) {
  markOpen(input.session_id, false);
  refreshResumeTasks();
}
