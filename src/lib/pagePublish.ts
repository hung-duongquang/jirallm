import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { ResolvedProfile } from './config.js';
import { ConfluenceClient, stretchTables } from './confluence.js';
import { parseConfluenceUrl } from './confluenceLinks.js';
import { JiraClient } from './jiraClient.js';
import { reportToWiki } from './qaReport.js';

/**
 * Publishes any markdown file as a Confluence page (feature context for testers, a design note, …).
 * The page id is kept in a sidecar next to the file, so later runs update the same page.
 */

export type PublishedRef = { site: string; pageId: string };

export type PagePublishPlan = {
  action: 'create' | 'update';
  site: string;
  title: string;
  space?: string;
  parentId?: string;
  pageId?: string;
  attachments: string[];
  link?: string;
};

export type PagePublishResult = PagePublishPlan & { url: string; version: number; pageId: string };

export const sidecarPath = (file: string) => path.join(path.dirname(file), `.${path.basename(file)}.confluence.json`);

/** Page title: the first `# ` heading, else the file name. Also returns the body without frontmatter and that heading. */
export function splitTitle(md: string, file: string): { title: string; body: string } {
  const text = md.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '');
  const m = /^#[ \t]+(.+?)[ \t]*\r?\n/m.exec(text);
  if (!m) return { title: path.basename(file, path.extname(file)), body: text.trim() };
  return { title: m[1]!, body: (text.slice(0, m.index) + text.slice(m.index + m[0].length)).trim() };
}

/**
 * Local images and files linked from the markdown become page attachments: their links are rewritten
 * to `attachments/<name>`, which the wiki conversion turns into `!name!` / `[^name]`.
 */
export function localAttachments(body: string, baseDir: string, exists: (p: string) => boolean = existsSync): { body: string; files: Map<string, string> } {
  const files = new Map<string, string>();
  const rewritten = body.replace(/(!?)\[([^\]]*)\]\(<?([^)\s>]+)>?\)/g, (all, bang: string, text: string, target: string) => {
    if (/^[a-z][a-z0-9+.-]*:|^#|^\//i.test(target)) return all;
    const full = path.resolve(baseDir, decodeURIComponent(target));
    if (!exists(full)) return all;
    let name = path.basename(full);
    // Two different files with one name would overwrite each other's attachment.
    for (let i = 2; files.has(name) && files.get(name) !== full; i++) name = `${path.basename(full, path.extname(full))}-${i}${path.extname(full)}`;
    files.set(name, full);
    return `${bang}[${text}](attachments/${name})`;
  });
  return { body: rewritten, files };
}

function allowedSites(profile: ResolvedProfile): string[] {
  return [profile.config.baseUrl, ...(profile.org.confluenceUrls ?? [])].map((u) => new URL(u).origin.toLowerCase());
}

/** A page id, or a page URL (whose site must be an allowed one). */
export function pageRef(value: string, profile: ResolvedProfile): { id: string; site?: string } {
  if (/^\d+$/.test(value)) return { id: value };
  const ref = parseConfluenceUrl(value);
  if (!ref || ref.kind !== 'page') throw new Error(`Not a Confluence page id or URL: ${value}`);
  if (!allowedSites(profile).includes(ref.origin)) throw new Error(`${ref.origin} is not the Jira site or a configured confluence_urls entry.`);
  return { id: ref.id, site: ref.origin };
}

export function defaultSite(profile: ResolvedProfile): string {
  return new URL(profile.org.confluenceUrls?.[0] ?? profile.config.baseUrl).origin.toLowerCase();
}

export async function pagePublish(
  profile: ResolvedProfile,
  file: string,
  opts: { space?: string; parent?: string; page?: string; title?: string; site?: string; link?: string; dryRun?: boolean },
): Promise<PagePublishPlan | PagePublishResult> {
  const md = readFileSync(file, 'utf8');
  const split = splitTitle(md, file);
  const title = opts.title ?? split.title;
  const { body, files } = localAttachments(split.body, path.dirname(path.resolve(file)));

  const sidecar = sidecarPath(file);
  const known = existsSync(sidecar) ? (JSON.parse(readFileSync(sidecar, 'utf8')) as PublishedRef) : undefined;
  const parent = opts.parent ? pageRef(opts.parent, profile) : undefined;
  const target = opts.page ? pageRef(opts.page, profile) : undefined;
  const site = (target?.site ?? (target ? undefined : known?.site) ?? parent?.site ?? (opts.site ? new URL(opts.site.includes('://') ? opts.site : `https://${opts.site}`).origin : defaultSite(profile))).toLowerCase();
  // The API token goes to this host.
  if (!allowedSites(profile).includes(site)) throw new Error(`${site} is not the Jira site or a configured confluence_urls entry.`);

  const client = new ConfluenceClient(site, profile.config.userEmail, profile.apiToken);
  const pageId = target?.id ?? known?.pageId;
  if (!pageId) {
    if (!opts.space) throw new Error('The first publish needs --space (e.g. ZOD), or --page <id|url> to update an existing page.');
    const existing = await client.findPageByTitle(opts.space, title);
    if (existing) {
      throw new Error(`Space ${opts.space} already has a page titled "${title}" (id ${existing.id}). Pass --page ${existing.id} to update it, or --title to publish under another title.`);
    }
  }

  const plan: PagePublishPlan = {
    action: pageId ? 'update' : 'create', site, title,
    space: pageId ? undefined : opts.space, parentId: pageId ? undefined : parent?.id, pageId,
    attachments: [...files.keys()], link: opts.link,
  };
  if (opts.dryRun) return plan;

  const storage = stretchTables(await client.wikiToStorage(reportToWiki(body)));
  const saved = await client.savePage({ pageId, spaceKey: opts.space ?? '', parentId: parent?.id, title, storage });
  await client.setFullWidth(saved.id);
  for (const [name, full] of files) await client.uploadAttachment(saved.id, name, readFileSync(full));
  writeFileSync(sidecar, `${JSON.stringify({ site, pageId: saved.id } satisfies PublishedRef, null, 2)}\n`);
  if (opts.link) await new JiraClient(profile.config, profile.apiToken).addRemoteLink(opts.link, saved.url, title);
  return { ...plan, url: saved.url, version: saved.version, pageId: saved.id };
}
