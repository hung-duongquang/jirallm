import { exportConfluencePageByUrl } from '../../lib/pageExport.js';
/** Exports one Confluence page (by URL) to `<outputDir>/confluence/<id>-<slug>/page.md`. */
export async function runPage(url, opts) {
    const page = await exportConfluencePageByUrl(url, { org: opts.org, outputDir: opts.outputDir ?? './jira-export' });
    console.log(`✓ ${page.title}: ${page.path} (${page.status}, ${page.attachmentCount} attachment(s))`);
}
//# sourceMappingURL=page.js.map