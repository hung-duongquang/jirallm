import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { listOrgs, loadProfile } from '../../lib/config.js';
import { ConfluenceClient, exportConfluencePage } from '../../lib/confluence.js';
import { JiraExporter } from '../../lib/exporter.js';
import { JiraClient, jiraMillis, latestCommentUpdate } from '../../lib/jiraClient.js';
import { defaultGh, describePrChange, fetchPrState, myOpenPrs, notifiedPrs, repoSlug, snapshotOf, toast } from './prStatus.js';
const MINE_JQL = 'assignee = currentUser() AND statusCategory != Done';
const CHANGES_FILE = 'CHANGES.md';
const TASK_NAME = 'jirallm watch';
const PRS_FILE = '.prs.json';
const JIRA_MARKER = '.watch.jira-at';
/** Reads `key: "value"` lines from a markdown file's frontmatter (top-level and one nested level). */
export function frontmatter(md) {
    const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(md);
    const out = {};
    for (const line of match?.[1].split(/\r?\n/) ?? []) {
        const m = /^\s{0,2}([A-Za-z][\w-]*):\s*(.+)$/.exec(line);
        if (m)
            out[m[1]] = m[2].replace(/^"(.*)"$/, '$1');
    }
    return out;
}
const toMillis = jiraMillis;
function localIssues(outputDir) {
    if (!existsSync(outputDir))
        return [];
    return readdirSync(outputDir, { withFileTypes: true }).flatMap((d) => {
        const file = path.join(outputDir, d.name, 'task.md');
        if (!d.isDirectory() || !existsSync(file))
            return [];
        const fm = frontmatter(readFileSync(file, 'utf-8'));
        if (!fm.key)
            return [];
        const commentCount = fm.commentCount === undefined ? undefined : Number(fm.commentCount);
        return [{ key: fm.key, updatedAt: fm.updatedAt, commentsUpdatedAt: fm.commentsUpdatedAt, commentCount }];
    });
}
function localPages(outputDir) {
    const root = path.join(outputDir, 'confluence');
    if (!existsSync(root))
        return [];
    return readdirSync(root, { withFileTypes: true }).flatMap((d) => {
        const file = path.join(root, d.name, 'page.md');
        if (!d.isDirectory() || !existsSync(file))
            return [];
        const fm = frontmatter(readFileSync(file, 'utf-8'));
        if (!fm.id || !fm.url)
            return [];
        return [{ id: fm.id, origin: new URL(fm.url).origin.toLowerCase(), version: Number(fm.version ?? 0), dir: d.name }];
    });
}
/**
 * Runs a JQL search; when it names issue keys that no longer exist (deleted, or no access),
 * Jira rejects the whole query, so those keys are dropped and the query retried.
 */
