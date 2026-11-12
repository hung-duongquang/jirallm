import { loadOrgProfile } from '../../lib/config.js';
import { JiraClient } from '../../lib/jiraClient.js';
import { printJson, shouldOutputJson } from '../jsonOutput.js';
export async function runProjects(opts) {
    const profile = await loadOrgProfile({ org: opts.org });
    const client = new JiraClient(profile.config, profile.apiToken);
    const page = await client.listProjects({
        query: opts.query,
        limit: opts.limit ? parseInt(opts.limit, 10) : undefined,
        startAt: opts.startAt ? parseInt(opts.startAt, 10) : undefined,
    });
    if (shouldOutputJson(opts)) {
        printJson(page);
        return;
    }
    if (page.values.length === 0) {
        console.log('No projects found.');
        return;
    }
    console.log(`${page.values.length} project(s):`);
    for (const p of page.values) {
        console.log(`  ${p.key.padEnd(12)}  ${p.name}`);
    }
}
//# sourceMappingURL=projects.js.map