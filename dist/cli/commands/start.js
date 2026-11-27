import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { loadProfile } from '../../lib/config.js';
import { JiraClient } from '../../lib/jiraClient.js';
import { parseIssueKey } from '../issueKey.js';
import { resolveOrg } from '../resolveOrg.js';
import { resolveAccountId } from '../resolveUser.js';
const MAX_SLUG_LENGTH = 70;
/** "BE - Journal entries overview (API)" → "be-journal-entries-overview-api" */
export function slugify(summary, maxLength = MAX_SLUG_LENGTH) {
    const words = summary
        .normalize('NFKD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter(Boolean);
    let slug = '';
    for (const word of words) {
        const next = slug ? `${slug}-${word}` : word;
        if (next.length > maxLength)
            break;
        slug = next;
    }
    return slug || words[0]?.slice(0, maxLength) || 'work';
}
export function branchName(type, issueKey, slug) {
    return `${type}/${issueKey}-${slug}`;
}
/** Number part of the key, so ZOD-3775 lands in <root>/3775 like the existing worktrees. */
export function worktreePath(root, issueKey) {
    return path.join(root, issueKey.split('-').pop() ?? issueKey);
}
const defaultDeps = {
    run: (cmd, args) => {
        execFileSync(cmd, args, { stdio: 'inherit' });
    },
    exportIssue: (issueKey, outputDir) => {
        execFileSync(process.execPath, [process.argv[1], 'export', issueKey, '--no-status-changes', '--output-dir', outputDir], { stdio: 'inherit' });
    },
};
export async function runStart(issueKeyArg, opts, deps = defaultDeps) {
    const parsed = parseIssueKey(issueKeyArg);
    const org = resolveOrg(parsed.org, opts.org, parsed.projectKey);
    const profile = await loadProfile({ org, project: parsed.projectKey });
    const client = new JiraClient(profile.config, profile.apiToken);
    const issue = await client.fetchIssueRaw(parsed.key, []);
    const summary = String(issue.fields?.summary ?? '');
    const branch = branchName(opts.type ?? 'feature', parsed.key, opts.slug ?? slugify(summary));
    const repo = opts.repo ? path.resolve(opts.repo) : undefined;
    const root = opts.worktreeRoot ?? process.env.JIRALLM_WORKTREE_ROOT ?? (repo ? `${repo}-worktrees` : undefined);
    const worktree = repo && root ? worktreePath(root, parsed.key) : undefined;
    const base = opts.base ?? 'origin/main';
    const status = opts.status ?? 'In Progress';
    const outputDir = opts.outputDir ?? './jira-export';
    const plan = [
        `${parsed.key}: ${summary}`,
        opts.export !== false ? `export → ${outputDir}` : undefined,
        worktree ? `worktree ${worktree} on new branch ${branch} from ${base}` : `branch name: ${branch} (no --repo, no worktree)`,
        opts.assign !== false ? 'assign → me' : undefined,
        opts.transition !== false ? `transition → ${status}` : undefined,
    ].filter(Boolean);
    if (opts.dryRun) {
        console.log('Dry run — would:');
        for (const line of plan)
            console.log(`  ${line}`);
        return;
    }
    if (opts.export !== false)
        deps.exportIssue(parsed.key, outputDir);
    // Git before Jira: a failed worktree must not leave the ticket claimed and in progress.
    if (repo && worktree) {
        if (existsSync(worktree))
            throw new Error(`${worktree} already exists; pass --worktree-root or remove it first.`);
        const remote = base.includes('/') ? base.split('/')[0] : 'origin';
        const remoteBranch = base.includes('/') ? base.slice(remote.length + 1) : base;
        deps.run('git', ['-C', repo, 'fetch', remote, remoteBranch]);
        deps.run('git', ['-C', repo, 'worktree', 'add', '--no-track', '-b', branch, worktree, base]);
        console.log(`✓ worktree ${worktree} (${branch})`);
    }
    else {
        console.log(`Branch name: ${branch}`);
    }
    if (opts.assign !== false) {
        const { accountId, displayName } = await resolveAccountId(client, 'me', { project: parsed.projectKey });
        await client.assignIssue(parsed.key, accountId);
        console.log(`✓ ${parsed.key} assigned to ${displayName ?? 'me'}`);
    }
    if (opts.transition !== false) {
        const current = issue.fields?.status?.name;
        if (current?.toLowerCase() === status.toLowerCase()) {
            console.log(`✓ ${parsed.key} already ${current}`);
        }
        else {
            const result = await client.transitionIssue(parsed.key, status);
            console.log(`✓ ${parsed.key} transitioned via "${result.name}" → "${status}"`);
        }
    }
}
//# sourceMappingURL=start.js.map