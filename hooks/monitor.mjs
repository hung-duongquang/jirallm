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
// `--session <id>`: started by Claude itself (Claude Desktop starts no plugin monitors), possibly long
// after the session started: it serves that session, no handshake guessing.
const given = process.argv[3] === '--session' && /^[\w-]{1,100}$/.test(process.argv[4] ?? '') ? process.argv[4] : undefined;
process.env.CLAUDE_PROJECT_DIR = projectDir;
// The delivery code comes from the newest installed plugin version and is reloaded after
// `jirallm upgrade` (checked every 5 minutes), so a running session needs no restart (latest.mjs).
const { latestHook } = await import('./latest.mjs');
const { pathToFileURL } = await import('node:url');
let changesPath = latestHook('changes.mjs');
let lib = await import(pathToFileURL(changesPath).href);
let libCheckedAt = Date.now();
async function refreshLib() {
  if (Date.now() - libCheckedAt < 5 * 60_000) return;
  libCheckedAt = Date.now();
  try {
    const next = latestHook('changes.mjs');
    if (next === changesPath) return;
    lib = await import(pathToFileURL(next).href);
    changesPath = next;
  } catch {
    // Keep the code that works.
  }
}
const { outputDir } = lib;
const pushChanges = (...a) => lib.pushChanges(...a);
const hasHotThread = (...a) => lib.hasHotThread(...a);
const jirallm = (...a) => lib.jirallm(...a);

const sessionsDir = path.join(os.tmpdir(), 'jirallm-sessions');
const POLL_MS = 30_000;
// A followed Slack thread with activity in the last 30 min: checked by this monitor every 10 s.
const HOT_POLL_MS = 10_000;
let hotCheckedAt = 0;
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

/** A handshake: lines project dir, source, transcript path, Claude Code pid (older hooks wrote fewer lines). */
function readStart(file) {
  const [project = '', source = '', transcript = '', claudePid = ''] = readFileSync(file, 'utf8').split('\n').map((l) => l.trim());
  return { project: path.resolve(project), source, transcript, claudePid, at: statSync(file).mtimeMs };
}

/** Claude Code's pid, which it gives to its hooks and plugin processes alike. */
const CLAUDE_PID = /^\d+$/.test(process.env.CLAUDE_PID ?? '') ? process.env.CLAUDE_PID : '';
/** The session id, when Claude Code passes it to plugin processes (undocumented; set for the Bash tool). */
const OWN_SESSION_ID = /^[\w-]{1,100}$/.test(process.env.CLAUDE_CODE_SESSION_ID ?? '') ? process.env.CLAUDE_CODE_SESSION_ID : '';
const APP = process.env.CLAUDE_CODE_ENTRYPOINT ?? '';

/**
 * The session of the Claude Code process this monitor runs in: the newest handshake written by a hook of
 * the same process. Exact, so sessions started together never swap monitors, and it follows `/resume`
 * and `claude --resume` (a new handshake with another id from the same process). Undefined while the
 * hook has not written one yet, or with a Claude Code that does not pass CLAUDE_PID.
 */
function ownSession() {
  if (!CLAUDE_PID) return undefined;
  // Only handshakes from about our start on: an old one can carry a reused pid.
  const own = startsSince(startedAt - 120_000).filter((s) => s.claudePid === CLAUDE_PID);
  // An app that hosts several sessions in one process (Claude Desktop may) gives them all one pid; the
  // session id Claude Code passes then tells ours apart. Not in the CLI: there the newest is right, as
  // `claude --resume` switches from the session the monitor started with to the resumed one.
  const byId = OWN_SESSION_ID && APP && APP !== 'cli' && own.find((s) => s.id === OWN_SESSION_ID)?.id;
  return byId || own[0]?.id;
}

/** Marks the session as served by this monitor (the UI shows it running; another monitor gives way). */
function claimOwn(id) {
  try {
    writeFileSync(claimFile(id), String(process.pid));
  } catch {
    // The claim mark is a bonus; delivery does not depend on it.
  }
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

let session = given;
while (!session && Date.now() - startedAt < HANDSHAKE_WAIT_MS) {
  // Without CLAUDE_PID (older Claude Code): the newest unclaimed handshake, which can pick another
  // session's when several start within seconds.
  session = CLAUDE_PID ? ownSession() : claimSession();
  if (!session) await sleep(2000);
}
if (!session) {
  // Quietly: a notification about plumbing is noise. Changes still arrive with each prompt.
  process.exit(0);
}
if (CLAUDE_PID || given) claimOwn(session);

/**
 * `<id>.alive` holds when this monitor last ran (every minute): the sessions whose heartbeats stopped
 * together are the ones that were open when VS Code closed or the machine went down (`jirallm resume --last`).
 */
let beatAt = 0;
function heartbeat(id) {
  if (Date.now() - beatAt < 60_000) return;
  beatAt = Date.now();
  try {
    writeFileSync(path.join(sessionsDir, `${id}.alive`), String(beatAt));
  } catch {
    // Only the reopen after a shutdown uses it.
  }
}

const claimedAt = Date.now();
for (let i = 0; ; i++) {
  // Check for a resume often at first (it follows the throwaway session within seconds), then each poll.
  if (given) {
    // Serves the session it was given.
  } else if (CLAUDE_PID) {
    const own = ownSession();
    if (own && own !== session) {
      session = own;
      claimOwn(session);
    }
  } else {
    session = followResume(session, claimedAt);
  }
  if (session !== heartbeat.session) {
    heartbeat.session = session;
    beatAt = 0;
  }
  heartbeat(session);
  await refreshLib();
  const hot = hasHotThread(session);
  if (hot && Date.now() - hotCheckedAt >= HOT_POLL_MS) {
    hotCheckedAt = Date.now();
    // Logs new replies to CHANGES.md, which pushChanges hands to the session right after.
    jirallm(['slack:hot', '--session', session, '--output-dir', outputDir], 25_000);
  }
  const report = pushChanges(session);
  if (report) console.log(report);
  await sleep(i < 20 ? 3000 : hot ? HOT_POLL_MS : POLL_MS); // Both are cheap: pushChanges only stats files until CHANGES.md moves.
}
