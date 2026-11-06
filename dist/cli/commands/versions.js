import { loadProfile } from '../../lib/config.js';
import { JiraClient } from '../../lib/jiraClient.js';
import { resolveOrg } from '../resolveOrg.js';
import { printJson, shouldOutputJson } from '../jsonOutput.js';
export function versionStatus(version) {
    if (version.archived)
        return 'archived';
    if (version.released)
        return 'released';
    return 'unreleased';
}
function dateSuffix(version, status) {
    if (!version.releaseDate)
        return '';
    if (status === 'released')
        return ` — released ${version.releaseDate}`;
    if (status === 'unreleased')
        return ` — due ${version.releaseDate}`;
    return '';
}
function formatVersion(version) {
    const status = versionStatus(version);
    return `  ${version.name} [${status}]${dateSuffix(version, status)}`;
}
export async function runVersions(opts) {
    try {
        const org = resolveOrg(undefined, opts.org, opts.project ?? '');
        const profile = await loadProfile({ org, project: opts.project });
        const client = new JiraClient(profile.config, profile.apiToken);
        const projectKey = profile.project.key;
        const versions = await client.listVersions(projectKey);
        if (shouldOutputJson(opts)) {
            printJson(versions);
            return;
        }
        if (versions.length === 0) {
            console.log('No versions found.');
            return;
        }
        console.log(`${versions.length} version(s):`);
        for (const v of versions) {
            console.log(formatVersion(v));
        }
    }
    catch (err) {
        if (shouldOutputJson(opts)) {
            printJson({ error: err instanceof Error ? err.message : String(err) });
            process.exitCode = 1;
            return;
        }
        throw err;
    }
}
//# sourceMappingURL=versions.js.map