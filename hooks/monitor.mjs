// Background monitor of the jirallm Claude Code plugin (monitors/monitors.json). Claude Code starts it
// with every session and turns each line it prints into a notification for Claude, so CI results,
// reviews and ticket/Slack changes logged by the scheduled `jirallm watch` reach Claude mid-session
// without anyone starting `jirallm changes --follow` by hand.
//
// Monitors get no session id, but changes are delivered per session (each session has its own seen
// marker, shared with the prompt hook so nothing arrives twice). The SessionStart hook therefore
// leaves a handshake file (<tmp>/jirallm-sessions/<id>.start holding the project dir); this monitor
// claims the newest unclaimed one for its project, then polls every 30 s. Only changes to the
// session's own tickets (the keys its prompts named) are pushed; a session not on a ticket yet is
// never interrupted, and other tickets' changes wait for the next prompt as one line. It only starts the CLI
// when CHANGES.md changed after the session's marker, and every CLI run is short-lived, so nothing
// is left running when Claude Code stops the monitor.
import { existsSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const projectDir = path.resolve(process.argv[2] || process.cwd());
process.env.CLAUDE_PROJECT_DIR = projectDir;
const { outputDir, pushChanges } = await import('./changes.mjs');

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

/** A handshake: lines project dir, source, transcript path (older hooks wrote the project dir only). */
function readStart(file) {
  const [project = '', source = '', transcript = ''] = readFileSync(file, 'utf8').split('\n').map((l) => l.trim());
  return { project: path.resolve(project), source, transcript, at: statSync(file).mtimeMs };
}

/** Session handshakes for this project written since `since`, newest first. */
function startsSince(since) {
  if (!existsSync(sessionsDir)) return [];
  return readdirSync(sessionsDir)
    .filter((f) => f.endsWith('.start'))
    .flatMap((f) => {
      try {
        const s = { id: f.slice(0, -'.start'.length), ...readStart(path.join(sessionsDir, f)) };
        return s.at > since && s.project === projectDir ? [s] : [];
      } catch {
        return [];
      }
    })
    .sort((a, b) => b.at - a.at);
}

const claimFile = (id) => path.join(sessionsDir, `${id}.monitor`);
function tryClaim(id) {
  try {
    if (existsSync(claimFile(id)) && alive(Number(readFileSync(claimFile(id), 'utf8')))) return false;
    writeFileSync(claimFile(id), String(process.pid));
    return true;
  } catch {
    return false; // Lost a race with another monitor.
  }
}

/** Claims the newest session handshake for this project that no live monitor holds. */
function claimSession() {
  return startsSince(startedAt - 120_000).find((s) => tryClaim(s.id))?.id;
}

/**
 * `claude --resume` (and /resume) first starts a throwaway session, which the monitor may claim,
 * then switches to the resumed one: SessionStart runs again with source "resume" and another id,
 * but the monitor keeps running. The throwaway one never gets a transcript, so while ours has none,
 * move to a newer unclaimed resume handshake. Only shortly after the claim: an idle fresh session
 * (no transcript until its first prompt) must not take a resume in another terminal later on.
 */
function followResume(current, claimedAt) {
  if (Date.now() - claimedAt > 10 * 60_000) return current;
  let transcript = '';
  try {
    transcript = readStart(path.join(sessionsDir, `${current}.start`)).transcript;
  } catch {
    return current;
  }
  if (!transcript || existsSync(transcript)) return current;
  const next = startsSince(claimedAt - 5_000).find((s) => s.id !== current && s.source === 'resume' && tryClaim(s.id));
  if (!next) return current;
  try {
    unlinkSync(claimFile(current));
  } catch {
    // Already gone.
  }
  return next.id;
}

if (!existsSync(outputDir)) process.exit(0); // jirallm is not used in this workspace.

let session;
while (!session && Date.now() - startedAt < HANDSHAKE_WAIT_MS) {
  session = claimSession();
  if (!session) await sleep(2000);
}
if (!session) {
  // Quietly: a notification about plumbing is noise. Changes still arrive with each prompt.
  process.exit(0);
}

const claimedAt = Date.now();
for (let i = 0; ; i++) {
  // Check for a resume often at first (it follows the throwaway session within seconds), then each poll.
  session = followResume(session, claimedAt);
  const report = pushChanges(session);
  if (report) console.log(report);
  await sleep(i < 20 ? 3000 : POLL_MS); // Both are cheap: pushChanges only stats files until CHANGES.md moves.
}