async function searchKeys(client, keys) {
    let remaining = keys;
    for (;;) {
        if (remaining.length === 0)
            return [];
        try {
            return await client.searchByJql(`key in (${remaining.join(',')})`, ['updated', 'comment']);
        }
        catch (err) {
            const bad = [...err.message.matchAll(/'([A-Z][A-Z0-9_]*-\d+)'/g)].map((m) => m[1].toUpperCase());
            const next = remaining.filter((k) => !bad.includes(k.toUpperCase()));
            if (next.length === remaining.length)
                throw err;
            remaining = next;
        }
    }
}
/** One line per changed frontmatter field plus the `##` sections whose text changed. */
export function describeChange(previous, current) {
    if (previous === null)
        return 'new';
    const before = frontmatter(previous);
    const after = frontmatter(current);
    const fields = [...new Set([...Object.keys(before), ...Object.keys(after)])]
        .filter((k) => !['updatedAt', 'commentsUpdatedAt', 'commentCount'].includes(k) && before[k] !== after[k])
        .map((k) => `${k}: ${before[k] ?? '∅'} → ${after[k] ?? '∅'}`);
    const sections = (md) => {
        const map = new Map();
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
/**
 * Jira does not move the issue's `updated` when a comment is edited or deleted, so compare the newest
 * comment timestamp (exports without `commentsUpdatedAt` fall back to `updatedAt`) and the comment count
 * (skipped for exports without `commentCount`) with what the export saw.
 */
export function commentsChangedSince(known, issue) {
    const field = issue.fields.comment;
    const comments = field?.comments ?? [];
    if (known.commentCount !== undefined && (field?.total ?? comments.length) !== known.commentCount)
        return true;
    const seen = Math.max(toMillis(known.commentsUpdatedAt) || 0, toMillis(known.updatedAt) || 0);
    return toMillis(latestCommentUpdate(comments)) > seen;
}
async function runOnce(profile, opts, outputDir) {
    const client = new JiraClient(profile.config, profile.apiToken);
    const local = localIssues(outputDir);
    const localByKey = new Map(local.map((i) => [i.key.toUpperCase(), i]));
    const stale = new Set();
    for (let i = 0; i < local.length; i += 100) {
        for (const issue of await searchKeys(client, local.slice(i, i + 100).map((l) => l.key))) {
            const known = localByKey.get(issue.key.toUpperCase());
            if (!known || toMillis(known.updatedAt) !== toMillis(issue.fields.updated))
                stale.add(issue.key);
            else if (commentsChangedSince(known, issue))
                stale.add(issue.key);
        }
    }
    const scopes = [opts.mine !== false ? MINE_JQL : undefined, opts.jql].filter((q) => Boolean(q));
    for (const jql of scopes) {
        for (const issue of await client.searchByJql(jql, ['updated'])) {
            if (!localByKey.has(issue.key.toUpperCase()))
                stale.add(issue.key);
        }
    }
    const lines = [];
    if (opts.dryRun) {
        lines.push(...[...stale].map((k) => `${k}: would re-export`));
    }
    else if (stale.size > 0) {
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
                if (requested)
                    lines.push(`${key}: ${describeChange(previous, current)}`);
            },
        });
        for (const f of result.failed)
            lines.push(`${f.key}: export failed (${f.error.split('\n')[0]})`);
    }
    if (opts.pages !== false) {
        // The API token goes to these hosts, so only the Jira site and configured Confluence sites qualify.
        const allowed = new Set([profile.config.baseUrl, ...(profile.org.confluenceUrls ?? [])].map((u) => new URL(u).origin.toLowerCase()));
        const byOrigin = new Map();
        for (const p of localPages(outputDir)) {
            if (allowed.has(p.origin))
                byOrigin.set(p.origin, [...(byOrigin.get(p.origin) ?? []), p]);
        }
        for (const [origin, pages] of byOrigin) {
            const confluence = new ConfluenceClient(origin, profile.config.userEmail, profile.apiToken);
            const versions = await confluence.pageVersions(pages.map((p) => p.id));
            for (const p of pages) {
                const version = versions.get(p.id);
                if (version === undefined || version === p.version)
                    continue;
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
/**
 * CI and review changes on my open PRs in the repo at `repo` since the last run (state in .prs.json):
 * new check failures, CI back to green, new reviews, review threads awaiting me, comments, merged/closed.
 * Cheap enough to run every minute: one `gh pr list` (checks of all my PRs) plus a notifications poll
 * that is a free 304 when nothing happened; a PR is only read in full when its checks changed or it
 * got a notification.
 */
export function prChanges(repo, outputDir, dryRun, gh = defaultGh) {
    const file = path.join(outputDir, PRS_FILE);
    const stored = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : undefined;
    const state = stored && 'prs' in stored ? stored : { prs: (stored ?? {}) };
    const prev = state.prs;
    const cwd = path.resolve(repo);
    const firstLine = (err) => String(err instanceof Error ? err.message : err).split('\n')[0];
    const changes = [];
    const next = {};
    const startedAt = new Date().toISOString();
    let meta = state.meta ?? {};
    try {
        const slug = meta.repo ?? repoSlug(gh, cwd);
        const since = meta.checkedAt ? new Date(Date.parse(meta.checkedAt) - 120_000).toISOString() : undefined;
        const notified = notifiedPrs(gh, cwd, slug, meta.lastModified, since);
        for (const { number: n, sig } of myOpenPrs(gh, cwd)) {
            const old = prev[n];
            if (old && old.sig === sig && notified.prs && !notified.prs.includes(n)) {
                next[n] = old;
                continue;
            }
            try {
                const snap = { ...snapshotOf(fetchPrState(gh, cwd, String(n))), sig };
                next[n] = snap;
                const line = describePrChange(old, snap);
                if (line)
                    changes.push({ line, url: snap.url });
            }
            catch (err) {
                if (old)
                    next[n] = old;
                changes.push({ line: `PR #${n}: status check failed (${firstLine(err)})`, error: true });
            }
        }
        for (const [n, old] of Object.entries(prev)) {
            if (next[n])
                continue;
            let pr = 'closed';
            try {
                pr = JSON.parse(gh(cwd, ['pr', 'view', n, '--json', 'state'])).state.toLowerCase();
            }
            catch { /* keep "closed" */ }
            changes.push({ line: `PR #${n}${old.key ? ` (${old.key})` : ''}: ${pr}`, url: old.url });
        }
        meta = { repo: slug, lastModified: notified.lastModified, checkedAt: startedAt };
    }
    catch (err) {
        return [{ line: `PRs: gh failed (${firstLine(err)})`, error: true }];
    }
    if (!dryRun) {
        mkdirSync(outputDir, { recursive: true });
        writeFileSync(file, JSON.stringify({ meta, prs: next }, null, 1));
    }
    return changes;
}
/** Splits CHANGES.md into its `## <stamp>` entries, oldest first. */
export function changeEntries(md) {
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
export function runChanges(opts) {
    const outputDir = opts.outputDir ?? './jira-export';
    const file = path.join(outputDir, CHANGES_FILE);
    if (!existsSync(file))
        return;
    const max = opts.max === undefined ? 20 : Number(opts.max);
    if (!Number.isInteger(max) || max < 1)
        throw new Error('--max must be a positive integer.');
    const marker = path.join(outputDir, '.changes.seen');
    const seen = opts.unseen && existsSync(marker) ? readFileSync(marker, 'utf-8').trim() : '';
    const entries = changeEntries(readFileSync(file, 'utf-8')).filter((e) => e.stamp > seen);
    if (entries.length === 0)
        return;
    if (opts.unseen)
        writeFileSync(marker, entries[entries.length - 1].stamp);
    // One line per item, latest state wins: a ticket that changed twice is listed once.
    const latest = new Map();
    for (const e of entries) {
        for (const l of e.lines) {
            const item = l.slice(2).split(':')[0];
            latest.delete(item);
            latest.set(item, `${l} (${e.stamp})`);
        }
    }
    const lines = [...latest.values()];
    const shown = lines.slice(-max);
    const header = opts.unseen ? `Jira/Confluence/PR changes since ${seen || 'the start of the log'}` : 'Jira/Confluence/PR changes';
    console.log(`${header} (re-exported to ${outputDir}; diff task.md with .task.previous.md for details):`);
    if (shown.length < lines.length)
        console.log(`- … ${lines.length - shown.length} older line(s) in ${file}`);
    console.log(shown.join('\n'));
}
/** Windows Task Scheduler entry running `jirallm watch` every N minutes from this directory, without a console window. */
function install(opts, outputDir) {
    const minutes = typeof opts.install === 'string' ? Number(opts.install) : 15;
    if (!Number.isInteger(minutes) || minutes < 1)
        throw new Error('--install takes a whole number of minutes.');
    const args = ['watch', '--output-dir', path.resolve(outputDir)];
    if (opts.org)
        args.push('--org', opts.org);
    if (opts.jql)
        args.push('--jql', opts.jql);
    if (opts.mine === false)
        args.push('--no-mine');
    if (opts.pages === false)
        args.push('--no-pages');
    if (opts.prs)
        args.push('--prs', path.resolve(opts.prs));
    if (opts.jiraEvery)
        args.push('--jira-every', opts.jiraEvery);
    if (opts.notify)
        args.push('--notify');
    args.push('--quiet');
    const quote = (s) => `"${s.replace(/"/g, '""')}"`;
    const script = path.resolve(outputDir, '.jirallm-watch.cmd');
    const log = path.resolve(outputDir, '.watch.log');
    if (process.platform !== 'win32') {
        console.log(`Add this line with \`crontab -e\`:\n*/${minutes} * * * * cd ${quote(process.cwd())} && ${quote(process.execPath)} ${quote(process.argv[1])} ${args.map(quote).join(' ')} >> ${quote(log)} 2>&1`);
        return;
    }
    mkdirSync(path.dirname(script), { recursive: true });
    writeFileSync(script, `@echo off\r\ncd /d ${quote(process.cwd())}\r\n${quote(process.execPath)} ${quote(process.argv[1])} ${args.map(quote).join(' ')} >> ${quote(log)} 2>&1\r\n`);
    execFileSync('schtasks', ['/Create', '/F', '/SC', 'MINUTE', '/MO', String(minutes), '/TN', TASK_NAME, '/TR', `conhost.exe --headless ${quote(script)}`], { stdio: 'inherit' });
    console.log(`✓ "${TASK_NAME}" runs every ${minutes} min; changes go to ${path.join(outputDir, CHANGES_FILE)}, output to ${log}`);
}
/**
 * Re-exports what changed in Jira or Confluence since the local copy: exported tickets whose
 * `updated` moved, open tickets assigned to me (and `--jql` matches) not yet exported, and exported
 * Confluence pages with a newer version. Each change is printed and appended to CHANGES.md.
 */
export async function runWatch(opts) {
    if (opts.uninstall) {
        execFileSync('schtasks', ['/Delete', '/F', '/TN', TASK_NAME], { stdio: 'inherit' });
        return;
    }
    const orgs = listOrgs();
    const org = opts.org ?? (orgs.length === 1 ? orgs[0] : undefined);
    if (!org)
        throw new Error('Several organizations configured; pass --org.');
    const profile = await loadProfile({ org });
    const outputDir = opts.outputDir ?? profile.project.outputDir ?? './jira-export';
    if (opts.install) {
        install(opts, outputDir);
        return;
    }
    const every = opts.every === undefined ? undefined : Number(opts.every);
    if (every !== undefined && !(every > 0))
        throw new Error('--every takes a number of minutes.');
    const jiraEvery = opts.jiraEvery === undefined ? undefined : Number(opts.jiraEvery);
    if (jiraEvery !== undefined && !(jiraEvery > 0))
        throw new Error('--jira-every takes a number of minutes.');
    const jiraMarker = path.join(outputDir, JIRA_MARKER);
    for (;;) {
        const stamp = new Date().toLocaleString('sv-SE').slice(0, 16);
        const lastJira = existsSync(jiraMarker) ? Date.parse(readFileSync(jiraMarker, 'utf8').trim()) : NaN;
        const jiraDue = jiraEvery === undefined || !(Date.now() - lastJira < jiraEvery * 60_000 - 30_000);
        const changes = [];
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
        if (opts.prs)
            changes.push(...prChanges(opts.prs, outputDir, opts.dryRun));
        const errors = changes.filter((c) => c.error);
        const real = changes.filter((c) => !c.error);
        if (errors.length)
            console.log(`${stamp} ${errors.map((c) => c.line).join('; ')}`);
        if (real.length === 0) {
            if (!opts.quiet)
                console.log(`${stamp} no changes`);
        }
        else {
            const lines = real.map((c) => c.line);
            console.log(`${stamp} ${lines.length} change(s):\n${lines.map((l) => `  ${l}`).join('\n')}`);
            if (!opts.dryRun) {
                mkdirSync(outputDir, { recursive: true });
                appendFileSync(path.join(outputDir, CHANGES_FILE), `\n## ${stamp}\n\n${lines.map((l) => `- ${l}`).join('\n')}\n`);
                if (opts.notify)
                    toast(lines.length === 1 ? 'jirallm' : `jirallm: ${lines.length} changes`, lines, real.find((c) => c.url)?.url);
            }
        }
        if (every === undefined)
            return;
        await new Promise((resolve) => setTimeout(resolve, every * 60_000));
    }
}
//# sourceMappingURL=watch.js.map