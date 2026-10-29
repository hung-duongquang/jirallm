import { listOrgs, loadProfile } from '../../lib/config.js';
import { ConfluenceClient, exportConfluencePage } from '../../lib/confluence.js';
import { parseConfluenceUrl } from '../../lib/confluenceLinks.js';
/** Exports one Confluence page (by URL) to `<outputDir>/confluence/<id>-<slug>/page.md`. */
export async function runPage(url, opts) {
    const ref = parseConfluenceUrl(url);
    if (!ref || ref.kind !== 'page')
        throw new Error(`Not a Confluence page URL: ${url}`);
    const orgs = listOrgs();
    const org = opts.org ?? (orgs.length === 1 ? orgs[0] : undefined);
    if (!org)
        throw new Error('Several organizations configured; pass --org.');
    const profile = await loadProfile({ org });
    // The API token goes to this host, so only the Jira site and configured Confluence sites qualify.
    const allowed = [profile.config.baseUrl, ...(profile.org.confluenceUrls ?? [])].map((u) => new URL(u).origin.toLowerCase());
    if (!allowed.includes(ref.origin)) {
        throw new Error(`${ref.origin} is not the Jira site or a configured confluence_urls entry of "${org}".`);
    }
    const client = new ConfluenceClient(ref.origin, profile.config.userEmail, profile.apiToken);
    const page = await exportConfluencePage(client, ref.id, { outputDir: opts.outputDir ?? './jira-export' });
    console.log(`✓ ${page.title}: ${page.path} (${page.status}, ${page.attachmentCount} attachment(s))`);
}
//# sourceMappingURL=page.js.map