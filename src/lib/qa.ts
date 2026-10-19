import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { ResolvedProfile } from './config.js';
import { ConfluenceClient } from './confluence.js';
import { JiraClient } from './jiraClient.js';
import {
  countCases, evidenceCell, newReport, parseAcceptanceScenarios, parseReport, renderReport, reportToWiki,
  type QaReport, type Verdict,
} from './qaReport.js';

/**
 * The tester workflow shared by `jirallm qa …` and the web UI. The report lives next to the
 * exported ticket: <outputDir>/<key>/test-report.md, evidence in <outputDir>/<key>/test-report/.
 */
export function qaPaths(outputDir: string, issueKey: string) {
  if (!/^[A-Z][A-Z0-9]+-\d+$/i.test(issueKey)) throw new Error(`Not an issue key: ${issueKey}`);
  const dir = path.join(outputDir, issueKey.toLowerCase());
  return {
    dir,
    taskMd: path.join(dir, 'task.md'),
    report: path.join(dir, 'test-report.md'),
    evidence: path.join(dir, 'test-report'),
  };
}

const PAGE_META = /^<!-- confluence-page: (\S+) (\d+) -->\r?\n/;

export type PublishedPage = { site: string; pageId: string };

export type LoadedReport = { report: QaReport; page?: PublishedPage; evidenceFiles: string[] };

export function loadReport(outputDir: string, issueKey: string): LoadedReport | undefined {
  const paths = qaPaths(outputDir, issueKey);
  if (!existsSync(paths.report)) return undefined;
  const raw = readFileSync(paths.report, 'utf8');
  const meta = PAGE_META.exec(raw);
  return {
    report: parseReport(raw.replace(PAGE_META, '')),
    page: meta ? { site: meta[1], pageId: meta[2] } : undefined,
    evidenceFiles: existsSync(paths.evidence) ? readdirSync(paths.evidence) : [],
  };
}

export function saveReport(outputDir: string, issueKey: string, report: QaReport, page?: PublishedPage): string {
  const paths = qaPaths(outputDir, issueKey);
  mkdirSync(paths.evidence, { recursive: true });
  const meta = page ? `<!-- confluence-page: ${page.site} ${page.pageId} -->\n` : '';
  writeFileSync(paths.report, meta + renderReport(report));
  return paths.report;
}

export async function qaInit(
  profile: ResolvedProfile,
  issueKey: string,
  opts: { outputDir: string; env?: string; force?: boolean }
): Promise<{ path: string; caseCount: number }> {
  const paths = qaPaths(opts.outputDir, issueKey);
  if (existsSync(paths.report) && !opts.force) throw new Error(`${paths.report} exists; start over with force.`);
  if (!existsSync(paths.taskMd)) throw new Error(`${issueKey} is not exported yet (no ${paths.taskMd}).`);
  const scenarios = parseAcceptanceScenarios(readFileSync(paths.taskMd, 'utf8'));
  const issue = await new JiraClient(profile.config, profile.apiToken).fetchIssueRaw(issueKey, []);
  const title = String((issue.fields as { summary?: unknown } | undefined)?.summary ?? issueKey);
  const report = newReport(
    { issueKey, issueUrl: `${profile.config.baseUrl}/browse/${issueKey}`, title, env: opts.env },
    scenarios.length > 0 ? scenarios : [{ title: '', given: '', when: '', then: '' }]
  );
  return { path: saveReport(opts.outputDir, issueKey, report), caseCount: scenarios.length };
}

/** Evidence names are prefixed with the key and case, like the testers' own uploads. */
export function evidenceName(issueKey: string, caseId: string, file: string): string {
  const base = path.basename(file).replace(/[^\w.-]+/g, '_');
  return `${issueKey}_${caseId}_${base}`;
}

