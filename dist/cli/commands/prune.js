import { existsSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import { confirm, isCancel } from '@clack/prompts';
import { listOrgs, loadProfile } from '../../lib/config.js';
import { JiraClient, jiraMillis } from '../../lib/jiraClient.js';
import { frontmatter } from './watch.js';
/** Files and folders an export writes; anything else in a ticket or page folder is the user's own and is kept. */
const TICKET_ARTIFACTS = ['task.md', '.task.previous.md', 'attachments'];
const PAGE_ARTIFACTS = ['page.md', '.page.previous.md', 'attachments'];
export function sizeOf(p) {
    if (!existsSync(p))
        return 0;
    const st = statSync(p);
    if (!st.isDirectory())
        return st.size;
    return readdirSync(p).reduce((sum, name) => sum + sizeOf(path.join(p, name)), 0);
}
/** Exported tickets: folders with a task.md that names its key. */
export function exportedTickets(outputDir) {
    if (!existsSync(outputDir))
        return [];
    return readdirSync(outputDir, { withFileTypes: true }).flatMap((d) => {
        const file = path.join(outputDir, d.name, 'task.md');
        if (!d.isDirectory() || !existsSync(file))
            return [];
        const fm = frontmatter(readFileSync(file, 'utf-8'));
        return fm.key ? [{ key: fm.key.toUpperCase(), dir: d.name, status: fm.status ?? '' }] : [];
    });
}
const CONFLUENCE_LINK = /confluence\/([^/)\s]+)\/page\.md/g;
const PAGE_TO_PAGE_LINK = /\.\.\/([^/)\s]+)\/page\.md/g;
function markdownFiles(dir) {
    if (!existsSync(dir))
        return [];
    return readdirSync(dir, { withFileTypes: true })
        .filter((d) => d.isFile() && d.name.endsWith('.md'))
        .map((d) => path.join(dir, d.name));
}
function linkedPages(files, pattern) {
    const out = new Set();
    for (const f of files)
        for (const m of readFileSync(f, 'utf-8').matchAll(pattern))
            out.add(m[1]);
    return out;
}
/**
 * Plans what to remove: the export files of the given finished tickets, and the Confluence pages
 * they reach (directly or through other pages) that no remaining ticket reaches. Pages no ticket
 * reaches at all were exported on their own and stay.
 * The user's own files in those folders (context.md, test reports, notes) are always kept.
 */
