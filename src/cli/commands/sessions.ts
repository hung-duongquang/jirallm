import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { sessionKeys } from './statusLine.js';
import { deliveryAckPath, deliveryLogPath, pendingCounts, readAck, readDeliveries, type Delivery } from './watch.js';

export type SessionDelivery = Delivery & { read: boolean };
export type SessionOverview = {
  id: string;
  /** First prompt of the session (or its Slack thread title), as saved by the plugin's prompt hook. */
  title: string;
  keys: string[];
  /** True while the plugin's background monitor for this session is running. */
  monitor: boolean;
  lastActivity: string;
  /** Changes to the session's tickets that have not been handed to it yet. */
  waiting: number;
  reply?: string;
  readAt?: string;
  deliveries: SessionDelivery[];
};

const SESSION_DIR = '.changes.seen.d';
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
const mtime = (file: string) => (existsSync(file) ? statSync(file).mtimeMs : 0);

/**
 * The Claude Code sessions that were handed jirallm changes in the last `days` days, newest first:
 * what each got, when and how, and whether a Claude turn has read it. For `jirallm ui`.
 */
export function claudeSessions(outputDir: string, days = 7, sessionsDir = path.join(os.tmpdir(), 'jirallm-sessions'), now = Date.now()): SessionOverview[] {
  const dir = path.join(outputDir, SESSION_DIR);
  if (!existsSync(dir)) return [];
  const cutoff = now - days * 24 * 3600 * 1000;
  const out: SessionOverview[] = [];
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.log')) continue;
    const id = f.slice(0, -'.log'.length);
    const last = Math.max(mtime(deliveryLogPath(outputDir, id)), mtime(deliveryAckPath(outputDir, id)));
    if (last < cutoff) continue;
    const keys = sessionKeys(id, sessionsDir);
    const ack = readAck(outputDir, id);
    const pid = Number(read(path.join(sessionsDir, `${id}.monitor`)));
    out.push({
      id,
      title: read(path.join(sessionsDir, `${id}.title`)),
      keys,
      monitor: pid > 0 && alive(pid),
      lastActivity: new Date(last).toISOString(),
      waiting: pendingCounts(outputDir, id, keys).waiting,
      ...(ack?.reply && { reply: ack.reply }),
      ...(ack && { readAt: ack.at }),
      deliveries: readDeliveries(outputDir, id)
        .slice(-30)
        .reverse()
        .map((d) => ({ ...d, read: !!ack && ack.n >= d.n })),
    });
  }
  return out.sort((a, b) => b.lastActivity.localeCompare(a.lastActivity));
}
