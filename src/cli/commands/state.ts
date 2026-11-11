import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { keyFromBranch } from './prContext.js';
import type { PrSnapshot } from './prStatus.js';

export type StateOptions = { outputDir?: string; repo?: string; notes?: string };
export type NoteOptions = { outputDir?: string };

/** Runs git in `cwd` and returns stdout ('' on failure: the card is best effort). */
export type Git = (cwd: string, args: string[]) => string;

export const NOTES_FILE = 'notes.md';
const PRS_FILE = '.prs.json';
const MAX_NOTE_LINES = 40;
const GENERATED = new Set(['task.md', '.task.previous.md']);

const defaultGit: Git = (cwd, args) => {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 10_000 });
  } catch {
    return '';
  }
};

const ticketDir = (outputDir: string, key: string) => path.join(outputDir, key.toLowerCase());

/** Scalar frontmatter values and the first heading of an exported task.md. */
export function readTask(file: string): { fields: Record<string, string>; title?: string } | undefined {
  if (!existsSync(file)) return undefined;
  const text = readFileSync(file, 'utf8');
  const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  const fields: Record<string, string> = {};
  for (const line of (fm?.[1] ?? '').split(/\r?\n/)) {
    const m = /^(\w+):\s*(.+)$/.exec(line);
    if (m) fields[m[1]!] = m[2]!.trim().replace(/^"(.*)"$/, '$1');
  }
  const body = fm ? text.slice(fm[0].length) : text;
  return { fields, title: /^# (.+)$/m.exec(body)?.[1]?.trim() };
}

/** Worktrees (path, branch) whose branch carries `key`, from `git worktree list --porcelain`. */
export function worktreesFor(porcelain: string, key: string): Array<{ path: string; branch: string }> {
  const out: Array<{ path: string; branch: string }> = [];
  for (const block of porcelain.split(/\r?\n\r?\n/)) {
    const wt = /^worktree (.+)$/m.exec(block)?.[1];
    const branch = /^branch refs\/heads\/(.+)$/m.exec(block)?.[1];
    if (wt && branch && keyFromBranch(branch) === key) out.push({ path: wt.trim(), branch: branch.trim() });
  }
  return out;
}

function prLine(p: PrSnapshot): string {
  const ci = p.failed.length ? `CI failed: ${p.failed.join(', ')}` : p.pending ? `CI pending (${p.pending})` : 'CI green';
  const reviews = Object.entries(p.reviews).filter(([who]) => !/copilot|\[bot\]/i.test(who)).map(([who, st]) => `${who} ${st.split('@')[0]}`);
  return `- PR #${p.number} (mine, open): ${ci}; reviews: ${reviews.join(', ') || 'none'}${p.awaiting ? `; ${p.awaiting} thread(s) awaiting me` : ''}${p.url ? ` · ${p.url}` : ''}`;
}

/**
 * A compact, local-only card for one ticket: the exported Jira fields, my open PRs for it (from the
 * watch state), its worktrees, the files I keep next to the export, and the notes kept with
 * `jirallm note`. No network calls, so it is cheap enough for a prompt hook.
 */
export function ticketState(key: string, outputDir: string, repo: string | undefined, git: Git = defaultGit): string {
  const dir = ticketDir(outputDir, key);
  const task = readTask(path.join(dir, 'task.md'));
  const out = [`## ${key}${task?.title ? `: ${task.title}` : ''}`];
  if (task) {
    const f = task.fields;
    out.push(`- Jira (export of ${(f.updatedAt ?? '?').slice(0, 16).replace('T', ' ')}): ${f.status ?? '?'} · ${f.issueType ?? '?'} · assignee ${f.assignee ?? 'none'}${f.parent ? ` · parent ${f.parent}` : ''}`);
  } else {
    out.push(`- Not exported (\`jirallm ${key} --no-status-changes\`)`);
  }

  const prsFile = path.join(outputDir, PRS_FILE);
  let repoPath = repo;
  if (existsSync(prsFile)) {
    try {
      const state = JSON.parse(readFileSync(prsFile, 'utf8')) as { meta?: { repoPath?: string }; prs?: Record<string, PrSnapshot> };
      repoPath ??= state.meta?.repoPath;
      for (const p of Object.values(state.prs ?? {})) if (p.key === key) out.push(prLine(p));
    } catch { /* a broken watch state only hides the PR line */ }
  }

  if (repoPath && existsSync(repoPath)) {
    for (const wt of worktreesFor(git(repoPath, ['worktree', 'list', '--porcelain']), key)) {
      const dirty = git(wt.path, ['status', '--porcelain']).split('\n').filter(Boolean).length;
      const ahead = git(wt.path, ['rev-list', '--count', '@{u}..HEAD']).trim();
      out.push(`- Worktree ${wt.path} · ${wt.branch}${dirty ? ` · ${dirty} uncommitted` : ''}${ahead && ahead !== '0' ? ` · ${ahead} unpushed` : ''}`);
    }
  }

  if (existsSync(dir)) {
    const own = readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isFile() && !GENERATED.has(e.name) && e.name !== NOTES_FILE && !e.name.startsWith('.'))
      .map((e) => e.name);
    if (own.length) out.push(`- Files: ${own.map((n) => `${path.basename(outputDir)}/${key.toLowerCase()}/${n}`).join(', ')}`);
  }

  const notesFile = path.join(dir, NOTES_FILE);
  const notes = existsSync(notesFile) ? readFileSync(notesFile, 'utf8').split(/\r?\n/).filter((l) => l.trim() && !/^#/.test(l)) : [];
  if (notes.length) {
    out.push('- Notes:');
    if (notes.length > MAX_NOTE_LINES) out.push(`  (… ${notes.length - MAX_NOTE_LINES} older line(s) in ${NOTES_FILE})`);
    out.push(...notes.slice(-MAX_NOTE_LINES).map((l) => `  ${l.replace(/^\s*/, '')}`));
  }
  return out.join('\n');
}

const KEY = /^[A-Z][A-Z0-9]+-\d+$/;

/** Validates and upper-cases issue keys. */
function keysOf(raw: string[]): string[] {
  const keys = [...new Set(raw.map((k) => k.toUpperCase()))];
  const bad = keys.filter((k) => !KEY.test(k));
  if (bad.length) throw new Error(`Not an issue key: ${bad.join(', ')}`);
  return keys;
}

export function runState(rawKeys: string[], opts: StateOptions, git: Git = defaultGit): void {
  const outputDir = path.resolve(opts.outputDir ?? './jira-export');
  const keys = keysOf(rawKeys);
  // --notes only: print only tickets with something local (used by the prompt hook).
  const cards = keys
    .filter((k) => !opts.notes || existsSync(ticketDir(outputDir, k)))
    .map((k) => ticketState(k, outputDir, opts.repo ? path.resolve(opts.repo) : undefined, git));
  if (cards.length) console.log(cards.join('\n\n'));
}

/** The line `note` appends: a dated list item, one line. */
export function noteLine(text: string, now = new Date()): string {
  return `- ${now.toLocaleDateString('sv-SE')}: ${text.replace(/\s*\r?\n\s*/g, ' ').trim()}`;
}

/** Appends a dated line to the ticket's notes.md (local, never sent to Jira). */
export function runNote(rawKey: string, words: string[], opts: NoteOptions): void {
  const [key] = keysOf([rawKey]);
  const text = words.join(' ').trim();
  if (!text) throw new Error('Nothing to note: pass the text after the key.');
  const dir = ticketDir(path.resolve(opts.outputDir ?? './jira-export'), key!);
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, NOTES_FILE);
  const existing = existsSync(file) ? readFileSync(file, 'utf8') : undefined;
  const head = existing === undefined ? `# ${key} notes\n\n` : existing && !existing.endsWith('\n') ? '\n' : '';
  appendFileSync(file, `${head}${noteLine(text)}\n`);
  console.log(`Noted in ${file}`);
}