export function planPrune(outputDir, pruneKeys) {
    const tickets = exportedTickets(outputDir);
    const pruned = tickets.filter((t) => pruneKeys.has(t.key));
    const remaining = tickets.filter((t) => !pruneKeys.has(t.key));
    const confluenceRoot = path.join(outputDir, 'confluence');
    // Pages a set of tickets links to, directly or through other pages.
    const reach = (from) => {
        const seen = linkedPages(from.flatMap((t) => markdownFiles(path.join(outputDir, t.dir))), CONFLUENCE_LINK);
        const queue = [...seen];
        while (queue.length > 0) {
            const file = path.join(confluenceRoot, queue.pop(), 'page.md');
            if (!existsSync(file))
                continue;
            for (const next of linkedPages([file], PAGE_TO_PAGE_LINK)) {
                if (!seen.has(next)) {
                    seen.add(next);
                    queue.push(next);
                }
            }
        }
        return seen;
    };
    const candidates = reach(pruned);
    const reachable = reach(remaining);
    const ownFiles = (dir, artifacts) => readdirSync(dir).filter((name) => !artifacts.includes(name));
    const ticketPlans = pruned.map((t) => {
        const dir = path.join(outputDir, t.dir);
        const bytes = TICKET_ARTIFACTS.reduce((sum, a) => sum + sizeOf(path.join(dir, a)), 0);
        return { ...t, kept: ownFiles(dir, TICKET_ARTIFACTS), bytes };
    });
    const pagePlans = [...candidates]
        .filter((p) => !reachable.has(p) && existsSync(path.join(confluenceRoot, p, 'page.md')))
        .sort()
        .map((p) => {
        const dir = path.join(confluenceRoot, p);
        const title = frontmatter(readFileSync(path.join(dir, 'page.md'), 'utf-8')).title ?? p;
        const bytes = PAGE_ARTIFACTS.reduce((sum, a) => sum + sizeOf(path.join(dir, a)), 0);
        return { dir: p, title, kept: ownFiles(dir, PAGE_ARTIFACTS), bytes };
    });
    const bytes = [...ticketPlans, ...pagePlans].reduce((sum, x) => sum + x.bytes, 0);
    return { tickets: ticketPlans, pages: pagePlans, bytes };
}
/** Removes the export files the plan names; a folder left empty is removed too. */
export function applyPrune(outputDir, plan) {
    const clear = (dir, artifacts) => {
        for (const a of artifacts)
            rmSync(path.join(dir, a), { recursive: true, force: true });
        if (existsSync(dir) && readdirSync(dir).length === 0)
            rmSync(dir, { recursive: true, force: true });
    };
    for (const t of plan.tickets)
        clear(path.join(outputDir, t.dir), TICKET_ARTIFACTS);
    for (const p of plan.pages)
        clear(path.join(outputDir, 'confluence', p.dir), PAGE_ARTIFACTS);
}
export function formatBytes(n) {
    if (n < 1024)
        return `${n} B`;
    if (n < 1024 * 1024)
        return `${(n / 1024).toFixed(0)} KB`;
    return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
/** Keys in Done status category, done for at least `doneForDays`. Deleted or inaccessible keys are left alone. */
async function doneKeys(client, keys, doneForDays, now) {
    const done = new Set();
    for (let i = 0; i < keys.length; i += 100) {
        let batch = keys.slice(i, i + 100);
        let issues = [];
        for (;;) {
            if (batch.length === 0)
                break;
            try {
                issues = await client.searchByJql(`key in (${batch.join(',')}) AND statusCategory = Done`, [
                    'statuscategorychangedate',
                    'updated',
                ]);
                break;
            }
            catch (err) {
                const bad = [...err.message.matchAll(/'([A-Z][A-Z0-9_]*-\d+)'/g)].map((m) => m[1].toUpperCase());
                const next = batch.filter((k) => !bad.includes(k));
                if (next.length === batch.length)
                    throw err;
                batch = next;
            }
        }
        for (const issue of issues) {
            const since = (issue.fields.statuscategorychangedate ?? issue.fields.updated);
            const at = jiraMillis(since);
            if (doneForDays > 0 && Number.isFinite(at) && now - at < doneForDays * 86_400_000)
                continue;
            done.add(issue.key.toUpperCase());
        }
    }
    return done;
}
export async function runPrune(opts) {
    const orgs = listOrgs();
    const org = opts.org ?? (orgs.length === 1 ? orgs[0] : undefined);
    if (!org)
        throw new Error('Several organizations configured; pass --org.');
    const profile = await loadProfile({ org });
    const outputDir = opts.outputDir ?? profile.project.outputDir ?? './jira-export';
    const doneFor = Number(opts.doneFor ?? 0);
    if (!Number.isFinite(doneFor) || doneFor < 0)
        throw new Error('--done-for takes a number of days.');
    const keep = new Set((opts.keep ?? []).flatMap((k) => k.split(',')).map((k) => k.trim().toUpperCase()).filter(Boolean));
    const tickets = exportedTickets(outputDir);
    const client = new JiraClient(profile.config, profile.apiToken);
    const done = await doneKeys(client, tickets.map((t) => t.key), doneFor, Date.now());
    for (const k of keep)
        done.delete(k);
    const plan = planPrune(outputDir, done);
    if (opts.json) {
        if (!opts.dryRun && (plan.tickets.length > 0 || plan.pages.length > 0)) {
            if (!opts.yes)
                throw new Error('--json removes nothing without --yes (or use --dry-run).');
            applyPrune(outputDir, plan);
        }
        console.log(JSON.stringify({ outputDir, dryRun: Boolean(opts.dryRun), ...plan }, null, 2));
        return;
    }
    if (plan.tickets.length === 0 && plan.pages.length === 0) {
        console.log(`Nothing to prune in ${outputDir} (${tickets.length} exported tickets, none finished${doneFor ? ` ${doneFor}+ days ago` : ''}).`);
        return;
    }
    console.log(`Finished tickets (${plan.tickets.length} of ${tickets.length}):`);
    for (const t of plan.tickets) {
        console.log(`  ${t.key}  ${t.status}  ${formatBytes(t.bytes)}${t.kept.length ? `  keeps ${t.kept.join(', ')}` : ''}`);
    }
    if (plan.pages.length > 0) {
        console.log(`Confluence pages only those tickets link to (${plan.pages.length}):`);
        for (const p of plan.pages) {
            console.log(`  ${p.title}  ${formatBytes(p.bytes)}${p.kept.length ? `  keeps ${p.kept.join(', ')}` : ''}`);
        }
    }
    console.log(`Total: ${formatBytes(plan.bytes)}. Exports come back with \`jirallm <KEY>\`; your own files are kept.`);
    if (opts.dryRun)
        return;
    if (!opts.yes) {
        if (!process.stdin.isTTY)
            throw new Error('Pass --yes to remove (or --dry-run to only list).');
        const ok = await confirm({ message: `Remove ${formatBytes(plan.bytes)} of exports?`, initialValue: false });
        if (isCancel(ok) || ok !== true) {
            console.log('Nothing removed.');
            return;
        }
    }
    applyPrune(outputDir, plan);
    console.log(`Removed ${plan.tickets.length} ticket exports and ${plan.pages.length} pages (${formatBytes(plan.bytes)}).`);
}
//# sourceMappingURL=prune.js.map