// GitHub Actions runs a running Claude Code session follows (`run/<owner>/<repo>/<id>` in its .follow):
// a deploy run on main that is no PR, waiting for someone to approve its environment. `watch` reports
// when a run starts waiting for approval, is approved or rejected, runs, and finishes, and stops asking
// about a run once it finished.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { defaultGh, type Gh } from './prStatus.js';
import { isRunning } from './resume.js';

const RUNS_FILE = '.runs.json';
export const RUN_LINK = /github\.com\/([\w.-]+)\/([\w.-]+)\/actions\/runs\/(\d+)/g;

/** The follow items (`run/<owner>/<repo>/<id>`) of the Actions run links in `text`. */
export function runItems(text: string): string[] {
  return [...new Set([...text.matchAll(RUN_LINK)].map((m) => `run/${m[1]}/${m[2]}/${m[3]}`))];
}

export type RunSnapshot = { status: string; conclusion?: string; approvals: string[]; waitingFor: string[] };
type RunsState = Record<string, RunSnapshot>;

type ApiRun = { name?: string; display_title?: string; status: string; conclusion: string | null; html_url: string };
type ApiApproval = { state: string; user?: { login?: string }; environments?: Array<{ name?: string }> };

/** Runs that running sessions follow. */
export function followedRuns(sessionsDir = path.join(os.tmpdir(), 'jirallm-sessions')): string[] {
  const runs = new Set<string>();
  if (!existsSync(sessionsDir)) return [];
  for (const f of readdirSync(sessionsDir)) {
    if (!f.endsWith('.follow') || !isRunning(f.slice(0, -'.follow'.length), sessionsDir)) continue;
    for (const l of readFileSync(path.join(sessionsDir, f), 'utf8').split(/\r?\n/)) {
      if (/^run\/[\w.-]+\/[\w.-]+\/\d+$/.test(l.trim())) runs.add(l.trim());
    }
  }
  return [...runs];
}

const approvalText = (a: ApiApproval) =>
  `${a.state === 'rejected' ? 'rejected' : 'approved'} by ${a.user?.login ?? 'someone'}` +
  (a.environments?.length ? ` (${a.environments.map((e) => e.name).join(', ')})` : '');

/** What changed between two looks at a run, or undefined. */
export function describeRunChange(old: RunSnapshot | undefined, now: RunSnapshot, failedJobs: () => string[]): string | undefined {
  const parts: string[] = [];
  for (const a of now.approvals.slice(old?.approvals.length ?? 0)) parts.push(a);
  if (now.status === 'waiting' && (old?.status !== 'waiting' || old.waitingFor.join() !== now.waitingFor.join())) {
    parts.push(`waiting for approval${now.waitingFor.length ? ` (${now.waitingFor.join(', ')})` : ''}`);
  } else if (now.status === 'completed' && old?.status !== 'completed') {
    if (now.conclusion === 'success') parts.push('succeeded');
    else {
      const jobs = failedJobs();
      parts.push(`${now.conclusion ?? 'finished'}${jobs.length ? `: ${jobs.join(', ')}` : ''}`);
    }
  } else if (['in_progress', 'queued'].includes(now.status) && (!old || ['waiting', 'requested', 'pending'].includes(old.status))) {
    parts.push('running');
  }
  return parts.length ? parts.join(', ') : undefined;
}

/** Changes of the followed runs since the last look (state in .runs.json). */
export function runChanges(
  outputDir: string,
  dryRun: boolean | undefined,
  gh: Gh = defaultGh,
  runs: string[] = followedRuns()
): Array<{ line: string; url?: string; error?: boolean }> {
  if (!runs.length) return [];
  const file = path.join(outputDir, RUNS_FILE);
  const prev: RunsState = existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as RunsState) : {};
  const next: RunsState = {};
  const changes: Array<{ line: string; url?: string; error?: boolean }> = [];
  const api = <T>(p: string) => JSON.parse(gh(outputDir, ['api', p])) as T;
  for (const item of runs) {
    const old = prev[item];
    if (old?.status === 'completed') {
      next[item] = old;
      continue;
    }
    const [, owner, repo, id] = item.split('/');
    const base = `repos/${owner}/${repo}/actions/runs/${id}`;
    try {
      const run = api<ApiRun>(base);
      const approvals = api<ApiApproval[]>(`${base}/approvals`).map(approvalText);
      const waitingFor =
        run.status === 'waiting'
          ? api<Array<{ environment?: { name?: string } }>>(`${base}/pending_deployments`).map((d) => d.environment?.name ?? '?')
          : [];
      const snap: RunSnapshot = { status: run.status, conclusion: run.conclusion ?? undefined, approvals, waitingFor };
      next[item] = snap;
      const failedJobs = () => {
        try {
          return api<{ jobs: Array<{ name: string; conclusion: string | null }> }>(`${base}/jobs?per_page=100`)
            .jobs.filter((j) => j.conclusion === 'failure')
            .map((j) => j.name);
        } catch {
          return [];
        }
      };
      const change = describeRunChange(old, snap, failedJobs);
      const title = run.display_title ?? run.name ?? '';
      if (change) changes.push({ line: `Run ${id} (${owner}/${repo}): ${change}${title ? ` — ${title}` : ''}`, url: run.html_url });
    } catch (err) {
      if (old) next[item] = old;
      changes.push({ line: `Run ${id}: check failed (${String(err instanceof Error ? err.message : err).split('\n')[0]})`, error: true });
    }
  }
  if (!dryRun) {
    mkdirSync(outputDir, { recursive: true });
    writeFileSync(file, JSON.stringify({ ...prev, ...next }, null, 1));
  }
  return changes;
}
