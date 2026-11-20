// PostToolUse hook of the jirallm Claude Code plugin (every tool). A jirallm change delivery that
// reached Claude (prompt or session-start context, a monitor notification) counts as seen once Claude
// acts after it, not only when its turn ends: a long turn would otherwise show "not read yet" for
// minutes. Two stat calls unless a delivery is waiting for its receipt; prints nothing.
import { readFileSync } from 'node:fs';
import { ackDeliveries } from './receipt.mjs';

try {
  const input = JSON.parse(readFileSync(0, 'utf8') || '{}');
  ackDeliveries(input.session_id, input.transcript_path);
} catch {
  // Never get in the way of a tool call.
}
