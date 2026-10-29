import { loadProfile } from '../../lib/config.js';
import { JiraClient } from '../../lib/jiraClient.js';
import { resolveOrg } from '../resolveOrg.js';
import { printJson, shouldOutputJson } from '../jsonOutput.js';
async function fetchBoards(opts) {
    const org = resolveOrg(undefined, opts.org, opts.project ?? '');
    const profile = await loadProfile({ org, project: opts.project });
    const client = new JiraClient(profile.config, profile.apiToken);
    return client.listBoards({
        projectKey: opts.project ?? profile.project.key,
        type: opts.type,
        name: opts.name,
        limit: opts.limit ? parseInt(opts.limit, 10) : undefined,
        startAt: opts.startAt ? parseInt(opts.startAt, 10) : undefined,
    });
}
export async function runBoards(opts) {
    let page;
    try {
        page = await fetchBoards(opts);
    }
    catch (error) {
        if (shouldOutputJson(opts)) {
            printJson({ error: error instanceof Error ? error.message : String(error) });
            process.exitCode = 1;
            return;
        }
        throw error;
    }
    if (shouldOutputJson(opts)) {
        printJson(page);
        return;
    }
    if (page.values.length === 0) {
        console.log('No boards found.');
        return;
    }
    console.log(`${page.values.length} board(s):`);
    for (const b of page.values) {
        console.log(`  [${b.id}] ${b.name} (${b.type})`);
    }
}
//# sourceMappingURL=boards.js.map