export function qaRecordResult(
  outputDir: string,
  issueKey: string,
  caseId: string,
  verdict: Verdict,
  opts: { note?: string; files?: Array<{ name: string; data: Buffer }> } = {}
): { counts: ReturnType<typeof countCases>; evidence: string[] } {
  if (!['pass', 'fail', 'blocked'].includes(verdict)) throw new Error('Verdict must be pass, fail or blocked.');
  const loaded = loadReport(outputDir, issueKey);
  if (!loaded) throw new Error(`No test report for ${issueKey} yet.`);
  const target = loaded.report.cases.find((c) => c.id === caseId);
  if (!target) throw new Error(`${caseId} is not in the report.`);

  const paths = qaPaths(outputDir, issueKey);
  mkdirSync(paths.evidence, { recursive: true });
  const evidence = (opts.files ?? []).map((f) => {
    const name = evidenceName(issueKey, caseId, f.name);
    writeFileSync(path.join(paths.evidence, name), f.data);
    return name;
  });
  target.evidence = evidenceCell(verdict, { note: opts.note, evidence });
  saveReport(outputDir, issueKey, loaded.report, loaded.page);
  return { counts: countCases(loaded.report.cases), evidence };
}

export type PublishPlan = {
  action: 'create' | 'update';
  site: string;
  title: string;
  space?: string;
  pageId?: string;
  counts: ReturnType<typeof countCases>;
  evidenceFiles: string[];
  link: boolean;
};

export type PublishResult = PublishPlan & { url: string; version: number; pageId: string };

function allowedSites(profile: ResolvedProfile): string[] {
  return [profile.config.baseUrl, ...(profile.org.confluenceUrls ?? [])].map((u) => new URL(u).origin);
}

export async function qaPublish(
  profile: ResolvedProfile,
  issueKey: string,
  opts: { outputDir: string; space?: string; parent?: string; site?: string; link?: boolean; dryRun?: boolean }
): Promise<PublishPlan | PublishResult> {
  const loaded = loadReport(opts.outputDir, issueKey);
  if (!loaded) throw new Error(`No test report for ${issueKey} yet.`);
  const site = new URL(loaded.page?.site ?? opts.site ?? profile.org.confluenceUrls?.[0] ?? profile.config.baseUrl).origin;
  // The API token goes to this host.
  if (!allowedSites(profile).includes(site)) throw new Error(`${site} is not the Jira site or a configured confluence_urls entry.`);
  if (!loaded.page && !opts.space) throw new Error('The first publish needs a Confluence space (e.g. ZOD).');

  const plan: PublishPlan = {
    action: loaded.page ? 'update' : 'create',
    site,
    title: loaded.report.title || issueKey,
    space: loaded.page ? undefined : opts.space,
    pageId: loaded.page?.pageId,
    counts: countCases(loaded.report.cases),
    evidenceFiles: loaded.evidenceFiles,
    link: opts.link !== false,
  };
  if (opts.dryRun) return plan;

  const client = new ConfluenceClient(site, profile.config.userEmail, profile.apiToken);
  const body = renderReport(loaded.report).replace(/^# .+\n+/, '');
  const storage = await client.wikiToStorage(reportToWiki(body));
  // Images refer to attachments by filename and resolve on render, so uploading after the save is fine.
  const saved = await client.savePage({
    pageId: loaded.page?.pageId, spaceKey: opts.space ?? '', parentId: opts.parent, title: plan.title, storage,
  }).catch((err: Error) => {
    // Titles are unique per space, and a hand-made report often carries the ticket's title.
    if (/same TITLE|title already exists/i.test(err.message)) {
      throw new Error(`Space ${opts.space} already has a page titled "${plan.title}". Change the report title (its first line) and publish again; an existing page is never overwritten.`);
    }
    throw err;
  });
  const paths = qaPaths(opts.outputDir, issueKey);
  for (const file of loaded.evidenceFiles) {
    await client.uploadAttachment(saved.id, file, readFileSync(path.join(paths.evidence, file)));
  }
  saveReport(opts.outputDir, issueKey, loaded.report, { site, pageId: saved.id });
  if (plan.link) {
    await new JiraClient(profile.config, profile.apiToken).addRemoteLink(issueKey, saved.url, `Test report: ${plan.title}`);
  }
  return { ...plan, url: saved.url, version: saved.version, pageId: saved.id };
}
