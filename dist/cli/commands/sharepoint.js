import { intro, outro, password, text, isCancel, cancel } from '@clack/prompts';
import { getSecret, removeSecret, setSecret } from '../../lib/credentials.js';
import { SHAREPOINT_COOKIE_ACCOUNT, SHAREPOINT_NOT_SET_UP, SHAREPOINT_URL_ACCOUNT, SharePointClient, exportSharePointPage, fetchSharePointPage, hasSharePointAuth, loadSharePointAuth, parseCookieInput, parseOrigin, parseSharePointPageUrl, renderSharePointPage, searchSharePoint, } from '../../lib/sharepoint.js';
import { exportOfficeDocument, extractOfficeDocument, parseOfficeLink, renderOfficeDocument } from '../../lib/sharepointOffice.js';
import { describeEditResults, editNeedsAttention, editPowerPoint, validateEdits } from '../../lib/sharepointOfficeEdit.js';
import { readFileSync } from 'node:fs';
import { printJson } from '../jsonOutput.js';
/**
 * Prints a SharePoint page as Markdown, or with --output-dir writes
 * <dir>/sharepoint/<site>-<page>/page.md and downloads its images next to it.
 */
export async function runSharePoint(url, opts) {
    const office = parseOfficeLink(url);
    if (office)
        return runSharePointOffice(url, office, opts);
    if (opts.outputDir && !opts.json) {
        const page = await exportSharePointPage(url, { outputDir: opts.outputDir, images: opts.images });
        for (const err of page.imageErrors)
            console.error(`# ${err}`);
        console.log(`✓ ${page.title}: ${page.path} (${page.changed ? 'updated' : 'unchanged'}, ${page.imageCount} image(s))`);
        return;
    }
    const link = parseSharePointPageUrl(url);
    const client = new SharePointClient(await loadSharePointAuth(url));
    const item = await fetchSharePointPage(client, link);
    if (opts.json) {
        printJson({ link, item });
        return;
    }
    process.stdout.write(renderSharePointPage(url, link, item).markdown);
}
/** Office documents open in the local Office app with the user's own sign-in (no cookie needed). */
async function runSharePointOffice(url, link, opts) {
    if (opts.outputDir && !opts.json) {
        const doc = await exportOfficeDocument(url, { outputDir: opts.outputDir, copy: opts.copy });
        console.log(`✓ ${doc.title}: ${doc.path} (${doc.changed ? 'updated' : 'unchanged'}${doc.copy ? `, copy ${doc.copy}` : ''})`);
        return;
    }
    const doc = await extractOfficeDocument(link);
    if (opts.json) {
        printJson({ link, doc });
        return;
    }
    process.stdout.write(renderOfficeDocument(url, doc));
}
/** `@path` reads the value from a file (UTF-8), so multi-line text needs no shell quoting. */
function valueOf(v) {
    return v.startsWith('@') ? readFileSync(v.slice(1), 'utf8').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\n$/, '') : v;
}
export function editsFromOptions(opts) {
    const raw = [];
    if (opts.edits) {
        const parsed = JSON.parse(valueOf(opts.edits.startsWith('@') ? opts.edits : `@${opts.edits}`));
        raw.push(...(Array.isArray(parsed) ? parsed : [parsed]));
    }
    const slide = opts.slide !== undefined ? Number(opts.slide) : undefined;
    if (opts.shape !== undefined || opts.text !== undefined) {
        if (opts.shape === undefined || opts.text === undefined)
            throw new Error('--shape and --text go together.');
        raw.push({ slide, shape: opts.shape, text: valueOf(opts.text) });
    }
    if (opts.notes !== undefined)
        raw.push({ slide, notes: valueOf(opts.notes) });
    if (opts.find !== undefined || opts.replace !== undefined) {
        if (opts.find === undefined || opts.replace === undefined)
            throw new Error('--find and --replace go together.');
        raw.push({ slide, find: valueOf(opts.find), replace: valueOf(opts.replace) });
    }
    if (!raw.length)
        throw new Error('Nothing to change: give --shape/--text, --notes, --find/--replace or --edits <file.json>.');
    return validateEdits(raw);
}
/** Edits a PowerPoint deck on SharePoint in place (through local PowerPoint) and prints before/after. */
export async function runSharePointEdit(url, opts) {
    const edits = editsFromOptions(opts);
    const report = await editPowerPoint(url, edits, { dryRun: opts.dryRun });
    if (opts.json) {
        printJson({ dryRun: Boolean(opts.dryRun), ...report });
        return;
    }
    console.log(describeEditResults(report, opts.dryRun));
    if (editNeedsAttention(report))
        process.exitCode = 1;
}
/** One TSV row per hit: modified, site, title, url, summary. Open a page with `jirallm sharepoint <url>`. */
export async function runSharePointSearch(query, opts) {
    const max = opts.max ? Number(opts.max) : 20;
    if (!Number.isInteger(max) || max < 1 || max > 500)
        throw new Error(`--max needs a number from 1 to 500, got: ${opts.max}`);
    if (!query.trim())
        throw new Error('Empty search query.');
    if (!(await hasSharePointAuth())) {
        if (opts.json)
            printJson({ skipped: SHAREPOINT_NOT_SET_UP, hits: [] });
        else
            console.log(SHAREPOINT_NOT_SET_UP);
        return;
    }
    const client = new SharePointClient(await loadSharePointAuth(opts.site));
    const { kql, total, hits } = await searchSharePoint(client, query, { site: opts.site, documents: opts.documents, max });
    if (opts.json) {
        printJson({ query: kql, total, hits });
        return;
    }
    console.error(`# ${kql}: ${total} result(s)${total > hits.length ? `, showing ${hits.length}` : ''}`);
    if (hits.length === 0)
        return;
    const cols = ['modified', 'site', 'title', 'url', 'summary'];
    console.log(cols.join('\t'));
    for (const h of hits)
        console.log(cols.map((c) => h[c].replace(/\t/g, ' ')).join('\t'));
}
export async function runSharePointAuth(opts) {
    if (opts.remove) {
        const a = await removeSecret(SHAREPOINT_COOKIE_ACCOUNT);
        const b = await removeSecret(SHAREPOINT_URL_ACCOUNT);
        console.log(a || b ? 'Removed the SharePoint session.' : 'No SharePoint session stored.');
        return;
    }
    if (!opts.check) {
        intro('jirallm sharepoint:auth');
        const site = await text({
            message: 'SharePoint site URL (any page of it)',
            placeholder: 'https://contoso.sharepoint.com/sites/Intranet',
            initialValue: (await getSecret(SHAREPOINT_URL_ACCOUNT, 'SHAREPOINT_URL')) ?? '',
            validate: (v) => (parseOrigin(v ?? '') ? undefined : 'Expected https://<tenant>.sharepoint.com/…'),
        });
        if (isCancel(site)) {
            cancel('Cancelled.');
            return;
        }
        const pasted = await password({
            message: 'Browser session cookie: open the site in your browser, DevTools → Network → any request to the site → Copy → Copy as cURL (bash), and paste it here (or paste only the Cookie header)',
            validate: (v) => {
                try {
                    parseCookieInput(v ?? '');
                    return undefined;
                }
                catch (err) {
                    return err.message;
                }
            },
        });
        if (isCancel(pasted)) {
            cancel('Cancelled.');
            return;
        }
        await setSecret(SHAREPOINT_URL_ACCOUNT, site.trim());
        await setSecret(SHAREPOINT_COOKIE_ACCOUNT, parseCookieInput(pasted));
        outro('Stored in the OS keychain (only the FedAuth and rtFa cookies).');
    }
    const client = new SharePointClient(await loadSharePointAuth());
    const me = await client.json(`${client.origin}/_api/web/currentuser?$select=Title,Email`);
    console.log(`SharePoint OK: ${me.Title ?? '?'} <${me.Email ?? '?'}> on ${client.origin}`);
}
//# sourceMappingURL=sharepoint.js.map