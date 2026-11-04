// UserPromptSubmit hook of the jirallm Claude Code plugin: when the background `jirallm watch` logged
// something since Claude last saw CHANGES.md, the unseen changes are added to the prompt's context.
// Usually only two stat calls (no CLI start), so it adds nothing noticeable to a prompt. It never
// blocks the prompt.
import { spawnSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';

const outputDir = path.join(process.env.CLAUDE_PROJECT_DIR || process.cwd(), 'jira-export');
const changes = path.join(outputDir, 'CHANGES.md');
const seen = path.join(outputDir, '.changes.seen');

try {
  if (existsSync(changes) && (!existsSync(seen) || statSync(changes).mtimeMs > statSync(seen).mtimeMs)) {
    const args = ['changes', '--unseen', '--output-dir', outputDir];
    const r =
      process.platform === 'win32'
        ? spawnSync(['jirallm', ...args].map((a) => (/[\s"]/.test(a) ? `"${a}"` : a)).join(' '), { encoding: 'utf8', shell: true, timeout: 10000 })
        : spawnSync('jirallm', args, { encoding: 'utf8', timeout: 10000 });
    if (r.status === 0 && r.stdout.trim()) process.stdout.write(r.stdout);
  }
} catch {
  // Context is a bonus; never fail the prompt.
}
