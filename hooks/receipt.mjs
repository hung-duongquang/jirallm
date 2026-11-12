// Read receipts for jirallm change deliveries, shared by the plugin's PostToolUse and Stop hooks.
// Every change report handed to a session starts with "[jirallm delivery #N · …]" (logged in
// jira-export/.changes.seen.d/<id>.log). Once that tag is in the session's transcript and Claude has
// acted after it (a tool call, or the end of its turn), the delivery has been seen: the highest such
// N goes to <id>.acked, which the status line, `jirallm changes --log` and `jirallm ui` show.
// Usually costs two stat calls: the transcript is only read while a logged delivery is newer than
// the receipt.
import { closeSync, existsSync, fstatSync, openSync, readFileSync, readSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { outputDir } from './changes.mjs';

const SESSION_ID = /^[\w-]{1,100}$/;
const DELIVERY = /\[jirallm delivery #(\d+) /g;
const TAIL_BYTES = 2 * 1024 * 1024;

const mtime = (file) => {
  try {
    return statSync(file).mtimeMs;
  } catch {
    return 0;
  }
};

/** The last `TAIL_BYTES` of a file as text (deliveries waiting for a receipt are recent). */
function tail(file) {
  const fd = openSync(file, 'r');
  try {
    const size = fstatSync(fd).size;
    const start = Math.max(0, size - TAIL_BYTES);
    const buf = Buffer.alloc(size - start);
    readSync(fd, buf, 0, buf.length, start);
    return buf.toString('utf8');
  } finally {
    closeSync(fd);
  }
}

/**
 * Writes the receipt for the deliveries the transcript holds. With `reply` (the Stop hook: Claude's
 * answer at the end of a turn), its first line goes to <id>.reply for the UI, once a delivery was seen.
 */
export function ackDeliveries(sessionId, transcriptPath, reply) {
  try {
    if (!sessionId || !SESSION_ID.test(sessionId) || typeof transcriptPath !== 'string' || !existsSync(transcriptPath)) return;
    const dir = path.join(outputDir, '.changes.seen.d');
    const log = path.join(dir, `${sessionId}.log`);
    const file = path.join(dir, `${sessionId}.acked`);
    const logAt = mtime(log);
    if (!logAt) return; // This session was never handed anything.
    if (logAt > mtime(file)) {
      let n = 0;
      for (const line of tail(transcriptPath).split('\n')) {
        // Only what reached Claude (prompts, hook context, monitor notifications), not its own tool calls.
        if (!line.includes('[jirallm delivery #') || !/"type":"(user|attachment)"/.test(line)) continue;
        for (const m of line.matchAll(DELIVERY)) n = Math.max(n, Number(m[1]));
      }
      let acked = 0;
      try {
        acked = JSON.parse(readFileSync(file, 'utf8')).n ?? 0;
      } catch {
        // First receipt for this session.
      }
      if (n > acked) writeFileSync(file, JSON.stringify({ n, at: new Date().toISOString() }));
    }
    const line = reply ? String(reply).split('\n').map((l) => l.trim()).find(Boolean)?.slice(0, 160) : '';
    if (line && existsSync(file)) writeFileSync(path.join(dir, `${sessionId}.reply`), JSON.stringify({ at: new Date().toISOString(), text: line }));
  } catch {
    // A receipt is a bonus; never fail the hook.
  }
}
