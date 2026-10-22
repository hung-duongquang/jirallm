import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { listOrgs, loadProfile, type ResolvedProfile } from '../../lib/config.js';
import { ConfluenceClient, exportConfluencePage } from '../../lib/confluence.js';
import { JiraExporter } from '../../lib/exporter.js';
import { JiraClient, type JqlIssue } from '../../lib/jiraClient.js';

export type WatchOptions = {
  org?: string;
  outputDir?: string;
  jql?: string;
  mine?: boolean;
  pages?: boolean;
  every?: string;
  install?: string | boolean;
  uninstall?: boolean;
  dryRun?: boolean;
};

const MINE_JQL = 'assignee = currentUser() AND statusCategory != Done';
const CHANGES_FILE = 'CHANGES.md';
const TASK_NAME = 'jirallm watch';

type LocalIssue = { key: string; updatedAt?: string };
type LocalPage = { id: string; origin: string; version: number; dir: string };

/** Reads `key: "value"` lines from a markdown file's frontmatter (top-level and one nested level). */
export function frontmatter(md: string): Record<string, string> {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(md);
  const out: Record<string, string> = {};
  for (const line of match?.[1].split(/\r?\n/) ?? []) {
    const m = /^\s{0,2}([A-Za-z][\w-]*):\s*(.+)$/.exec(line);
    if (m) out[m[1]] = m[2].replace(/^"(.*)"$/, '$1');
  }
  return out;
}

/** Jira timestamps end in `+0200`; Date.parse wants `+02:00`. */
const toMillis = (ts: string | undefined) => (ts ? Date.parse(ts.replace(/([+-]\d\d)(\d\d)$/, '$1:$2')) : NaN);

function localIssues(outputDir: string): LocalIssue[] {
  if (!existsSync(outputDir)) return [];
  return readdirSync(outputDir, { withFileTypes: true }).flatMap((d) => {
    const file = path.join(outputDir, d.name, 'task.md');
    if (!d.isDirectory() || !existsSync(file)) return [];
    const fm = frontmatter(readFileSync(file, 'utf-8'));
    return fm.key ? [{ key: fm.key, updatedAt: fm.updatedAt }] : [];
  });
}

function localPages(outputDir: string): LocalPage[] {
  const root = path.join(outputDir, 'confluence');
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true }).flatMap((d) => {
    const file = path.join(root, d.name, 'page.md');
    if (!d.isDirectory() || !existsSync(file)) return [];
    const fm = frontmatter(readFileSync(file, 'utf-8'));
    if (!fm.id || !fm.url) return [];
    return [{ id: fm.id, origin: new URL(fm.url).origin.toLowerCase(), version: Number(fm.version ?? 0), dir: d.name }];
  });
}

/**
 * Runs a JQL search; when it names issue keys that no longer exist (deleted, or no access),
 * Jira rejects the whole query, so those keys are dropped and the query retried.
 */
async function searchKeys(client: JiraClient, keys: string[]): Promise<JqlIssue[]> {
  let remaining = keys;
  for (;;) {
    if (remaining.length === 0) return [];
    try {
      return await client.searchByJql(`key in (${remaining.join(',')})`, ['updated']);
    } catch (err) {
      const bad = [...(err as Error).message.matchAll(/'([A-Z][A-Z0-9_]*-\d+)'/g)].map((m) => m[1].toUpperCase());
      const next = remaining.filter((k) => !bad.includes(k.toUpperCase()));
      if (next.length === remaining.length) throw err;
      remaining = next;
    }
  }
}

