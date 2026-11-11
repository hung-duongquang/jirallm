import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { keyFromBranch } from './prContext.js';
import { defaultGh, type Gh } from './prStatus.js';
import { NOTES_FILE } from './state.js';

export type ReviewHistoryOptions = { repo?: string; outputDir?: string; write?: boolean };

type Author = { login: string } | null;
type GqlComment = { author: Author; body: string; createdAt: string; url: string };
type GqlThread = { isResolved: boolean; isOutdated: boolean; path: string; line: number | null; originalLine: number | null; comments: { nodes: GqlComment[] } };
type GqlReview = { author: Author; state: string; body: string; submittedAt: string | null; commit: { oid: string } | null };
type GqlCommit = { commit: { oid: string; messageHeadline: string; committedDate: string } };

export type ReviewData = {
  me: string;
  number: number;
  title: string;
  url: string;
  state: string;
  author: string;
  headRefName: string;
  headOid: string;
  reviews: GqlReview[];
  threads: GqlThread[];
  comments: GqlComment[];
  commits: GqlCommit['commit'][];
};

const QUERY = `query($o:String!,$n:String!,$p:Int!){viewer{login}repository(owner:$o,name:$n){pullRequest(number:$p){
number title url state headRefName headRefOid author{login}
reviews(first:100){nodes{author{login} state body submittedAt commit{oid}}}
reviewThreads(first:100){nodes{isResolved isOutdated path line originalLine comments(first:30){nodes{author{login} body createdAt url}}}}
comments(first:100){nodes{author{login} body createdAt url}}
commits(last:100){nodes{commit{oid messageHeadline committedDate}}}}}}`;

const MAX_BODY = 400;
const MAX_FILES = 30;
const login = (a: Author) => a?.login ?? 'ghost';
const clip = (s: string, n = MAX_BODY) => {
  const one = s.replace(/<!--[\s\S]*?-->/g, '').replace(/\s+/g, ' ').trim();
  return one.length > n ? `${one.slice(0, n)}…` : one;
};
const stamp = (ts: string) => new Date(ts).toLocaleString('sv-SE').slice(0, 16);

export function fetchReviewData(gh: Gh, cwd: string, pr: string): ReviewData {
  const url = JSON.parse(gh(cwd, ['pr', 'view', pr, '--json', 'url'])) as { url: string };
  const [, owner, name] = /github\.com\/([^/]+)\/([^/]+)\/pull\//.exec(url.url) ?? [];
  const res = JSON.parse(gh(cwd, ['api', 'graphql', '-f', `query=${QUERY}`, '-F', `o=${owner}`, '-F', `n=${name}`, '-F', `p=${pr}`])) as {
    data: {
      viewer: { login: string };
      repository: { pullRequest: {
        number: number; title: string; url: string; state: string; headRefName: string; headRefOid: string; author: Author;
        reviews: { nodes: GqlReview[] }; reviewThreads: { nodes: GqlThread[] }; comments: { nodes: GqlComment[] }; commits: { nodes: GqlCommit[] };
      } };
    };
  };
  const p = res.data.repository.pullRequest;
  return {
    me: res.data.viewer.login,
    number: p.number,
    title: p.title,
    url: p.url,
    state: p.state,
    author: login(p.author),
    headRefName: p.headRefName,
    headOid: p.headRefOid,
    reviews: p.reviews.nodes,
    threads: p.reviewThreads.nodes,
    comments: p.comments.nodes,
    commits: p.commits.nodes.map((c) => c.commit),
  };
}

export type Diffstat = { files: Array<{ filename: string; additions: number; deletions: number }> } | undefined;

/**
 * What I already said on a PR and what happened since: my reviews, every review thread I took part
 * in grouped by outcome (resolved, answered by someone else, still waiting on the author), my
 * conversation comments, the commits after my last review with the files they touched, and the
 * local notes for the ticket. Meant to be read before a re-review, so settled points are not raised
 * again and only the new work gets reviewed.
 */
