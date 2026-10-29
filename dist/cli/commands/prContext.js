import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { loadProfile } from '../../lib/config.js';
import { JiraClient } from '../../lib/jiraClient.js';
import { parseIssueKey } from '../issueKey.js';
import { resolveOrg } from '../resolveOrg.js';
const SHORT_VALUE = 100;
const MAX_COMMENT = 800;
const MAX_DIFF_LINES = 15;
const MAX_STAT_FILES = 25;
const toMillis = (ts) => Date.parse(ts.replace(/([+-]\d\d)(\d\d)$/, '$1:$2'));
const stamp = (ts) => new Date(toMillis(ts)).toLocaleString('sv-SE').slice(0, 16);
const clip = (s, n) => (s.length > n ? `${s.slice(0, n)}…` : s);
/** The issue key in a branch name such as feature/ZOD-3825-held-credit. */
export function keyFromBranch(branch) {
    return /([A-Z][A-Z0-9]+-\d+)/i.exec(branch)?.[1]?.toUpperCase();
}
/** Lines removed from and added to a long text value (description, acceptance criteria). */
export function lineDiff(from, to, max = MAX_DIFF_LINES) {
    const split = (s) => s.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const a = split(from);
    const b = split(to);
    const out = [...a.filter((l) => !b.includes(l)).map((l) => `  - ${clip(l, 200)}`), ...b.filter((l) => !a.includes(l)).map((l) => `  + ${clip(l, 200)}`)];
    return out.length > max ? [...out.slice(0, max), `  … ${out.length - max} more changed line(s)`] : out;
}
/** Jira history and comments after `since`, oldest first, as markdown list lines. */
export function jiraEventsSince(histories, comments, since, toMarkdown) {
    const after = (ts) => since === undefined || toMillis(ts) > since;
    const events = [];
    for (const h of histories.filter((x) => after(x.created))) {
        const lines = [];
        for (const item of h.items) {
            const from = item.fromString ?? '';
            const to = item.toString ?? '';
            const long = from.length > SHORT_VALUE || to.length > SHORT_VALUE || /\n/.test(from + to);
            if (long && !from.trim())
                lines.push(`- ${stamp(h.created)} ${h.author.displayName} set **${item.field}** (${to.split(/\r?\n/).filter((l) => l.trim()).length} lines, see task.md)`);
            else if (long)
                lines.push(`- ${stamp(h.created)} ${h.author.displayName} changed **${item.field}**:`, ...lineDiff(from, to));
            else
                lines.push(`- ${stamp(h.created)} ${h.author.displayName}: ${item.field}: ${from || '∅'} → ${to || '∅'}`);
        }
        events.push({ at: toMillis(h.created), lines });
    }
    for (const c of comments.filter((x) => after(x.created))) {
        const body = clip(toMarkdown(c.body).trim().replace(/\n{2,}/g, '\n'), MAX_COMMENT).split('\n').map((l) => `  > ${l}`);
        events.push({ at: toMillis(c.created), lines: [`- ${stamp(c.created)} ${c.author.displayName} commented:`, ...body] });
    }
    return events.sort((x, y) => x.at - y.at).flatMap((e) => e.lines);
}
/** When work started: the first branch commit, else the last move to In Progress. */
export function workStart(commits, histories) {
    if (commits.length)
        return { at: Date.parse(commits[0].date), why: `first commit ${commits[0].hash.slice(0, 8)}` };
    const moves = histories.filter((h) => h.items.some((i) => i.field === 'status' && /in progress/i.test(i.toString ?? '')));
    const last = moves[moves.length - 1];
    return last ? { at: toMillis(last.created), why: 'moved to In Progress' } : undefined;
}
const defaultDeps = {
    git: (repo, args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }),
    exportIssue: (issueKey, outputDir) => {
        execFileSync(process.execPath, [process.argv[1], 'export', issueKey, '--no-status-changes', '--output-dir', outputDir], { stdio: ['ignore', 'ignore', 'inherit'] });
    },
};
export async function runPrContext(issueKeyArg, opts, deps = defaultDeps) {
    const repo = path.resolve(opts.repo ?? '.');
    const base = opts.base ?? 'origin/main';
    const git = (args) => {
        try {
            return deps.git(repo, args).trim();
        }
        catch {
            return '';
        }
    };
    const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']);
    const keyArg = issueKeyArg ?? keyFromBranch(branch);
    if (!keyArg)
        throw new Error(`No issue key given and none in branch "${branch || '?'}".`);
    const parsed = parseIssueKey(keyArg);
    const org = resolveOrg(parsed.org, opts.org, parsed.projectKey);
    const profile = await loadProfile({ org, project: parsed.projectKey });
    const client = new JiraClient(profile.config, profile.apiToken);
    const commits = git(['log', '--reverse', '--format=%H%x09%aI%x09%s', `${base}..HEAD`])
        .split('\n').filter(Boolean)
        .map((l) => { const [hash, date, ...s] = l.split('\t'); return { hash: hash, date: date, subject: s.join('\t') }; });
    const [issue, histories, comments] = await Promise.all([
        client.fetchIssueRaw(parsed.key, []),
        client.fetchIssueChangelog(parsed.key),
        client.fetchIssueComments(parsed.key),
    ]);
    const start = opts.since ? { at: Date.parse(opts.since), why: '--since' } : workStart(commits, histories);
    if (start && Number.isNaN(start.at))
        throw new Error(`Invalid --since "${opts.since}".`);
    const outputDir = opts.outputDir ?? './jira-export';
    if (opts.export !== false)
        deps.exportIssue(parsed.key, outputDir);
    const f = issue.fields;
    const out = [
        `# ${parsed.key} PR context`,
        '',
        `${f.summary ?? ''} · status **${f.status?.name ?? '?'}** · assignee ${f.assignee?.displayName ?? '∅'} · ${profile.config.baseUrl.replace(/\/$/, '')}/browse/${parsed.key}`,
        opts.export !== false ? `Ticket re-exported: ${path.join(outputDir, parsed.key.toLowerCase(), 'task.md')} (check the PR against its acceptance criteria).` : '',
        '',
        `## Jira since work started (${start ? `${new Date(start.at).toLocaleString('sv-SE').slice(0, 16)}, ${start.why}` : 'whole history'})`,
        '',
    ];
    const events = jiraEventsSince(histories, comments, start?.at, (b) => client.convertADFToMarkdown(b));
    out.push(...(events.length ? events : ['- nothing changed']));
    out.push('', `## Branch ${branch || '?'} vs ${base}`, '');
    if (commits.length)
        out.push(...commits.map((c) => `- ${c.hash.slice(0, 8)} ${c.subject}`));
    else
        out.push('- no commits yet');
    const stat = git(['diff', '--stat=120', `${base}...HEAD`]).split('\n').filter(Boolean);
    if (stat.length) {
        const files = stat.slice(0, -1);
        out.push('', ...files.slice(0, MAX_STAT_FILES).map((l) => `    ${l.trim()}`));
        if (files.length > MAX_STAT_FILES)
            out.push(`    … ${files.length - MAX_STAT_FILES} more file(s)`);
        out.push(`    ${stat[stat.length - 1].trim()}`);
    }
    const dirty = git(['status', '--porcelain']).split('\n').filter(Boolean).length;
    if (dirty)
        out.push('', `Uncommitted: ${dirty} file(s) (git status).`);
    console.log(out.filter((l, i, a) => !(l === '' && a[i - 1] === '')).join('\n'));
}
//# sourceMappingURL=prContext.js.map