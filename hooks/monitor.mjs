// Background monitor of the jirallm Claude Code plugin (monitors/monitors.json). Claude Code starts it
// with every session and turns each line it prints into a notification for Claude, so CI results,
// reviews and ticket/Slack changes logged by the scheduled `jirallm watch` reach Claude mid-session
// without anyone starting `jirallm changes --follow` by hand.
//
// Monitors get no session id, but changes are delivered per session (each session has its own seen
// marker, shared with the prompt hook so nothing arrives twice). The SessionStart hook therefore
// leaves a handshake file (<tmp>/jirallm-sessions/<id>.start holding the project dir); this monitor
// claims the newest unclaimed one for its project, then polls every 30 s. It only starts the CLI
// when CHANGES.md changed after the session's marker, and every CLI run is short-lived, so nothing
// is left running when Claude Code stops the monitor.
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const projectDir = path.resolve(process.argv[2] || process.cwd());
process.env.CLAUDE_PROJECT_DIR = projectDir;
const { outputDir, unseenChanges } = await import('./changes.mjs');

const sessionsDir = path.join(os.tmpdir(), 'jirallm-sessions');
const POLL_MS = 30_000;
const HANDSHAKE_WAIT_MS = 90_000;
const startedAt = Date.now();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

/** Claims the newest session handshake for this project that no live monitor holds. */
function claimSession() {
  if (!existsSync(sessionsDir)) return undefined;
  const starts = readdirSync(sessionsDir)
    .filter((f) => f.endsWith('.start'))
    .map((f) => ({ id: f.slice(0, -'.start'.length), file: path.join(sessionsDir, f) }))
    .filter((s) => {
      try {
        return statSync(s.file).mtimeMs > startedAt - 120_000 && path.resolve(readFileSync(s.file, 'utf8').trim()) === projectDir;
      } catch {
        return false;
      }
    })
    .sort((a, b) => statSync(b.file).mtimeMs - statSync(a.file).mtimeMs);
  for (const s of starts) {
    const claim = path.join(sessionsDir, `${s.id}.monitor`);
    try {
      if (existsSync(claim) && alive(Number(readFileSync(claim, 'utf8')))) continue;
      writeFileSync(claim, String(process.pid));
      return s.id;
    } catch {
      // Lost a race with another monitor: try the next one.
    }
  }
  return undefined;
}

if (!existsSync(outputDir)) process.exit(0); // jirallm is not used in this workspace.

let session;
while (!session && Date.now() - startedAt < HANDSHAKE_WAIT_MS) {
  session = claimSession();
  if (!session) await sleep(2000);
}
if (!session) {
  console.log('jirallm monitor: no session handshake from the SessionStart hook; changes still arrive with each prompt.');
  process.exit(0);
}

for (;;) {
  const report = unseenChanges(session, true);
  if (report) console.log(report);
  await sleep(POLL_MS);
}
