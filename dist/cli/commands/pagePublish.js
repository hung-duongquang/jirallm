import { listOrgs, loadProfile } from '../../lib/config.js';
import { ConfluenceClient } from '../../lib/confluence.js';
import { defaultSite, pagePublish, pageRef } from '../../lib/pagePublish.js';
import { parseIssueKey } from '../issueKey.js';
import { printJson, shouldOutputJson } from '../jsonOutput.js';
import { resolveOrg } from '../resolveOrg.js';
import { tsvCell } from './search.js';
async function profileFor(org, issueKey) {
    if (issueKey) {
        const parsed = parseIssueKey(issueKey);
        return loadProfile({ org: resolveOrg(parsed.org, org, parsed.projectKey), project: parsed.projectKey });
    }
    const orgs = listOrgs();
    const chosen = org ?? (orgs.length === 1 ? orgs[0] : undefined);
    if (!chosen)
        throw new Error('Several organizations configured; pass --org.');
    return loadProfile({ org: chosen });
}
export async function runPagePublish(file, opts) {
    const link = opts.link ? parseIssueKey(opts.link).key : undefined;
    const profile = await profileFor(opts.org, opts.link);
    const r = await pagePublish(profile, file, { ...opts, link });
    const extras = [`${r.attachments.length} attachment(s)`, r.link ? `linked from ${r.link}` : undefined].filter(Boolean).join(', ');
    if (opts.dryRun) {
        const target = r.action === 'update' ? `update page ${r.pageId}` : `create "${r.title}" in space ${r.space}${r.parentId ? ` under ${r.parentId}` : ''}`;
        console.log(`Dry run — would ${target} on ${r.site}: ${extras}${r.attachments.length ? ` (${r.attachments.join(', ')})` : ''}`);
        return;
    }
    const done = r;
    console.log(`✓ ${done.action === 'create' ? 'created' : 'updated'} "${done.title}" ${done.url} (v${done.version}, ${extras})`);
}
export async function runPageChildren(page, opts) {
    const profile = await profileFor(opts.org);
    const ref = pageRef(page, profile);
    const client = new ConfluenceClient(ref.site ?? defaultSite(profile), profile.config.userEmail, profile.apiToken);
    const children = await client.childPages(ref.id);
    const format = opts.format ?? (shouldOutputJson(opts) ? 'json' : 'text');
    if (format === 'json') {
        printJson(children);
    }
    else if (format === 'tsv') {
        if (children.length)
            console.log(['id\ttitle\turl', ...children.map((c) => [c.id, c.title, c.url].map(tsvCell).join('\t'))].join('\n'));
    }
    else if (!children.length) {
        console.log('No child pages.');
    }
    else {
        for (const c of children)
            console.log(`  ${c.id}  ${c.title}`);
    }
}
//# sourceMappingURL=pagePublish.js.map