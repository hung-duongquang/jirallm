// PRs a running Claude Code session follows by link (`pr/<owner>/<repo>/<n>` in its .follow). A PR in the
// repo `watch --prs` checks joins that check (prChanges); a PR in any other repo (an infra PR in
// zorgdeclaraties-aws, a deploy PR in the Octopus repo) is read here by its URL, so no checkout is needed.
// `watch` reports its CI, reviews (an approval someone was asked for) and its merge, and stops asking
// about it once it is merged or closed.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { defaultGh, describePrChange, fetchPrState, snapshotOf, type Gh, type PrSnapshot } from './prStatus.js';
import { isRunning } from './resume.js';
import { runItems } from './runWatch.js';

const REPO_PRS_FILE = '.repo-prs.json';
export const PR_LINK = /github\.com\/([\w.-]+)\/([\w.-]+)\/pull\/(\d+)/g;
export const REPO_PR_ITEM = /^pr\/([\w.-]+)\/([\w.-]+)\/(\d+)$/i;

/** The follow items (`pr/<owner>/<repo>/<n>`) of the PR links in `text`. */
export function prItems(text: string): string[] {
  return [...new Set([...text.matchAll(PR_LINK)].map((m) => `pr/${m[1]}/${m[2]}/${m[3]}`))];
}

/** Repo-qualified PRs (`pr/<owner>/<repo>/<n>`) that running sessions follow. */
export function followedRepoPrs(sessionsDir = path.join(os.tmpdir(), 'jirallm-sessions')): string[] {
  const prs = new Set<string>();
  if (!existsSync(sessionsDir)) return [];
  for (const f of readdirSync(sessionsDir)) {
    if (!f.endsWith('.follow') || !isRunning(f.slice(0, -'.follow'.length), sessionsDir)) continue;
    for (const l of readFileSync(path.join(sessionsDir, f), 'utf8').split(/\r?\n/)) {
      if (REPO_PR_ITEM.test(l.trim())) prs.add(l.trim());
    }
  }
  return [...prs];
}

/** Splits followed PRs into numbers of the repo `slug` (prChanges reads those) and PRs of other repos. */
export function splitByRepo(items: string[], slug: string | undefined): { local: number[]; other: string[] } {
  const local: number[] = [];
  const other: string[] = [];
  for (const item of items) {
    const m = REPO_PR_ITEM.exec(item);
    if (!m) continue;
    if (slug && `${m[1]}/${m[2]}`.toLowerCase() === slug.toLowerCase()) local.push(Number(m[3]));
    else other.push(item);
  }
  return { local, other };
}

/**
 * PR and Actions run links posted in a followed Slack thread after the session took it on ("approve
 * octopus #330 and aws #884 please" as a later reply): running sessions that follow the thread
 * (`slack/<dir>`) follow them too. Reads the local exports, which `watch` refreshes before this.
 * Ticket keys are left out: the thread's first read already picked those (at most 3).
 */
export function followThreadLinks(outputDir: string, sessionsDir = path.join(os.tmpdir(), 'jirallm-sessions')): void {
  if (!existsSync(sessionsDir)) return;
  for (const f of readdirSync(sessionsDir)) {
    if (!f.endsWith('.follow') || !isRunning(f.slice(0, -'.follow'.length), sessionsDir)) continue;
    try {
      const file = path.join(sessionsDir, f);
      const had = readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean);
      const fresh = new Set<string>();
      for (const item of had) {
        const dir = /^slack\/([\w-]+)$/i.exec(item)?.[1];
        const thread = dir && path.join(outputDir, 'slack', dir.toLowerCase(), 'thread.md');
        if (!thread || !existsSync(thread)) continue;
        // The thread's own messages: channel messages outside it can be unrelated.
        const text = readFileSync(thread, 'utf8').split(/^# In the channel, outside the thread/m)[0]!.replace(/^---[\s\S]*?\n---\n/, '');
        for (const i of [...prItems(text), ...runItems(text)]) if (!had.includes(i)) fresh.add(i);
      }
      if (fresh.size) writeFileSync(file, [...had, ...fresh].join('\n'));
    } catch {
      // Following is a bonus.
    }
  }
}

type RepoPrSnapshot = PrSnapshot & { state?: string };
type RepoPrsState = Record<string, RepoPrSnapshot>;

/** Changes of followed PRs in other repos since the last look (state in .repo-prs.json). */
export function repoPrChanges(
  outputDir: string,
  dryRun: boolean | undefined,
  items: string[],
  gh: Gh = defaultGh
): Array<{ line: string; url?: string; error?: boolean }> {
  if (!items.length) return [];
  const file = path.join(outputDir, REPO_PRS_FILE);
  const prev: RepoPrsState = existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as RepoPrsState) : {};
  const next: RepoPrsState = {};
  const changes: Array<{ line: string; url?: string; error?: boolean }> = [];
  for (const item of items) {
    const old = prev[item];
    if (old?.state && old.state !== 'OPEN') {
      next[item] = old;
      continue;
    }
    const [, owner, repo, n] = REPO_PR_ITEM.exec(item)!;
    const slug = `${owner}/${repo}`;
    try {
      const state = fetchPrState(gh, outputDir, `https://github.com/${slug}/pull/${n}`);
      const snap: RepoPrSnapshot = { ...snapshotOf(state), repo: slug, state: state.state };
      next[item] = snap;
      const label = `PR #${n} (${slug}${snap.key ? `, ${snap.key}` : ''})`;
      if (state.state !== 'OPEN') {
        changes.push({ line: `${label}: ${state.state.toLowerCase()}`, url: snap.url });
        continue;
      }
      const line = describePrChange(old, snap);
      if (line) changes.push({ line, url: snap.url });
    } catch (err) {
      if (old) next[item] = old;
      changes.push({ line: `PR #${n} (${slug}): status check failed (${String(err instanceof Error ? err.message : err).split('\n')[0]})`, error: true });
    }
  }
  if (!dryRun) {
    mkdirSync(outputDir, { recursive: true });
    writeFileSync(file, JSON.stringify({ ...prev, ...next }, null, 1));
  }
  return changes;
}
