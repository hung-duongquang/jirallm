import { closeSync, existsSync, openSync, readdirSync, readFileSync, readSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isMarkedOpen, isRunning } from './resume.js';
import { sessionKeys } from './statusLine.js';
import { deliveryAckPath, deliveryLogPath, pendingCounts, readAck, readDeliveries, type Delivery } from './watch.js';

export type SessionDelivery = Delivery & { read: boolean };
export type SessionOverview = {
  id: string;
  /** Slack thread title or first prompt (saved by the plugin's prompt hook, else read from the transcript). */
  title: string;
  keys: string[];
  /** True while the plugin's background monitor for this session is running. */
  monitor: boolean;
  /** The transcript was written in the last two hours, or the monitor runs. */
  live: boolean;
  /** Claude Code runs it now (its monitor started after this boot). */
  running: boolean;
  /** Brought back after a reboot (`jirallm resume`): the plugin marked it open and the user has not ended it. */
  reopen: boolean;
  /** Not known to run (no monitor), but its transcript was written since this boot: it may still be open in a terminal. */
  maybeRunning: boolean;
  lastActivity: string;
  /** Changes to the session's tickets that have not been handed to it yet. */
  waiting: number;
  reply?: string;
  readAt?: string;
  deliveries: SessionDelivery[];
};

const SESSION_DIR = '.changes.seen.d';
const LIVE_MS = 2 * 3600 * 1000;
const MAX_TITLE = 80;
const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
const read = (file: string) => {
  try {
    return readFileSync(file, 'utf-8').trim();
  } catch {
    return '';
  }
};
const mtime = (file: string) => {
  try {
    return statSync(file).mtimeMs;
  } catch {
    return 0;
  }
};

/** The first prompt the user typed, from the head of a Claude Code transcript (JSONL), or ''. */
export function firstPrompt(transcript: string, maxBytes = 256 * 1024): string {
  let text: string;
  try {
    const fd = openSync(transcript, 'r');
    try {
      const buf = Buffer.alloc(maxBytes);
      text = buf.subarray(0, readSync(fd, buf, 0, maxBytes, 0)).toString('utf-8');
    } finally {
      closeSync(fd);
    }
  } catch {
    return '';
  }
  for (const line of text.split('\n')) {
    try {
      const e = JSON.parse(line) as { type?: string; isMeta?: boolean; message?: { content?: unknown } };
      if (e.type !== 'user' || e.isMeta) continue;
      const c = e.message?.content;
      const prompt = typeof c === 'string' ? c : Array.isArray(c) ? c.find((p: { type?: string; text?: string }) => p.type === 'text')?.text : undefined;
      if (!prompt) continue;
      const command = prompt.match(/<command-name>([^<]*)<\/command-name>/)?.[1];
      // A slash command names the session ("/jirallm:implement ZOD-1"); other tags (notifications, caveats) are skipped.
      if (!command && prompt.startsWith('<')) continue;
      const one = (command ? `${command} ${prompt.match(/<command-args>([^<]*)<\/command-args>/)?.[1] ?? ''}` : prompt).replace(/\s+/g, ' ').trim();
      return one.length > MAX_TITLE ? `${one.slice(0, MAX_TITLE - 1)}…` : one;
    } catch {
      // A cut last line.
    }
  }
  return '';
}

/**
 * The Claude Code sessions of this workspace that are live (monitor running or transcript written in
 * the last two hours) or were handed jirallm changes in the last `days` days, newest first: what
 * each got, when and how, and whether a Claude turn has read it. For `jirallm ui`.
 */
export function claudeSessions(outputDir: string, days = 7, sessionsDir = path.join(os.tmpdir(), 'jirallm-sessions'), now = Date.now()): SessionOverview[] {
  const dir = path.join(outputDir, SESSION_DIR);
  const project = path.resolve(path.dirname(outputDir));
  const cutoff = now - days * 24 * 3600 * 1000;
  const ids = new Set<string>();
  if (existsSync(dir)) for (const f of readdirSync(dir)) if (f.endsWith('.log')) ids.add(f.slice(0, -'.log'.length));
  const transcripts = new Map<string, string>();
  if (existsSync(sessionsDir)) {
    for (const f of readdirSync(sessionsDir)) {
      if (!f.endsWith('.start')) continue;
      const id = f.slice(0, -'.start'.length);
      const [dirLine = '', , transcript = ''] = read(path.join(sessionsDir, f)).split('\n').map((l) => l.trim());
      if (path.resolve(dirLine) !== project) continue;
      // Handshakes from before 0.32 hold no transcript path: use Claude Code's default location.
      transcripts.set(id, transcript || path.join(os.homedir(), '.claude', 'projects', project.replace(/[^a-zA-Z0-9]/g, '-'), `${id}.jsonl`));
      ids.add(id);
    }
  }
  const out: SessionOverview[] = [];
  for (const id of ids) {
    const transcript = transcripts.get(id) ?? '';
    const pid = Number(read(path.join(sessionsDir, `${id}.monitor`)));
    const monitor = pid > 0 && alive(pid);
    const wrote = transcript ? mtime(transcript) : 0;
    const log = readDeliveries(outputDir, id);
    const last = Math.max(mtime(deliveryLogPath(outputDir, id)), mtime(deliveryAckPath(outputDir, id)), wrote);
    // A session without a transcript (the throwaway one `claude --resume` starts first) is never shown.
    const live = (monitor || now - wrote < LIVE_MS) && (wrote > 0 || log.length > 0);
    const reopen = wrote > 0 && isMarkedOpen(id, sessionsDir);
    const running = isRunning(id, sessionsDir);
    if (!live && !reopen && (!log.length || last < cutoff)) continue;
    const keys = sessionKeys(id, sessionsDir);
    const ack = readAck(outputDir, id);
    out.push({
      id,
      title: read(path.join(sessionsDir, `${id}.title`)) || (transcript ? firstPrompt(transcript) : ''),
      keys,
      monitor,
      live,
      running,
      reopen,
      maybeRunning: !running && wrote >= now - os.uptime() * 1000,
      lastActivity: new Date(last).toISOString(),
      waiting: pendingCounts(outputDir, id, keys).waiting,
      ...(ack?.reply && { reply: ack.reply }),
      ...(ack && { readAt: ack.at }),
      deliveries: log
        .slice(-30)
        .reverse()
        .map((d) => ({ ...d, read: !!ack && ack.n >= d.n })),
    });
  }
  return out.sort((a, b) => Number(b.live) - Number(a.live) || b.lastActivity.localeCompare(a.lastActivity));
}