/** One line per changed frontmatter field plus the `##` sections whose text changed. */
export function describeChange(previous: string | null, current: string): string {
  if (previous === null) return 'new';
  const before = frontmatter(previous);
  const after = frontmatter(current);
  const fields = [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .filter((k) => k !== 'updatedAt' && before[k] !== after[k])
    .map((k) => `${k}: ${before[k] ?? '∅'} → ${after[k] ?? '∅'}`);
  const sections = (md: string) => {
    const map = new Map<string, string>();
    for (const part of md.split(/^## /m).slice(1)) {
      const nl = part.indexOf('\n');
      map.set(part.slice(0, nl).trim(), part.slice(nl + 1));
    }
    return map;
  };
  const s1 = sections(previous);
  const s2 = sections(current);
  const changed = [...new Set([...s1.keys(), ...s2.keys()])].filter((k) => s1.get(k) !== s2.get(k)).map((k) => `${k} changed`);
  return [...fields, ...changed].join('; ') || 'no visible change';
}

async function runOnce(profile: ResolvedProfile, opts: WatchOptions, outputDir: string): Promise<string[]> {
  const client = new JiraClient(profile.config, profile.apiToken);
  const local = localIssues(outputDir);
  const localByKey = new Map(local.map((i) => [i.key.toUpperCase(), i]));

  const stale = new Set<string>();
  for (let i = 0; i < local.length; i += 100) {
    for (const issue of await searchKeys(client, local.slice(i, i + 100).map((l) => l.key))) {
      const known = localByKey.get(issue.key.toUpperCase());
      if (!known || toMillis(known.updatedAt) !== toMillis(issue.fields.updated as string)) stale.add(issue.key);
    }
  }
  const scopes = [opts.mine !== false ? MINE_JQL : undefined, opts.jql].filter((q): q is string => Boolean(q));
  for (const jql of scopes) {
    for (const issue of await client.searchByJql(jql, ['updated'])) {
      if (!localByKey.has(issue.key.toUpperCase())) stale.add(issue.key);
    }
  }

  const lines: string[] = [];
  if (opts.dryRun) {
    lines.push(...[...stale].map((k) => `${k}: would re-export`));
  } else if (stale.size > 0) {
    const org = profile.org;
    const exporter = new JiraExporter(profile.config, profile.apiToken);
    const result = await exporter.exportIssues([...stale], {
      outputDir,
      includeSubtasks: org.includeSubtasks,
      fieldSelector: org.export?.fieldSelector,
      customFieldDefs: org.export?.customFieldDefs,
      confluenceSites: org.confluenceUrls,
      videoFrames: {
        enabled: org.videoFrames?.enabled !== false,
        fps: org.videoFrames?.fps ?? 5,
        maxFrames: org.videoFrames?.maxFrames ?? 10,
      },
      onIssueWritten: ({ key, previous, current, requested }) => {
        if (requested) lines.push(`${key}: ${describeChange(previous, current)}`);
      },
    });
    for (const f of result.failed) lines.push(`${f.key}: export failed (${f.error.split('\n')[0]})`);
  }

  if (opts.pages !== false) {
    // The API token goes to these hosts, so only the Jira site and configured Confluence sites qualify.
    const allowed = new Set(
      [profile.config.baseUrl, ...(profile.org.confluenceUrls ?? [])].map((u) => new URL(u).origin.toLowerCase())
    );
    const byOrigin = new Map<string, LocalPage[]>();
    for (const p of localPages(outputDir)) {
      if (allowed.has(p.origin)) byOrigin.set(p.origin, [...(byOrigin.get(p.origin) ?? []), p]);
    }
    for (const [origin, pages] of byOrigin) {
      const confluence = new ConfluenceClient(origin, profile.config.userEmail, profile.apiToken);
      const versions = await confluence.pageVersions(pages.map((p) => p.id));
      for (const p of pages) {
        const version = versions.get(p.id);
        if (version === undefined || version === p.version) continue;
        if (opts.dryRun) {
          lines.push(`confluence/${p.dir}: would re-export (v${p.version} → v${version})`);
          continue;
        }
        const page = await exportConfluencePage(confluence, p.id, { outputDir });
        lines.push(`confluence/${p.dir}: "${page.title}" v${p.version} → v${version}`);
      }
    }
  }
  return lines;
}

export type ChangesOptions = { outputDir?: string; unseen?: boolean; max?: string };

/** Splits CHANGES.md into its `## <stamp>` entries, oldest first. */
export function changeEntries(md: string): { stamp: string; lines: string[] }[] {
  return md.split(/^## /m).slice(1).map((part) => {
    const [head, ...rest] = part.split(/\r?\n/);
    return { stamp: head.trim(), lines: rest.filter((l) => l.startsWith('- ')) };
  });
}

/**
 * Prints the logged changes, newest last, capped at `--max` lines. With `--unseen` only entries
 * after the last `--unseen` call are printed (nothing at all when there are none), so a
 * session-start hook adds context only when something moved.
 */
export function runChanges(opts: ChangesOptions): void {
  const outputDir = opts.outputDir ?? './jira-export';
  const file = path.join(outputDir, CHANGES_FILE);
  if (!existsSync(file)) return;
  const max = opts.max === undefined ? 20 : Number(opts.max);
  if (!Number.isInteger(max) || max < 1) throw new Error('--max must be a positive integer.');
  const marker = path.join(outputDir, '.changes.seen');
  const seen = opts.unseen && existsSync(marker) ? readFileSync(marker, 'utf-8').trim() : '';
  const entries = changeEntries(readFileSync(file, 'utf-8')).filter((e) => e.stamp > seen);
  if (entries.length === 0) return;
  if (opts.unseen) writeFileSync(marker, entries[entries.length - 1].stamp);

  // One line per item, latest state wins: a ticket that changed twice is listed once.
  const latest = new Map<string, string>();
  for (const e of entries) {
    for (const l of e.lines) {
      const item = l.slice(2).split(':')[0];
      latest.delete(item);
      latest.set(item, `${l} (${e.stamp})`);
    }
  }
  const lines = [...latest.values()];
  const shown = lines.slice(-max);
  const header = opts.unseen ? `Jira/Confluence changes since ${seen || 'the start of the log'}` : 'Jira/Confluence changes';
  console.log(`${header} (re-exported to ${outputDir}; diff task.md with .task.previous.md for details):`);
  if (shown.length < lines.length) console.log(`- … ${lines.length - shown.length} older line(s) in ${file}`);
  console.log(shown.join('\n'));
}

/** Windows Task Scheduler entry running `jirallm watch` every N minutes from this directory, without a console window. */
function install(opts: WatchOptions, outputDir: string): void {
  const minutes = typeof opts.install === 'string' ? Number(opts.install) : 15;
  if (!Number.isInteger(minutes) || minutes < 1) throw new Error('--install takes a whole number of minutes.');
  const args = ['watch', '--output-dir', path.resolve(outputDir)];
  if (opts.org) args.push('--org', opts.org);
  if (opts.jql) args.push('--jql', opts.jql);
  if (opts.mine === false) args.push('--no-mine');
  if (opts.pages === false) args.push('--no-pages');
  const quote = (s: string) => `"${s.replace(/"/g, '""')}"`;
  const script = path.resolve(outputDir, '.jirallm-watch.cmd');
  const log = path.resolve(outputDir, '.watch.log');
  if (process.platform !== 'win32') {
    console.log(`Add this line with \`crontab -e\`:\n*/${minutes} * * * * cd ${quote(process.cwd())} && ${quote(process.execPath)} ${quote(process.argv[1])} ${args.map(quote).join(' ')} >> ${quote(log)} 2>&1`);
    return;
  }
  mkdirSync(path.dirname(script), { recursive: true });
  writeFileSync(
    script,
    `@echo off\r\ncd /d ${quote(process.cwd())}\r\n${quote(process.execPath)} ${quote(process.argv[1])} ${args.map(quote).join(' ')} >> ${quote(log)} 2>&1\r\n`
  );
  execFileSync('schtasks', ['/Create', '/F', '/SC', 'MINUTE', '/MO', String(minutes), '/TN', TASK_NAME, '/TR', `conhost.exe --headless ${quote(script)}`], { stdio: 'inherit' });
  console.log(`✓ "${TASK_NAME}" runs every ${minutes} min; changes go to ${path.join(outputDir, CHANGES_FILE)}, output to ${log}`);
}

/**
 * Re-exports what changed in Jira or Confluence since the local copy: exported tickets whose
 * `updated` moved, open tickets assigned to me (and `--jql` matches) not yet exported, and exported
 * Confluence pages with a newer version. Each change is printed and appended to CHANGES.md.
 */
export async function runWatch(opts: WatchOptions): Promise<void> {
  if (opts.uninstall) {
    execFileSync('schtasks', ['/Delete', '/F', '/TN', TASK_NAME], { stdio: 'inherit' });
    return;
  }
  const orgs = listOrgs();
  const org = opts.org ?? (orgs.length === 1 ? orgs[0] : undefined);
  if (!org) throw new Error('Several organizations configured; pass --org.');
  const profile = await loadProfile({ org });
  const outputDir = opts.outputDir ?? profile.project.outputDir ?? './jira-export';
  if (opts.install) {
    install(opts, outputDir);
    return;
  }

  const every = opts.every === undefined ? undefined : Number(opts.every);
  if (every !== undefined && !(every > 0)) throw new Error('--every takes a number of minutes.');
  for (;;) {
    const stamp = new Date().toLocaleString('sv-SE').slice(0, 16);
    const lines = await runOnce(profile, opts, outputDir);
    if (lines.length === 0) {
      console.log(`${stamp} no changes`);
    } else {
      console.log(`${stamp} ${lines.length} change(s):\n${lines.map((l) => `  ${l}`).join('\n')}`);
      if (!opts.dryRun) {
        mkdirSync(outputDir, { recursive: true });
        appendFileSync(path.join(outputDir, CHANGES_FILE), `\n## ${stamp}\n\n${lines.map((l) => `- ${l}`).join('\n')}\n`);
      }
    }
    if (every === undefined) return;
    await new Promise((resolve) => setTimeout(resolve, every * 60_000));
  }
}
