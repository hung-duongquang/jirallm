import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { listOrgs, loadProfile, type ResolvedProfile } from '../../lib/config.js';
import { ConfluenceClient, exportConfluencePage } from '../../lib/confluence.js';
import { JiraExporter } from '../../lib/exporter.js';
import { JiraClient, jiraMillis, latestCommentUpdate, type JqlIssue } from '../../lib/jiraClient.js';
import { exportSlackThread, hasSlackToken, lastEditOf, loadSlackAuth, parseSlackUrl, SlackClient, threadFrontmatter, type SlackMessage } from '../../lib/slack.js';
import { isRunning } from './resume.js';
import { runChanges as actionRunChanges } from './runWatch.js';
import { followedRepoPrs, followThreadLinks, REPO_PR_ITEM, repoPrChanges, splitByRepo } from './repoPrWatch.js';
import { belowChanges, followedBelow } from './slackBelow.js';
import { finishedItems, retireFollows } from './follows.js';
import { runningSessionKeys, slackMentionChanges } from './slackMentions.js';
import { checksSignature, defaultGh, describePrChange, fetchPrState, myOpenPrs, notifiedPrs, repoSlug, snapshotOf, toast, type Gh, type PrSnapshot } from './prStatus.js';
import { slackTagChanges, type SlackTag } from './slackTags.js';
import { extensionAvailable, handleUri, installExtension } from '../../lib/vscodeExtension.js';

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
  prs?: string;
  jiraEvery?: string;
  notify?: boolean;
  quiet?: boolean;
  slack?: boolean;
  /** true: also search Slack for new messages that tag the user (--tags; off by default). */
  tags?: boolean;
  /** true: toast closed Claude sessions with news, and let the prompt hook name them after a time away (--closed-sessions). */
  closedSessions?: boolean;
  slackEvery?: string;
};

const MINE_JQL = 'assignee = currentUser() AND statusCategory != Done';
const CHANGES_FILE = 'CHANGES.md';
/** Newest entry stamp any session has seen: the starting point of a session without its own marker. */
const SEEN_MARKER = '.changes.seen';
/** One marker per Claude Code session, so every open session hears about every change. */
const SESSION_SEEN_DIR = '.changes.seen.d';
/** ISO time of the last finished `watch` run, plus an error count (the status line shows whether the watcher is alive). */
export const WATCH_AT_MARKER = '.watch.at';
const SESSION_MARKER_DAYS = 30;
const TASK_NAME = 'jirallm watch';
const PRS_FILE = '.prs.json';
const JIRA_MARKER = '.watch.jira-at';
const SLACK_MARKER = '.watch.slack-at';
/** Slack is checked at most this often by default (one conversations.replies call per thread). */
const SLACK_EVERY_DEFAULT = 5;
/** Threads quiet for longer than this are no longer checked; exporting one again picks it back up. */
export const SLACK_IDLE_DAYS = 14;

type LocalIssue = { key: string; updatedAt?: string; commentsUpdatedAt?: string; commentCount?: number };
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

const toMillis = jiraMillis;

