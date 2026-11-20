import { loadOrgProfile, loadProfile } from '../../lib/config.js';
import { JiraClient } from '../../lib/jiraClient.js';
import { parseIssueKey } from '../issueKey.js';
import { resolveOrg } from '../resolveOrg.js';
import { printJson, shouldOutputJson } from '../jsonOutput.js';
async function resolveScope(opts) {
    const parsed = opts.issue ? parseIssueKey(opts.issue) : undefined;
    if (!parsed && !opts.project) {
        const org = resolveOrg(undefined, opts.org, '');
        const profile = await loadOrgProfile({ org });
        return { org, client: new JiraClient(profile.config, profile.apiToken) };
    }
    const org = resolveOrg(parsed?.org, opts.org, parsed?.projectKey ?? opts.project ?? '');
    const profile = await loadProfile({ org, project: parsed?.projectKey ?? opts.project });
    return {
        org,
        client: new JiraClient(profile.config, profile.apiToken),
        issueKey: parsed?.key,
        projectKey: profile.project.key,
    };
}
async function findUsers(scope, query, limit) {
    if (query.trim().toLowerCase() === 'me')
        return [await scope.client.getCurrentUser()];
    if (scope.issueKey || scope.projectKey) {
        return scope.client.searchAssignableUsers({
            query,
            issueKey: scope.issueKey,
            project: scope.issueKey ? undefined : scope.projectKey,
            maxResults: limit,
        });
    }
    return scope.client.searchUsers(query, limit);
}
function formatUser(user) {
    const email = user.emailAddress ? ` <${user.emailAddress}>` : '';
    const inactive = user.active === false ? ' [inactive]' : '';
    return `  ${user.accountId.padEnd(28)}  ${user.displayName}${email}${inactive}`;
}
export async function runUsers(opts) {
    const scope = await resolveScope(opts);
    const limit = opts.limit ? parseInt(opts.limit, 10) : undefined;
    if (limit !== undefined && (!Number.isFinite(limit) || limit < 1)) {
        throw new Error(`--limit must be a positive integer (got "${opts.limit}").`);
    }
    const users = await findUsers(scope, opts.query, limit);
    if (shouldOutputJson(opts)) {
        printJson(users);
        return;
    }
    if (users.length === 0) {
        console.log(`No user found matching "${opts.query}".`);
        return;
    }
    console.log(`${users.length} user(s) matching "${opts.query}":`);
    for (const user of users)
        console.log(formatUser(user));
}
//# sourceMappingURL=users.js.map