export function renderReviewHistory(d: ReviewData, diff: Diffstat, notes: string[]): string {
  const key = keyFromBranch(d.headRefName) ?? keyFromBranch(d.title);
  const mine = d.reviews.filter((r) => login(r.author) === d.me && r.submittedAt);
  const last = mine[mine.length - 1];
  const out = [
    `# Review history: PR #${d.number}${key ? ` (${key})` : ''}: ${d.title}`,
    '',
    `${d.state} · author ${d.author} · reviewer ${d.me} · ${d.url}`,
    '',
    `## My reviews: ${mine.length}`,
    '',
  ];
  if (!mine.length) out.push('- none (first review: nothing to skip)');
  for (const r of mine) out.push(`- ${stamp(r.submittedAt!)} **${r.state}** on ${r.commit?.oid.slice(0, 9) ?? '?'}${r.body.trim() ? `: ${clip(r.body)}` : ''}`);

  const joined = d.threads.filter((t) => t.comments.nodes.some((c) => login(c.author) === d.me));
  const outcome = (t: GqlThread) => {
    if (t.isResolved) return 'resolved';
    const lastBy = login(t.comments.nodes[t.comments.nodes.length - 1]!.author);
    return lastBy === d.me ? 'waiting' : 'answered';
  };
  const groups: Array<[string, string]> = [
    ['answered', 'Answered by someone else, not resolved (check the reply, then resolve or follow up)'],
    ['waiting', 'Still waiting on the author (my comment is the last word)'],
    ['resolved', 'Resolved (settled: do not raise again)'],
  ];
  out.push('', `## Review threads I took part in: ${joined.length}`);
  for (const [kind, heading] of groups) {
    const ts = joined.filter((t) => outcome(t) === kind);
    if (!ts.length) continue;
    out.push('', `### ${heading}: ${ts.length}`, '');
    for (const t of ts) {
      const [first, ...rest] = t.comments.nodes;
      const at = `${t.path}${t.line ?? t.originalLine ? `:${t.line ?? t.originalLine}` : ''}${t.isOutdated ? ' (outdated: code changed since)' : ''}`;
      out.push(`- ${at} · ${first!.url}`);
      out.push(`  > ${login(first!.author)}: ${clip(first!.body)}`);
      // Resolved threads only need the point; open ones need the whole exchange.
      const shown = kind === 'resolved' ? rest.slice(-1) : rest;
      for (const c of shown) out.push(`  > ${login(c.author)}${kind === 'resolved' ? ' (last)' : ''}: ${clip(c.body)}`);
    }
  }

  const myComments = d.comments.filter((c) => login(c.author) === d.me);
  if (myComments.length) {
    out.push('', `## My conversation comments: ${myComments.length}`, '');
    for (const c of myComments) out.push(`- ${stamp(c.createdAt)}: ${clip(c.body)}`);
    const firstMine = Date.parse(myComments[0]!.createdAt);
    const replies = d.comments.filter((c) => login(c.author) !== d.me && !/\[bot\]|github-actions/i.test(login(c.author)) && Date.parse(c.createdAt) > firstMine);
    for (const c of replies) out.push(`- (reply) ${login(c.author)} ${stamp(c.createdAt)}: ${clip(c.body)}`);
  }

  if (last) {
    const lastAt = Date.parse(last.submittedAt!);
    const idx = last.commit ? d.commits.findIndex((c) => c.oid === last.commit!.oid) : -1;
    const newer = idx >= 0 ? d.commits.slice(idx + 1) : d.commits.filter((c) => Date.parse(c.committedDate) > lastAt);
    out.push('', `## Since my last review (${stamp(last.submittedAt!)}): ${newer.length} commit(s)`, '');
    if (idx < 0 && last.commit) out.push(`- my last reviewed commit ${last.commit.oid.slice(0, 9)} is no longer on the branch (rebased or force-pushed): commits listed by date`);
    for (const c of newer) out.push(`- ${c.oid.slice(0, 9)} ${stamp(c.committedDate)} ${clip(c.messageHeadline, 120)}`);
    if (diff?.files.length) {
      out.push('', `Files changed since then (${diff.files.length}):`);
      for (const f of diff.files.slice(0, MAX_FILES)) out.push(`- ${f.filename} +${f.additions} -${f.deletions}`);
      if (diff.files.length > MAX_FILES) out.push(`- … ${diff.files.length - MAX_FILES} more`);
      out.push('', `Review only this: \`gh api repos/{owner}/{repo}/compare/${last.commit!.oid.slice(0, 12)}...${d.headOid.slice(0, 12)}\` or \`git diff ${last.commit!.oid.slice(0, 12)} ${d.headOid.slice(0, 12)}\`.`);
    }
  }

  if (notes.length) {
    out.push('', `## Local notes${key ? ` (${key.toLowerCase()}/${NOTES_FILE})` : ''}`, '', ...notes);
  }
  return out.filter((l, i, a) => !(l === '' && a[i - 1] === '')).join('\n');
}

/** Files changed between the commit I last reviewed and the head (undefined when it is gone). */
function diffSince(gh: Gh, cwd: string, d: ReviewData): Diffstat {
  const mine = d.reviews.filter((r) => login(r.author) === d.me && r.submittedAt && r.commit);
  const base = mine[mine.length - 1]?.commit?.oid;
  if (!base || base === d.headOid || !d.commits.some((c) => c.oid === base)) return undefined;
  try {
    const slug = /github\.com\/([^/]+\/[^/]+)\/pull\//.exec(d.url)?.[1];
    return JSON.parse(gh(cwd, ['api', `repos/${slug}/compare/${base}...${d.headOid}`, '--jq', '{files: [.files[] | {filename, additions, deletions}]}'])) as Diffstat;
  } catch {
    return undefined;
  }
}

export function runReviewHistory(pr: string, opts: ReviewHistoryOptions, gh: Gh = defaultGh): void {
  if (!/^\d+$/.test(pr)) throw new Error(`Expected a PR number, got "${pr}".`);
  const cwd = path.resolve(opts.repo ?? '.');
  const d = fetchReviewData(gh, cwd, pr);
  const key = keyFromBranch(d.headRefName) ?? keyFromBranch(d.title);
  const outputDir = path.resolve(opts.outputDir ?? './jira-export');
  const notesFile = key ? path.join(outputDir, key.toLowerCase(), NOTES_FILE) : '';
  const notes = notesFile && existsSync(notesFile) ? readFileSync(notesFile, 'utf8').split(/\r?\n/).filter((l) => l.trim() && !l.startsWith('#')) : [];
  const text = renderReviewHistory(d, diffSince(gh, cwd, d), notes);
  console.log(text);
  if (opts.write !== false && key) {
    const dir = path.join(outputDir, key.toLowerCase());
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, `review-${d.number}.md`), `${text}\n`);
  }
}
