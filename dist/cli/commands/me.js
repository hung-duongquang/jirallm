import { loadOrgProfile } from '../../lib/config.js';
import { JiraClient } from '../../lib/jiraClient.js';
import { printJson, shouldOutputJson } from '../jsonOutput.js';
export async function runMe(opts) {
    const profile = await loadOrgProfile({ org: opts.org });
    const client = new JiraClient(profile.config, profile.apiToken);
    const user = await client.getCurrentUser();
    if (shouldOutputJson(opts)) {
        printJson(user);
        return;
    }
    console.log(`Display name: ${user.displayName}`);
    console.log(`Account ID:   ${user.accountId}`);
    if (user.emailAddress)
        console.log(`Email:        ${user.emailAddress}`);
}
//# sourceMappingURL=me.js.map