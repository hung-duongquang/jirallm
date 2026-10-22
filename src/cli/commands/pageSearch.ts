import { listOrgs, loadProfile } from '../../lib/config.js';
import { ConfluenceClient, toCql, type ConfluenceSearchRow } from '../../lib/confluence.js';
import { printJson, shouldOutputJson } from '../jsonOutput.js';
import { tsvCell } from './search.js';

export type PageSearchOptions = {
  org?: string;
  site?: string;
  space?: string;
  limit?: string;
  cursor?: string;
  all?: boolean;
  max?: string;
  format?: string;
  json?: boolean;
};

const OUTPUT_FORMATS = ['json', 'text', 'tsv'] as const;
const TSV_COLUMNS = ['id', 'type', 'space', 'title', 'lastModified', 'url', 'excerpt'] as const;

function positiveInt(value: string | undefined, fallback: number, flag: string): number {
  if (value === undefined) return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) throw new Error(`${flag} must be a positive integer.`);
  return n;
}

/**
 * Searches Confluence by CQL (or plain words) on the Jira site and every configured
 * confluence_urls site, or only on `--site`. A site without Confluence is skipped with a warning
 * when several are searched.
 */
export async function runPageSearch(query: string, opts: PageSearchOptions): Promise<void> {
  const format = opts.format ?? (shouldOutputJson(opts) ? 'json' : 'text');
  if (!(OUTPUT_FORMATS as readonly string[]).includes(format)) {
    throw new Error(`Unknown --format "${format}". Use one of: ${OUTPUT_FORMATS.join(', ')}.`);
  }
  const limit = positiveInt(opts.limit, 25, '--limit');
  const max = positiveInt(opts.max, 200, '--max');

  const orgs = listOrgs();
  const org = opts.org ?? (orgs.length === 1 ? orgs[0] : undefined);
  if (!org) throw new Error('Several organizations configured; pass --org.');
  const profile = await loadProfile({ org });

  // The API token goes to these hosts, so only the Jira site and configured Confluence sites qualify.
  const allowed = [...new Set([profile.config.baseUrl, ...(profile.org.confluenceUrls ?? [])].map((u) => new URL(u).origin.toLowerCase()))];
  let sites = allowed;
  if (opts.site) {
    const origin = new URL(opts.site.includes('://') ? opts.site : `https://${opts.site}`).origin.toLowerCase();
    if (!allowed.includes(origin)) throw new Error(`${origin} is not the Jira site or a configured confluence_urls entry of "${org}".`);
    sites = [origin];
  }
  if (opts.cursor && sites.length > 1) throw new Error('--cursor needs --site: each site has its own cursor.');

  const cql = toCql(query, opts.space);
  const rows: (ConfluenceSearchRow & { site: string })[] = [];
  const more: { site: string; cursor: string }[] = [];

  for (const site of sites) {
    const client = new ConfluenceClient(site, profile.config.userEmail, profile.apiToken);
    let cursor = opts.cursor;
    try {
      do {
        const page = await client.search(cql, { limit, cursor });
        rows.push(...page.rows.map((r) => ({ ...r, site: new URL(site).host })));
        cursor = page.nextCursor;
      } while (opts.all && cursor && rows.length < max);
    } catch (err) {
      if (sites.length === 1) throw err;
      // A site without Confluence answers with a whole HTML page; its first line says enough.
      console.error(`# ${new URL(site).host}: skipped (${(err as Error).message.split('\n')[0].trim()})`);
      continue;
    }
    if (cursor) more.push({ site: new URL(site).host, cursor });
  }
  const shown = opts.all ? rows.slice(0, max) : rows;

  if (format === 'json') {
    printJson({ cql, results: shown, more });
    return;
  }
  if (format === 'tsv') {
    const columns = sites.length > 1 ? ['site', ...TSV_COLUMNS] : [...TSV_COLUMNS];
    if (shown.length > 0) {
      console.log([columns.join('\t'), ...shown.map((r) => columns.map((c) => tsvCell(r[c as keyof typeof r])).join('\t'))].join('\n'));
    }
  } else if (shown.length === 0) {
    console.log('No matching pages.');
  } else {
    console.log(`${shown.length} result(s) for: ${cql}`);
    for (const r of shown) console.log(`  ${r.id}  [${r.space}] ${r.title}  (${r.lastModified})\n      ${r.url}`);
  }
  for (const m of more) console.error(`# more results on ${m.site}: --site ${m.site} --cursor ${m.cursor} or --all`);
}
