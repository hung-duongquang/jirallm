// Stop hook of the jirallm Claude Code plugin. When the turn that just ended did something that
// usually settles ticket facts (submitted a PR review, merged, pushed, opened a PR, moved or
// commented on a ticket) and did not write a ticket note, Claude is asked once to save what is worth
// keeping with `jirallm note`. Stateless: it reads only the current turn (from the last user prompt)
// out of the transcript, and stays quiet while Claude is already continuing for a stop hook.
// It also writes the read receipt for jirallm change deliveries (see ackDeliveries).
import { closeSync, existsSync, fstatSync, mkdirSync, openSync, readFileSync, readSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { outputDir } from './changes.mjs';

const TAIL_BYTES = 4 * 1024 * 1024;
const ISSUE_KEY = /\b[A-Z][A-Z0-9]+-\d+\b/g;
const TRIGGERS = [
  [/\bgh pr review\b|\bgh api\b[^\n]*\/reviews\b[^\n]*(-X|--method)\s*POST|\bgh api\b[^\n]*(-X|--method)\s*POST[^\n]*\/reviews\b/, 'submitted a PR review'],
  [/\bgh (pr|stack) merge\b/, 'merged a PR'],
  [/\bgh pr create\b/, 'opened a PR'],
  [/\bgit push\b/, 'pushed'],
  [/\bjirallm (transition|comment|start)\b/, 'changed a ticket'],
];
const NOTE = /\bjirallm note\b/;

let input = {};
try {
  input = JSON.parse(readFileSync(0, 'utf8') || '{}');
} catch {
  process.exit(0);
}

/** The last `TAIL_BYTES` of the transcript as parsed JSONL entries (a cut first line is dropped). */
function tailEntries(file) {
  const fd = openSync(file, 'r');
  try {
    const size = fstatSync(fd).size;
    const start = Math.max(0, size - TAIL_BYTES);
    const buf = Buffer.alloc(size - start);
    readSync(fd, buf, 0, buf.length, start);
    const lines = buf.toString('utf8').split('\n');
    if (start > 0) lines.shift();
    return lines.flatMap((l) => {
      try {
        return l.trim() ? [JSON.parse(l)] : [];
      } catch {
        return [];
      }
    });
  } finally {
    closeSync(fd);
  }
}

/** A prompt the user typed (not a tool result handed back as a user message). */
const isUserPrompt = (e) =>
  e.type === 'user' &&
  (typeof e.message?.content === 'string' ||
    (Array.isArray(e.message?.content) && e.message.content.some((c) => c.type === 'text') && !e.message.content.some((c) => c.type === 'tool_result')));

const DELIVERY = /\[jirallm delivery #(\d+) /g;

/**
 * Records that a Claude turn finished with jirallm deliveries in its context: the highest
 * "[jirallm delivery #N" found in prompts, hook context and monitor notifications of the transcript
 * goes to jira-export/.changes.seen.d/<id>.acked with the first line of Claude's reply, which the
 * status line and `jirallm changes --log` show as "✓ read".
 */
function ackDeliveries(entries, id) {
  let n = 0;
  for (const e of entries) {
    if (e.type !== 'user' && e.type !== 'attachment') continue;
    for (const m of JSON.stringify(e.message ?? e.attachment ?? '').matchAll(DELIVERY)) n = Math.max(n, Number(m[1]));
  }
  if (!n) return;
  const file = path.join(outputDir, '.changes.seen.d', `${id}.acked`);
  let acked = 0;
  try {
    acked = JSON.parse(readFileSync(file, 'utf8')).n ?? 0;
  } catch {
    // First ack for this session.
  }
  if (n <= acked) return;
  const reply = String(input.last_assistant_message ?? '').split('\n').map((l) => l.trim()).find(Boolean)?.slice(0, 120);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify({ n, at: new Date().toISOString(), ...(reply && { reply }) }));
}

try {
  if (!existsSync(outputDir) || typeof input.transcript_path !== 'string' || !existsSync(input.transcript_path)) process.exit(0);
  const entries = tailEntries(input.transcript_path);
  const sessionId = typeof input.session_id === 'string' && /^[\w-]{1,100}$/.test(input.session_id) ? input.session_id : '';
  try {
    if (sessionId) ackDeliveries(entries, sessionId);
  } catch {
    // The read receipt is a bonus too.
  }
  if (input.stop_hook_active) process.exit(0);
  let from = entries.length - 1;
  while (from >= 0 && !isUserPrompt(entries[from])) from--;
  const commands = entries
    .slice(from + 1)
    .filter((e) => e.type === 'assistant' && Array.isArray(e.message?.content))
    .flatMap((e) => e.message.content)
    .filter((c) => c.type === 'tool_use' && typeof c.input?.command === 'string')
    .map((c) => c.input.command);
  if (!commands.length || commands.some((c) => NOTE.test(c))) process.exit(0);
  const did = [...new Set(TRIGGERS.filter(([re]) => commands.some((c) => re.test(c))).map(([, what]) => what))];
  if (!did.length) process.exit(0);

  const id = typeof input.session_id === 'string' && /^[\w-]{1,100}$/.test(input.session_id) ? input.session_id : '';
  const keysFile = path.join(os.tmpdir(), 'jirallm-sessions', `${id}.keys`);
  const text = `${commands.join('\n')}\n${input.last_assistant_message ?? ''}`;
  let keys = [...new Set(text.match(ISSUE_KEY) ?? [])].filter((k) => existsSync(path.join(outputDir, k.toLowerCase())));
  if (!keys.length && id && existsSync(keysFile)) keys = readFileSync(keysFile, 'utf8').split('\n').filter(Boolean);
  const target = keys.length ? keys.slice(0, 3).join(', ') : 'the ticket';

  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'Stop',
        additionalContext:
          `jirallm: this turn ${did.join(', ')}. If it settled anything worth keeping about ${target} that is not in Jira, git or its notes ` +
          '(review points settled or not to re-raise, decisions and who made them, deploy env, what it waits on), save one line per fact with ' +
          '`jirallm note <KEY> "<text>"` from the workspace root. If there is nothing to keep, end with no further reply.',
      },
    })
  );
} catch {
  // A reminder is a bonus; never block the stop on an error.
}