function localIssues(outputDir: string): LocalIssue[] {
  if (!existsSync(outputDir)) return [];
  return readdirSync(outputDir, { withFileTypes: true }).flatMap((d) => {
    const file = path.join(outputDir, d.name, 'task.md');
    if (!d.isDirectory() || !existsSync(file)) return [];
    const fm = frontmatter(readFileSync(file, 'utf-8'));
    if (!fm.key) return [];
    const commentCount = fm.commentCount === undefined ? undefined : Number(fm.commentCount);
    return [{ key: fm.key, updatedAt: fm.updatedAt, commentsUpdatedAt: fm.commentsUpdatedAt, commentCount }];
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
      return await client.searchByJql(`key in (${remaining.join(',')})`, ['updated', 'comment']);
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
    .filter((k) => !['updatedAt', 'commentsUpdatedAt', 'commentCount'].includes(k) && before[k] !== after[k])
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
  const comments = commentChange(before, after, current);
  // Comments live in "Comments", or in "History" next to status changes: when only comments moved,
  // say what happened to them instead of naming the section.
  const statusLines = (text = '') => text.split('\n').filter((l) => l.startsWith('[STATUS CHANGE]') || l.startsWith('[FIELD CHANGE]')).join('\n');
  const changed = [...new Set([...s1.keys(), ...s2.keys()])]
    .filter((k) => s1.get(k) !== s2.get(k))
    .filter((k) => !(comments && (k === 'Comments' || (k === 'History' && statusLines(s1.get(k)) === statusLines(s2.get(k))))))
    .map((k) => `${k} changed`);
  return [...fields, ...(comments ? [comments] : []), ...changed].join('; ') || 'no visible change';
}

/** "1 new comment (Ann)", "1 comment deleted" or "comment edited", from the export frontmatter; '' when comments did not move. */
function commentChange(before: Record<string, string>, after: Record<string, string>, current: string): string {
  const n1 = Number(before.commentCount ?? NaN);
  const n2 = Number(after.commentCount ?? NaN);
  if (Number.isFinite(n1) && Number.isFinite(n2) && n2 !== n1) {
    if (n2 < n1) return `${n1 - n2} comment${n1 - n2 === 1 ? '' : 's'} deleted`;
    const authors = [...current.matchAll(/^\[COMMENT\] (.+?) — /gm)].slice(-(n2 - n1)).map((m) => m[1]!);
    const by = [...new Set(authors)].join(', ');
    return `${n2 - n1} new comment${n2 - n1 === 1 ? '' : 's'}${by ? ` (${by})` : ''}`;
  }
  if (before.commentsUpdatedAt !== undefined && before.commentsUpdatedAt !== after.commentsUpdatedAt) return 'comment edited';
  return '';
}

/**
 * Jira does not move the issue's `updated` when a comment is edited or deleted, so compare the newest
 * comment timestamp (exports without `commentsUpdatedAt` fall back to `updatedAt`) and the comment count
 * (skipped for exports without `commentCount`) with what the export saw.
 */
export function commentsChangedSince(known: LocalIssue, issue: JqlIssue): boolean {
  const field = issue.fields.comment as
    | { total?: number; comments?: Array<{ created: string; updated?: string }> }
    | undefined;
  const comments = field?.comments ?? [];
  if (known.commentCount !== undefined && (field?.total ?? comments.length) !== known.commentCount) return true;
  const seen = Math.max(toMillis(known.commentsUpdatedAt) || 0, toMillis(known.updatedAt) || 0);
  return toMillis(latestCommentUpdate(comments)) > seen;
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
      else if (commentsChangedSince(known, issue)) stale.add(issue.key);
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
      includeSubtasks: org.includeSubtasks ?? true,
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

/** What running Claude Code sessions follow besides my own PRs: their ticket keys and PRs they named (`pr/<n>`). */
export type SessionFollows = { keys: string[]; prs: number[]; /** PR links, `pr/<owner>/<repo>/<n>` */ repoPrs?: string[] };

export function runningSessionFollows(outputDir: string, sessionsDir = path.join(os.tmpdir(), 'jirallm-sessions')): SessionFollows {
  const prs = new Set<number>();
  const repoPrs = new Set<string>();
  if (existsSync(sessionsDir)) {
    for (const f of readdirSync(sessionsDir)) {
      if (!f.endsWith('.follow') || !isRunning(f.slice(0, -'.follow'.length), sessionsDir)) continue;
      for (const l of readFileSync(path.join(sessionsDir, f), 'utf8').split(/\r?\n/)) {
        const n = /^pr\/(\d+)$/.exec(l.trim())?.[1];
        if (n) prs.add(Number(n));
        if (REPO_PR_ITEM.test(l.trim())) repoPrs.add(l.trim());
      }
    }
  }
  return { keys: [...runningSessionKeys(outputDir, sessionsDir).keys()], prs: [...prs], repoPrs: [...repoPrs] };
}

/** Export folders (`<channel>-<ts>`) of the Slack threads running sessions follow (`slack/<dir>` in .follow). */
export function followedSlackThreads(sessionsDir = path.join(os.tmpdir(), 'jirallm-sessions')): Set<string> {
  const dirs = new Set<string>();
  if (!existsSync(sessionsDir)) return dirs;
  for (const f of readdirSync(sessionsDir)) {
    if (!f.endsWith('.follow') || !isRunning(f.slice(0, -'.follow'.length), sessionsDir)) continue;
    for (const l of readFileSync(path.join(sessionsDir, f), 'utf8').split(/\r?\n/)) {
      const dir = /^slack\/([\w-]+)$/i.exec(l.trim())?.[1];
      if (dir) dirs.add(dir.toLowerCase());
    }
  }
  return dirs;
}

/**
 * Open PRs of others that a running session works on: a PR it named, or one whose title or branch holds
 * one of its ticket keys (reviewing Trung's PR for ZOD-1 follows its CI and reviews like my own PRs).
 * One `gh pr list` call, made only while sessions follow something.
 */
export function followedPrs(gh: Gh, cwd: string, follow: SessionFollows, mine: Set<number>): Array<{ number: number; sig: string }> {
  if (!follow.keys.length && !follow.prs.length) return [];
  const open = JSON.parse(
    gh(cwd, ['pr', 'list', '--state', 'open', '--json', 'number,title,headRefName,headRefOid,statusCheckRollup', '--limit', '100'])
  ) as Array<{ number: number; title: string; headRefName: string; headRefOid: string; statusCheckRollup: Parameters<typeof checksSignature>[1] | null }>;
  return open
    .filter((p) => !mine.has(p.number))
    .filter((p) => follow.prs.includes(p.number) || follow.keys.some((k) => concerns(`${p.title} ${p.headRefName}`, [k])))
    .map((p) => ({ number: p.number, sig: checksSignature(p.headRefOid, p.statusCheckRollup ?? []) }));
}

/** A change line for CHANGES.md, with the page a notification should open; `error` lines are only printed. */
export type PrChange = { line: string; url?: string; error?: boolean };
type PrsState = {
  meta?: { lastModified?: string; checkedAt?: string; repo?: string; repoPath?: string };
  prs: Record<string, PrSnapshot>;
  /** PRs that merged or closed (number → state), for dropping them from the sessions' follows. */
  finished?: Record<string, string>;
};

/** Ticket statuses past "a PR merged": no reminder to move the ticket on. */
const DONE_STATUS = /resolved|done|closed|released|gesloten|afgerond|opgeleverd/i;

/**
 * "; ZOD-1 is still In Review (last export): if this PR finishes it, offer to move it on" when a
 * merged PR's ticket has not moved past it yet, per its local export.
 */
export function mergedTicketHint(outputDir: string, key: string | undefined): string {
  if (!key) return '';
  const file = path.join(outputDir, key.toLowerCase(), 'task.md');
  if (!existsSync(file)) return '';
  const status = frontmatter(readFileSync(file, 'utf-8')).status;
  if (!status || DONE_STATUS.test(status)) return '';
  return `; ${key} is still ${status} (last export): if this PR finishes it, offer to move the ticket on (the team's status after a merge, e.g. Resolved)`;
}

/** `owner/name` of the repo `watch --prs` checks, as its last run stored it. */
function prsRepo(outputDir: string): string | undefined {
  try {
    return (JSON.parse(readFileSync(path.join(outputDir, PRS_FILE), 'utf8')) as PrsState).meta?.repo;
  } catch {
    return undefined;
  }
}

/**
 * CI and review changes on my open PRs in the repo at `repo` since the last run (state in .prs.json):
 * new check failures, CI back to green, new reviews, review threads awaiting me, comments, merged/closed.
 * Cheap enough to run every minute: one `gh pr list` (checks of all my PRs) plus a notifications poll
 * that is a free 304 when nothing happened; a PR is only read in full when its checks changed or it
 * got a notification.
 */
export function prChanges(
  repo: string,
  outputDir: string,
  dryRun: boolean | undefined,
  gh: Gh = defaultGh,
  follow: SessionFollows = runningSessionFollows(outputDir)
): PrChange[] {
  const file = path.join(outputDir, PRS_FILE);
  const stored = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) as PrsState | Record<string, PrSnapshot> : undefined;
  const state: PrsState = stored && 'prs' in stored ? stored as PrsState : { prs: (stored ?? {}) as Record<string, PrSnapshot> };
  const prev = state.prs;
  const cwd = path.resolve(repo);
  const firstLine = (err: unknown) => String(err instanceof Error ? err.message : err).split('\n')[0];
  const changes: PrChange[] = [];
  const next: Record<string, PrSnapshot> = {};
  // The last 100 finished PRs: enough for the follows of the sessions that named them to be dropped.
  const finished: Record<string, string> = Object.fromEntries(Object.entries(state.finished ?? {}).slice(-100));
  const startedAt = new Date().toISOString();
  let meta = state.meta ?? {};
  try {
    const slug = meta.repo ?? repoSlug(gh, cwd);
    const since = meta.checkedAt ? new Date(Date.parse(meta.checkedAt) - 120_000).toISOString() : undefined;
    const notified = notifiedPrs(gh, cwd, slug, meta.lastModified, since);
    const mine = myOpenPrs(gh, cwd);
    // A PR link into this repo (`pr/<owner>/<repo>/<n>`) is followed here; links to other repos in repoPrWatch.ts.
    const linked = splitByRepo(follow.repoPrs ?? [], slug).local;
    const all = { ...follow, prs: [...new Set([...follow.prs, ...linked])] };
    for (const { number: n, sig } of [...mine, ...followedPrs(gh, cwd, all, new Set(mine.map((p) => p.number)))]) {
      const old = prev[n];
      if (old && old.sig === sig && notified.prs && !notified.prs.includes(n)) {
        next[n] = old;
        continue;
      }
      try {
        const snap = { ...snapshotOf(fetchPrState(gh, cwd, String(n))), sig };
        next[n] = snap;
        const line = describePrChange(old, snap);
        if (line) changes.push({ line, url: snap.url });
      } catch (err) {
        if (old) next[n] = old;
        changes.push({ line: `PR #${n}: status check failed (${firstLine(err)})`, error: true });
      }
    }
    for (const [n, old] of Object.entries(prev)) {
      if (next[n]) continue;
      let pr = 'closed';
      try { pr = (JSON.parse(gh(cwd, ['pr', 'view', n, '--json', 'state'])) as { state: string }).state.toLowerCase(); } catch { /* keep "closed" */ }
      // Someone else's PR that no running session follows any more: still open, nothing to report.
      if (pr === 'open') continue;
      finished[n] = pr;
      changes.push({ line: `PR #${n}${old.key ? ` (${old.key})` : ''}: ${pr}${pr === 'merged' ? mergedTicketHint(outputDir, old.key) : ''}`, url: old.url });
    }
    meta = { repo: slug, repoPath: cwd, lastModified: notified.lastModified, checkedAt: startedAt };
  } catch (err) {
    return [{ line: `PRs: gh failed (${firstLine(err)})`, error: true }];
  }
  if (!dryRun) {
    mkdirSync(outputDir, { recursive: true });
    writeFileSync(file, JSON.stringify({ meta, prs: next, finished } satisfies PrsState, null, 1));
  }
  return changes;
}

/**
 * A toast per new tag (at most 3 a round): "Handle in Claude" starts a session on it in VS Code
 * through the jirallm extension (when VS Code is there), "Open in Slack" opens the message.
 */
function toastTags(outputDir: string, tags: SlackTag[]): void {
  if (!tags.length || process.platform !== 'win32') return;
  const workspace = path.dirname(path.resolve(outputDir));
  const vscode = extensionAvailable() && !installExtension();
  for (const t of tags.slice(-3)) {
    toast(`${t.from} tagged you in ${t.where}`, [t.text], t.url, [
      ...(vscode ? [{ label: 'Handle in Claude', url: handleUri(t.dir, workspace) }] : []),
      { label: 'Open in Slack', url: t.url },
    ]);
  }
}

/** Threads with fewer messages than this are read whole by the watcher (one page of 200), so edits show. */
export const SLACK_WHOLE_THREAD_MAX = 190;

/** Sets one field under `slack:` in a thread.md's frontmatter (added after lastTs when missing). */
function setThreadField(file: string, key: string, value: string): void {
  const text = readFileSync(file, 'utf8');
  const line = `  ${key}: ${JSON.stringify(value)}`;
  const re = new RegExp(`^ {2}${key}: .*$`, 'm');
  const next = re.test(text) ? text.replace(re, line) : text.replace(/^( {2}lastTs: .*)$/m, `$1\n${line}`);
  if (next !== text) writeFileSync(file, next);
}

/**
 * New replies, edits and deletions in exported Slack threads (slack/<channel>-<ts>/thread.md) since
 * their export: one conversations.replies call per thread. Short threads come back whole and are
 * compared with the export (lastTs, lastEditTs, messages); long ones only for messages after lastTs.
 * A thread with new replies is exported again (which marks them as new). Threads without a reply for
 * SLACK_IDLE_DAYS are skipped; Slack rate limiting stops the round and the rest waits for the next.
 */
export async function slackChanges(
  outputDir: string,
  dryRun: boolean | undefined,
  client?: SlackClient,
  now = Date.now(),
  only?: Set<string>
): Promise<PrChange[]> {
  const root = path.join(outputDir, 'slack');
  if (!existsSync(root)) return [];
  const threads = readdirSync(root, { withFileTypes: true }).flatMap((d) => {
    if (only && !only.has(d.name.toLowerCase())) return [];
    const file = path.join(root, d.name, 'thread.md');
    const ts = /-(\d{10})(\d{6})$/.exec(d.name);
    if (!d.isDirectory() || !ts || !existsSync(file)) return [];
    const fm = threadFrontmatter(readFileSync(file, 'utf8'));
    if (!fm.url || !fm.lastTs) return [];
    if (now - Date.parse(fm.lastReplyAt ?? '') > SLACK_IDLE_DAYS * 86_400_000) return [];
    const count = Number(fm.messages);
    return [{ dir: d.name, file, threadTs: `${ts[1]}.${ts[2]}`, url: fm.url, lastTs: fm.lastTs, lastEditTs: fm.lastEditTs, count: count > 0 ? count : undefined }];
  });
  if (threads.length === 0) return [];
  const slack = client ?? new SlackClient(await loadSlackAuth());
  const changes: PrChange[] = [];
  for (const t of threads) {
    try {
      const { channel } = parseSlackUrl(t.url);
      // A thread that fits one page is read whole: Slack counts calls, not messages, so seeing edits and
      // deletions costs no extra call. A longer one only asks for what came after the export.
      const whole = t.count !== undefined && t.count < SLACK_WHOLE_THREAD_MAX;
      const page = await slack.call<{ messages?: SlackMessage[] }>('conversations.replies', whole
        ? { channel, ts: t.threadTs, limit: '200' }
        : { channel, ts: t.threadTs, oldest: t.lastTs, inclusive: 'false', limit: '50' });
      const messages = page.messages ?? [];
      const fresh = messages.filter((m) => Number(m.ts) > Number(t.lastTs)).length;
      let edited = 0;
      let deleted = 0;
      if (whole && !page.has_more) {
        const known = messages.filter((m) => Number(m.ts) <= Number(t.lastTs));
        if (t.lastEditTs === undefined) {
          // Exported before edits were tracked: what is there now is where it starts.
          if (!dryRun) setThreadField(t.file, 'lastEditTs', lastEditOf(known));
        } else {
          edited = known.filter((m) => m.edited && !m.bot_id && Number(m.edited.ts) > Number(t.lastEditTs)).length;
        }
        deleted = Math.max(0, t.count! - known.length);
      }
      if (fresh === 0 && edited === 0 && deleted === 0) continue;
      if (dryRun) {
        changes.push({ line: `slack/${t.dir}: would re-export (${fresh ? 'new replies' : 'edited or deleted messages'})`, url: t.url });
        continue;
      }
      const exported = await exportSlackThread(t.url, { outputDir, client: slack });
      const n = fresh ? exported.newReplies || fresh : 0;
      const what = [
        n ? `${n} new repl${n === 1 ? 'y' : 'ies'}` : '',
        edited ? `${edited} message${edited === 1 ? '' : 's'} edited` : '',
        deleted ? `${deleted} message${deleted === 1 ? '' : 's'} deleted` : '',
      ].filter(Boolean).join(', ');
      changes.push({ line: `slack/${t.dir}: ${what} in "${exported.title}"`, url: t.url });
    } catch (err) {
      const msg = String(err instanceof Error ? err.message : err).split('\n')[0];
      changes.push({ line: `slack/${t.dir}: check failed (${msg})`, error: true });
      if (/ratelimited|HTTP 429|invalid_auth|not_authed|token_revoked/.test(msg)) break;
    }
  }
  return changes;
}

export type ChangesOptions = {
  outputDir?: string;
  unseen?: boolean;
  max?: string;
  follow?: string | boolean;
  session?: string;
  keys?: string;
  pushOnly?: boolean;
  via?: string;
  log?: boolean;
};

/** Path of the seen marker for a session (validated id), or of the shared one without a session. */
export function seenMarkerPath(outputDir: string, session?: string): string {
  if (!session) return path.join(outputDir, SEEN_MARKER);
  if (!/^[\w-]{1,100}$/.test(session)) throw new Error('--session takes a Claude Code session id (letters, digits, - and _).');
  return path.join(outputDir, SESSION_SEEN_DIR, session);
}

/** The stamp a session has seen up to: its own marker, else the shared one (what earlier sessions saw). */
export function seenStamp(outputDir: string, session?: string): string {
  const files = session ? [seenMarkerPath(outputDir, session), seenMarkerPath(outputDir)] : [seenMarkerPath(outputDir)];
  for (const file of files) {
    if (existsSync(file)) return readFileSync(file, 'utf-8').trim();
  }
  return '';
}

/** Marks `stamp` seen for the session, moves the shared marker forward, and clears session markers idle for 30 days. */
function markSeen(outputDir: string, stamp: string, session?: string): void {
  const shared = seenMarkerPath(outputDir);
  if (!existsSync(shared) || readFileSync(shared, 'utf-8').trim() < stamp) writeFileSync(shared, stamp);
  if (!session) return;
  const dir = path.join(outputDir, SESSION_SEEN_DIR);
  mkdirSync(dir, { recursive: true });
  writeFileSync(seenMarkerPath(outputDir, session), stamp);
  const cutoff = Date.now() - SESSION_MARKER_DAYS * 24 * 3600 * 1000;
  for (const f of readdirSync(dir)) {
    try {
      if (statSync(path.join(dir, f)).mtimeMs < cutoff) unlinkSync(path.join(dir, f));
    } catch {
      // Another session may be clearing too.
    }
  }
}

/** Number of change lines (latest state per item) the session has not seen yet; nothing is marked. */
export function unseenCount(outputDir: string, session?: string): number {
  const file = path.join(outputDir, CHANGES_FILE);
  if (!existsSync(file)) return 0;
  const seen = seenStamp(outputDir, session);
  const items = new Set<string>();
  for (const e of changeEntries(readFileSync(file, 'utf-8'))) {
    if (e.stamp > seen) for (const l of e.lines) items.add(l.slice(2).split(':')[0]);
  }
  return items.size;
}

/** Splits CHANGES.md into its `## <stamp>` entries, oldest first. */
export function changeEntries(md: string): { stamp: string; lines: string[] }[] {
  return md.split(/^## /m).slice(1).map((part) => {
    const [head, ...rest] = part.split(/\r?\n/);
    return { stamp: head.trim(), lines: rest.filter((l) => l.startsWith('- ')) };
  });
}

/** Lines a session already read itself (`<session>.read`: "<stamp>\t<line>"), so they are not handed to it again. */
const readByPath = (outputDir: string, session: string) => `${seenMarkerPath(outputDir, session)}.read`;

function readBySession(outputDir: string, session: string | undefined): Set<string> {
  if (!session) return new Set();
  try {
    return new Set(readFileSync(readByPath(outputDir, session), 'utf-8').split(/\r?\n/).filter(Boolean));
  } catch {
    return new Set();
  }
}

/**
 * Appends one CHANGES.md entry as `watch` does, for a change found outside it (`jirallm slack <url>`
 * refreshing an export), so every other session following the item still hears about it. With
 * `readBy`, that session read the change itself: it is not handed to it again.
 */
export function logChanges(outputDir: string, lines: string[], readBy?: string, now = new Date()): string {
  const stamp = now.toLocaleString('sv-SE').slice(0, 19);
  mkdirSync(outputDir, { recursive: true });
  appendFileSync(path.join(outputDir, CHANGES_FILE), `\n## ${stamp}\n\n${lines.map((l) => `- ${l}`).join('\n')}\n`);
  if (readBy) {
    const file = readByPath(outputDir, readBy);
    mkdirSync(path.dirname(file), { recursive: true });
    appendFileSync(file, lines.map((l) => `${stamp}\t- ${l}\n`).join(''));
  }
  return stamp;
}

/**
 * Prints the logged changes, newest last, capped at `--max` lines. With `--unseen` only entries
 * after the last `--unseen` call are printed (nothing at all when there are none), so a
 * session-start hook adds context only when something moved. `--follow [seconds]` keeps going:
 * every N seconds (default 30) it prints what `watch` appended since, as `--unseen` does, so an
 * agent's background monitor (each stdout line is an event) hears about it mid-session.
 */
export async function runChanges(opts: ChangesOptions): Promise<void> {
  const outputDir = opts.outputDir ?? './jira-export';
  const max = opts.max === undefined ? 20 : Number(opts.max);
  if (!Number.isInteger(max) || max < 1) throw new Error('--max must be a positive integer.');
  const keys = opts.keys === undefined ? undefined : opts.keys.split(',').map((k) => k.trim().toUpperCase()).filter(Boolean);
  if ((keys || opts.pushOnly) && !opts.session) throw new Error('--keys and --push-only need --session.');
  const focus: ChangeFocus | undefined = keys || opts.pushOnly ? { keys: keys ?? [], pushOnly: opts.pushOnly } : undefined;
  if (opts.log) {
    console.log(deliveryLogReport(outputDir, opts.session, max));
    return;
  }
  const following = opts.follow !== undefined && opts.follow !== false;
  const via = opts.via ?? (following ? 'follow' : opts.pushOnly ? 'monitor' : 'cli');
  if (!following) {
    const unseen = !!opts.unseen || !!focus;
    const report = changesReport(outputDir, unseen, max, opts.session, focus);
    // Only reports that move a marker are deliveries; a plain `changes` listing is not.
    const out = unseen ? tagDelivery(outputDir, opts.session, via, report) : report;
    if (out) console.log(out);
    return;
  }
  const seconds = opts.follow === true ? 30 : Number(opts.follow);
  if (!(seconds >= 1)) throw new Error('--follow takes a number of seconds.');
  for (;;) {
    const report = tagDelivery(outputDir, opts.session, via, changesReport(outputDir, true, max, opts.session, focus));
    if (report) console.log(report);
    await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
  }
}

/** One report handed to a Claude Code session, as logged in `.changes.seen.d/<id>.log` (JSON lines). */
export type Delivery = { n: number; at: string; via: string; items: string[]; text?: string };
/** Written by the plugin's Stop hook: the highest delivery number a finished Claude turn had in context. */
export type DeliveryAck = { n: number; at: string; reply?: string };

export const deliveryLogPath = (outputDir: string, session: string) => `${seenMarkerPath(outputDir, session)}.log`;
export const deliveryAckPath = (outputDir: string, session: string) => `${seenMarkerPath(outputDir, session)}.acked`;
const MAX_LOG_LINES = 200;
export const OTHER_ITEM = 'other tickets (names only)';
const MAX_TEXT = 4000;
const hhmm = (iso: string) => new Date(iso).toLocaleTimeString('sv-SE').slice(0, 5);

export function readDeliveries(outputDir: string, session: string): Delivery[] {
  const file = deliveryLogPath(outputDir, session);
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf-8')
    .split('\n')
    .flatMap((l) => {
      try {
        return l.trim() ? [JSON.parse(l) as Delivery] : [];
      } catch {
        return [];
      }
    });
}

/**
 * The session's read receipt (written by the plugin's PostToolUse/Stop hooks when Claude acted after a
 * delivery), with the first line of Claude's latest reply from `<id>.reply` (Stop hook) when there is one.
 */
export function readAck(outputDir: string, session: string): DeliveryAck | undefined {
  let ack: DeliveryAck;
  try {
    ack = JSON.parse(readFileSync(deliveryAckPath(outputDir, session), 'utf-8')) as DeliveryAck;
  } catch {
    return undefined;
  }
  try {
    const reply = JSON.parse(readFileSync(`${seenMarkerPath(outputDir, session)}.reply`, 'utf-8')) as { text?: string };
    if (reply.text) ack.reply = reply.text;
  } catch {
    // No reply recorded yet (or a receipt from 0.30–0.32, which kept it inline).
  }
  return ack;
}

/** Names of the items a report lists ("ZOD-1", "PR #12 (ZOD-1)", "slack/…"); the "other changes" line counts as one. */
function reportItems(report: string): string[] {
  const items: string[] = [];
  for (const line of report.split('\n')) {
    if (line.startsWith('- ') && !line.startsWith('- …')) items.push(line.slice(2).split(':')[0]!.trim());
    else if (line.startsWith('Other changes,')) items.push(OTHER_ITEM);
  }
  return [...new Set(items)];
}

/**
 * Logs a report handed to a session and prefixes it with "[jirallm delivery #N · via HH:MM]", so the
 * plugin's Stop hook can tell from the transcript which deliveries a finished Claude turn had in
 * context, and the status line can show "delivered → read". Without a session: the report as is.
 */
export function tagDelivery(outputDir: string, session: string | undefined, via: string, report: string | null, now = new Date()): string | null {
  if (!report || !session) return report;
  const items = reportItems(report);
  // Only other tickets' names: nothing for this session to act on, so not worth tracking.
  if (items.every((i) => i === OTHER_ITEM)) return report;
  const log = readDeliveries(outputDir, session);
  const n = (log[log.length - 1]?.n ?? 0) + 1;
  const entry: Delivery = { n, at: now.toISOString(), via, items, text: report.slice(0, MAX_TEXT) };
  const file = deliveryLogPath(outputDir, session);
  mkdirSync(path.dirname(file), { recursive: true });
  if (log.length >= MAX_LOG_LINES) writeFileSync(file, [...log.slice(-MAX_LOG_LINES / 2), entry].map((d) => JSON.stringify(d)).join('\n') + '\n');
  else appendFileSync(file, JSON.stringify(entry) + '\n');
  return `[jirallm delivery #${n} · ${via} ${hhmm(entry.at)}]\n${report}`;
}

/** The most recently written session delivery log, for `changes --log` without `--session`. */
function newestLogSession(outputDir: string): string | undefined {
  const dir = path.join(outputDir, SESSION_SEEN_DIR);
  if (!existsSync(dir)) return undefined;
  return readdirSync(dir)
    .filter((f) => f.endsWith('.log'))
    .map((f) => ({ id: f.slice(0, -'.log'.length), at: statSync(path.join(dir, f)).mtimeMs }))
    .sort((a, b) => b.at - a.at)[0]?.id;
}

/** `changes --log`: what was handed to a session, when and how, and whether a Claude turn has read it. */
export function deliveryLogReport(outputDir: string, session: string | undefined, max: number): string {
  const id = session ?? newestLogSession(outputDir);
  if (!id) return 'No deliveries logged yet (each session logs to jira-export/.changes.seen.d/<id>.log).';
  const log = readDeliveries(outputDir, id).slice(-max);
  if (!log.length) return `Session ${id}: nothing delivered yet.`;
  const ack = readAck(outputDir, id);
  const out = [`Deliveries to session ${id}${session ? '' : ' (most recent session)'}:`];
  for (const d of log) {
    const read = ack && ack.n >= d.n ? '✓ read' : '⏳ not read yet';
    out.push(`#${d.n} ${d.at.slice(0, 10)} ${hhmm(d.at)} via ${d.via}: ${d.items.join(', ') || '(empty)'} — ${read}`);
  }
  if (ack) out.push(`Read up to #${ack.n} at ${hhmm(ack.at)} (Claude acted after it reached its context)${ack.reply ? `; latest reply: "${ack.reply}"` : ''}`);
  return out.join('\n');
}

/**
 * For the status line: unseen changes to the session's tickets not handed to it yet (`waiting`),
 * and unseen changes to other tickets (`others`, which only arrive as one line of names).
 */
export function pendingCounts(outputDir: string, session: string | undefined, keys: string[]): { waiting: number; others: number } {
  const file = path.join(outputDir, CHANGES_FILE);
  if (!existsSync(file)) return { waiting: 0, others: 0 };
  const seen = seenStamp(outputDir, session);
  const pushed = session ? readStamp(pushedMarkerPath(outputDir, session)) : '';
  const read = readBySession(outputDir, session);
  const waiting = new Set<string>();
  const others = new Set<string>();
  for (const e of changeEntries(readFileSync(file, 'utf-8'))) {
    if (e.stamp <= seen) continue;
    for (const l of e.lines) {
      if (read.has(`${e.stamp}\t${l}`)) continue;
      const item = l.slice(2).split(':')[0]!;
      if (keys.length && concerns(l, keys)) {
        if (e.stamp > pushed) waiting.add(item);
      } else others.add(item);
    }
  }
  return { waiting: waiting.size, others: others.size };
}

/** The change lines (without their "- " prefix) waiting for a session: about its items, not yet handed to it or read. */
export function waitingLines(outputDir: string, session: string, keys: string[], since = ''): string[] {
  const file = path.join(outputDir, CHANGES_FILE);
  if (!keys.length || !existsSync(file)) return [];
  const seen = seenStamp(outputDir, session);
  const pushed = readStamp(pushedMarkerPath(outputDir, session));
  const read = readBySession(outputDir, session);
  const out: string[] = [];
  for (const e of changeEntries(readFileSync(file, 'utf-8'))) {
    if (e.stamp <= seen || e.stamp <= pushed || e.stamp < since) continue;
    for (const l of e.lines) if (!read.has(`${e.stamp}\t${l}`) && concerns(l, keys)) out.push(l.slice(2));
  }
  return out;
}

/**
 * The compact change report (header, then one line per item with the latest state), or null when
 * there is nothing to show. With `unseen` only entries after the seen marker count, and the marker
 * moves past them: the session's own marker when `session` is given (so each Claude Code session
 * hears about every change, not only the first one to look), else the shared `.changes.seen`.
 */
export function changesReport(outputDir: string, unseen: boolean, max: number, session?: string, focus?: ChangeFocus): string | null {
  if (focus && session) return focusedReport(outputDir, session, focus);
  const file = path.join(outputDir, CHANGES_FILE);
  if (!existsSync(file)) return null;
  const seen = unseen ? seenStamp(outputDir, session) : '';
  if (unseen && session && !existsSync(seenMarkerPath(outputDir, session))) {
    // Pin the session's starting point now, or other sessions moving the shared marker would hide changes from it.
    mkdirSync(path.join(outputDir, SESSION_SEEN_DIR), { recursive: true });
    writeFileSync(seenMarkerPath(outputDir, session), seen);
  }
  const entries = changeEntries(readFileSync(file, 'utf-8')).filter((e) => e.stamp > seen);
  if (entries.length === 0) return null;
  if (unseen) markSeen(outputDir, entries[entries.length - 1].stamp, session);

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
  const header = unseen ? `Jira/Confluence/Slack/PR changes since ${seen || 'the start of the log'}` : 'Jira/Confluence/Slack/PR changes';
  const out = [`${header} (re-exported to ${outputDir}; diff task.md with .task.previous.md for details):`];
  if (shown.length < lines.length) out.push(`- … ${lines.length - shown.length} older line(s) in ${file}`);
  out.push(...shown);
  return out.join('\n');
}

/**
 * Which changes concern a session: the tickets it works on (`keys`). With `pushOnly` (the background
 * monitor) only those are printed and the session's seen marker is left alone; a separate
 * "pushed" marker remembers how far the monitor got, so the next prompt does not repeat them.
 */
export type ChangeFocus = { keys: string[]; pushOnly?: boolean };

const pushedMarkerPath = (outputDir: string, session: string) => `${seenMarkerPath(outputDir, session)}.pushed`;
const readStamp = (file: string) => (existsSync(file) ? readFileSync(file, 'utf-8').trim() : '');

/**
 * "ZOD-1, 2 Slack threads, its Confluence page": the session's tickets, and its followed Slack threads
 * ("slack/<channel>-<ts>") and Confluence pages ("confluence/<id>") counted.
 */
function followedNames(keys: string[]): string {
  const isThread = (k: string) => k.toLowerCase().startsWith('slack/');
  const isPage = (k: string) => k.toLowerCase().startsWith('confluence/');
  const threads = keys.filter(isThread).length;
  const pages = keys.filter(isPage).length;
  const names = keys
    // "below/<dir>" goes with its "slack/<dir>" thread, counted there.
    .filter((k) => !isThread(k) && !isPage(k) && !/^below\//i.test(k))
    .map((k) => k.replace(/^pr\/(\d+)$/i, 'PR #$1').replace(/^pr\/[\w.-]+\/([\w.-]+)\/(\d+)$/i, '$1#$2').replace(/^run\/[\w.-]+\/[\w.-]+\/(\d+)$/i, 'run $1'));
  if (threads) names.push(threads === 1 ? 'its Slack thread' : `${threads} Slack threads`);
  if (pages) names.push(pages === 1 ? 'its Confluence page' : `${pages} Confluence pages`);
  return names.join(', ');
}

/** True when a change line names one of the keys (a ticket, its PR "(KEY)", a Slack thread title). */
export function concerns(line: string, keys: string[]): boolean {
  return keys.some((k) => {
    // A PR the session named ("pr/12") matches its change lines ("PR #12 (ZOD-1): …").
    const pr = /^pr\/(\d+)$/i.exec(k)?.[1];
    if (pr) return new RegExp(`PR #${pr}(?![0-9])`).test(line);
    // A PR link ("pr/o/r/12") matches "PR #12 (o/r, …): …", and "PR #12 (ZOD-1): …" of the watched repo.
    const linked = /^pr\/([\w.-]+\/[\w.-]+)\/(\d+)$/i.exec(k);
    if (linked) {
      const m = new RegExp(`PR #${linked[2]}(?![0-9])(?: \\(([\\w.-]+/[\\w.-]+)[,)])?`).exec(line);
      return !!m && (!m[1] || m[1].toLowerCase() === linked[1]!.toLowerCase());
    }
    // A followed Actions run ("run/o/r/12") matches "Run 12 (o/r …): …".
    const run = /^run\/[\w.-]+\/[\w.-]+\/(\d+)$/i.exec(k)?.[1];
    return run ? new RegExp(`Run ${run}(?![0-9])`).test(line) :new RegExp(`(^|[^A-Z0-9-])${k}(?![0-9])`, 'i').test(line);
  });
}

/**
 * The change report for one Claude Code session, focused on its tickets. Changes to other tickets
 * do not interrupt it: the monitor (pushOnly) skips them, and a prompt or session start lists them
 * as one short line of names. Changes to its own tickets come in full, once.
 */
function focusedReport(outputDir: string, session: string, focus: ChangeFocus): string | null {
  const file = path.join(outputDir, CHANGES_FILE);
  if (!existsSync(file)) return null;
  const seen = seenStamp(outputDir, session);
  if (!existsSync(seenMarkerPath(outputDir, session))) {
    mkdirSync(path.join(outputDir, SESSION_SEEN_DIR), { recursive: true });
    writeFileSync(seenMarkerPath(outputDir, session), seen);
  }
  const pushedFile = pushedMarkerPath(outputDir, session);
  const pushed = readStamp(pushedFile);
  const from = focus.pushOnly && pushed > seen ? pushed : seen;
  const entries = changeEntries(readFileSync(file, 'utf-8')).filter((e) => e.stamp > from);
  if (entries.length === 0) return null;
  const last = entries[entries.length - 1]!.stamp;

  const read = readBySession(outputDir, session);
  const mine = new Map<string, string>();
  const others = new Map<string, true>();
  for (const e of entries) {
    for (const l of e.lines) {
      // The session read this change itself (`jirallm slack <url>` in it): not handed to it again.
      if (read.has(`${e.stamp}\t${l}`)) continue;
      const item = l.slice(2).split(':')[0]!;
      if (concerns(l, focus.keys)) {
        // Already pushed by the monitor: the prompt does not repeat it.
        if (!focus.pushOnly && e.stamp <= pushed) continue;
        mine.delete(item);
        mine.set(item, `${l} (${e.stamp})`);
      } else if (!focus.pushOnly) {
        others.delete(item);
        others.set(item, true);
      }
    }
  }
  if (focus.pushOnly) {
    mkdirSync(path.dirname(pushedFile), { recursive: true });
    writeFileSync(pushedFile, last);
  } else {
    markSeen(outputDir, last, session);
  }
  const out: string[] = [];
  if (mine.size) out.push(`Changes to this session's tickets (${followedNames(focus.keys)}; re-exported to ${outputDir}):`, ...mine.values());
  if (others.size) {
    const names = [...others.keys()].map((n) =>
      n.startsWith('slack/') ? 'a Slack thread' : n.startsWith('confluence/') ? 'a Confluence page' : n.replace(/ \([^)]*\)$/, '')
    );
    const unique = [...new Set(names)];
    const shown = unique.slice(-8).join(', ') + (unique.length > 8 ? `, +${unique.length - 8} more` : '');
    out.push(`Other changes, not this session's tickets (only on request: \`jirallm changes\`): ${shown}`);
  }
  return out.length ? out.join('\n') : null;
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
  if (opts.prs) args.push('--prs', path.resolve(opts.prs));
  if (opts.jiraEvery) args.push('--jira-every', opts.jiraEvery);
  if (opts.slack === false) args.push('--no-slack');
  if (opts.slackEvery) args.push('--slack-every', opts.slackEvery);
  if (opts.notify) args.push('--notify');
  if (opts.tags) args.push('--tags');
  if (opts.closedSessions) args.push('--closed-sessions');
  args.push('--quiet');
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
  const jiraEvery = opts.jiraEvery === undefined ? undefined : Number(opts.jiraEvery);
  if (jiraEvery !== undefined && !(jiraEvery > 0)) throw new Error('--jira-every takes a number of minutes.');
  const slackEvery = opts.slackEvery === undefined ? SLACK_EVERY_DEFAULT : Number(opts.slackEvery);
  if (!(slackEvery > 0)) throw new Error('--slack-every takes a number of minutes.');
  const watchSlack = opts.slack !== false && (await hasSlackToken());
  const jiraMarker = path.join(outputDir, JIRA_MARKER);
  const slackMarker = path.join(outputDir, SLACK_MARKER);
  for (;;) {
    const stamp = new Date().toLocaleString('sv-SE').slice(0, 19);
    const lastJira = existsSync(jiraMarker) ? Date.parse(readFileSync(jiraMarker, 'utf8').trim()) : NaN;
    const jiraDue = jiraEvery === undefined || !(Date.now() - lastJira < jiraEvery * 60_000 - 30_000);
    const changes: PrChange[] = [];
    if (jiraDue) {
      const base = profile.config.baseUrl.replace(/\/$/, '');
      changes.push(...(await runOnce(profile, opts, outputDir)).map((line) => {
        const key = /^([A-Z][A-Z0-9]+-\d+):/.exec(line)?.[1];
        return { line, url: key ? `${base}/browse/${key}` : undefined };
      }));
      if (jiraEvery !== undefined && !opts.dryRun) {
        mkdirSync(outputDir, { recursive: true });
        writeFileSync(jiraMarker, new Date().toISOString());
      }
    }
    const lastSlack = existsSync(slackMarker) ? Date.parse(readFileSync(slackMarker, 'utf8').trim()) : NaN;
    if (watchSlack && !(Date.now() - lastSlack < slackEvery * 60_000 - 30_000)) {
      changes.push(...(await slackChanges(outputDir, opts.dryRun)));
      // After the replies round: a thread it exports has no "new replies" to report twice.
      try {
        changes.push(...(await slackMentionChanges(outputDir, new SlackClient(await loadSlackAuth()), { dryRun: opts.dryRun })));
      } catch (err) {
        changes.push({ line: `slack mentions: check failed (${String(err instanceof Error ? err.message : err).split('\n')[0]})`, error: true });
      }
      // After the mentions: a tag in a thread a session now follows goes to that session instead.
      if (opts.tags) {
        try {
          const tags = await slackTagChanges(outputDir, new SlackClient(await loadSlackAuth()), { dryRun: opts.dryRun });
          changes.push(...tags);
          if (!opts.dryRun) toastTags(outputDir, tags.flatMap((t) => (t.tag ? [t.tag] : [])));
        } catch (err) {
          changes.push({ line: `slack tags: check failed (${String(err instanceof Error ? err.message : err).split('\n')[0]})`, error: true });
        }
      }
      if (!opts.dryRun) {
        mkdirSync(outputDir, { recursive: true });
        writeFileSync(slackMarker, new Date().toISOString());
      }
    } else if (watchSlack) {
      // Between full rounds, threads a running session follows are checked every run: a reply someone
      // is waiting on in a session should not wait for the next round (up to --slack-every minutes).
      const followed = followedSlackThreads();
      if (followed.size) changes.push(...(await slackChanges(outputDir, opts.dryRun, undefined, Date.now(), followed)));
    }
    if (watchSlack) {
      // "<link> and below": the channel after a followed message, every run while its conversation goes on.
      const below = followedBelow();
      if (below.size) changes.push(...(await belowChanges(outputDir, opts.dryRun, new SlackClient(await loadSlackAuth()), below)));
    }
    // PR and run links posted later in a thread a session follows: the session follows them as well.
    if (!opts.dryRun) followThreadLinks(outputDir);
    if (opts.prs) changes.push(...prChanges(opts.prs, outputDir, opts.dryRun));
    // Actions runs a session follows (a deploy waiting for approval): only `gh api` calls, no repo needed.
    changes.push(...actionRunChanges(outputDir, opts.dryRun));
    // PR links into other repos (an infra or deploy PR waiting for approval): read by URL, no checkout.
    changes.push(...repoPrChanges(outputDir, opts.dryRun, splitByRepo(followedRepoPrs(), opts.prs ? prsRepo(outputDir) : undefined).other));
    // Follows of finished PRs, runs and "below" windows end an hour after watch saw them finished.
    if (!opts.dryRun) {
      const retired = retireFollows(finishedItems(outputDir));
      if (retired.length && !opts.quiet) console.log(`${stamp} no longer followed (finished): ${retired.join(', ')}`);
    }
    const errors = changes.filter((c) => c.error);
    const real = changes.filter((c) => !c.error);
    if (errors.length) console.log(`${stamp} ${errors.map((c) => c.line).join('; ')}`);
    if (real.length === 0) {
      if (!opts.quiet) console.log(`${stamp} no changes`);
    } else {
      const lines = real.map((c) => c.line);
      console.log(`${stamp} ${lines.length} change(s):\n${lines.map((l) => `  ${l}`).join('\n')}`);
      if (!opts.dryRun) {
        mkdirSync(outputDir, { recursive: true });
        appendFileSync(path.join(outputDir, CHANGES_FILE), `\n## ${stamp}\n\n${lines.map((l) => `- ${l}`).join('\n')}\n`);
        if (opts.notify) toast(lines.length === 1 ? 'jirallm' : `jirallm: ${lines.length} changes`, lines, real.find((c) => c.url)?.url);
      }
    }
    if (!opts.dryRun) {
      mkdirSync(outputDir, { recursive: true });
      writeFileSync(path.join(outputDir, WATCH_AT_MARKER), `${new Date().toISOString()}${errors.length ? ` ${errors.length} error(s)` : ''}`);
    }
    if (opts.closedSessions && !opts.dryRun) {
      // Imported here: closedSessions builds on sessions.ts, which imports this module.
      try {
        const { notifyClosedSessions } = await import('./closedSessions.js');
        const told = notifyClosedSessions(outputDir);
        if (told.length) console.log(`${stamp} told about closed sessions with news: ${told.map((n) => n.id.slice(0, 8)).join(', ')}`);
      } catch (err) {
        console.log(`${stamp} closed sessions: check failed (${String(err instanceof Error ? err.message : err).split('\n')[0]})`);
      }
    }
    if (every === undefined) return;
    await new Promise((resolve) => setTimeout(resolve, every * 60_000));
  }
}
