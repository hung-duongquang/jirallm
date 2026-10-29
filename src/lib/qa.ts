import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { ResolvedProfile } from './config.js';
import { ConfluenceClient, stretchTables } from './confluence.js';
import { JiraClient } from './jiraClient.js';
import { playwrightResults, type PlaywrightReport, type PlaywrightResult } from './qaPlaywright.js';
import {
  countCases, evidenceBelowTable, evidenceCell, fromCell, newReport, NOT_RUN, parseAcceptanceScenarios, parseReport, renderReport, reportToWiki, TEMPLATES, toCell,
  type QaCase, type QaReport, type Template, type Verdict,
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
  opts: { outputDir: string; env?: string; api?: string; template?: string; force?: boolean }
): Promise<{ path: string; caseCount: number }> {
  const template = (opts.template || 'default') as Template;
  if (!TEMPLATES.includes(template)) throw new Error(`Unknown template "${opts.template}"; use one of ${TEMPLATES.join(', ')}.`);
  const paths = qaPaths(opts.outputDir, issueKey);
  if (existsSync(paths.report) && !opts.force) throw new Error(`${paths.report} exists; start over with force.`);
  if (!existsSync(paths.taskMd)) throw new Error(`${issueKey} is not exported yet (no ${paths.taskMd}).`);
  const scenarios = parseAcceptanceScenarios(readFileSync(paths.taskMd, 'utf8'));
  const issue = await new JiraClient(profile.config, profile.apiToken).fetchIssueRaw(issueKey, []);
  const title = String((issue.fields as { summary?: unknown } | undefined)?.summary ?? issueKey);
  const report = newReport(
    { issueKey, issueUrl: `${profile.config.baseUrl}/browse/${issueKey}`, title, env: opts.env, api: opts.api },
    scenarios.length > 0 ? scenarios : [{ title: '', given: '', when: '', then: '' }],
    template
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

export type ImportSummary = { created: string[]; updated: string[]; counts: ReturnType<typeof countCases>; evidence: number };

/** A case is named by its id (TC-03) or by the scenario label its title starts with (GP-5 in "GP-5. Claims …"). */
function matchesRef(c: QaCase, ref: string): boolean {
  const label = ref.toLowerCase();
  const title = fromCell(c.title).toLowerCase();
  return c.id.toLowerCase() === label || title === label || ['.', ' ', ':'].some((sep) => title.startsWith(label + sep));
}

const isPlaceholder = (c: QaCase) => !c.title && !c.steps && !c.expected && c.evidence === NOT_RUN;

/**
 * Records a Playwright run in the report: each test becomes a case (matched on its title, so a re-run
 * updates the same case), with its steps, verdict and screenshots. Cases written by hand are kept.
 */
export function qaImportPlaywright(
  outputDir: string,
  issueKey: string,
  playwrightJson: string,
  opts: { grep?: string; layer?: string; reportDir?: string } = {}
): ImportSummary {
  const loaded = loadReport(outputDir, issueKey);
  if (!loaded) throw new Error(`No test report for ${issueKey} yet; run qa init first.`);
  const results = playwrightResults(JSON.parse(readFileSync(playwrightJson, 'utf8')) as PlaywrightReport,
    opts.grep ? new RegExp(opts.grep, 'i') : undefined);
  if (results.length === 0) throw new Error(`No tests${opts.grep ? ` matching /${opts.grep}/` : ''} in ${playwrightJson}.`);

  const report = loaded.report;
  report.cases = report.cases.filter((c) => !isPlaceholder(c));
  const paths = qaPaths(outputDir, issueKey);
  mkdirSync(paths.evidence, { recursive: true });
  // Attachment paths are absolute, or relative to the directory Playwright ran in.
  const base = opts.reportDir ?? path.dirname(path.resolve(playwrightJson));
  const summary: ImportSummary = { created: [], updated: [], counts: countCases(report.cases), evidence: 0 };
  let next = report.cases.reduce((max, c) => Math.max(max, Number(/\d+$/.exec(c.id)?.[0] ?? 0)), 0);

  /** Sets the verdict, evidence and automation columns of one case; returns the number of files copied. */
  const record = (target: QaCase, r: PlaywrightResult): number => {
    target.automation = opts.layer ?? (target.automation || 'Playwright');
    target.coverage = toCell(r.location);
    // A re-run replaces this case's earlier evidence.
    const prefix = evidenceName(issueKey, target.id, '');
    for (const old of readdirSync(paths.evidence)) if (old.startsWith(prefix)) rmSync(path.join(paths.evidence, old));
    const names = r.images.map((img, i) => {
      const source = path.resolve(base, img.path);
      const name = evidenceName(issueKey, target.id, `${r.images.length > 1 ? `${i + 1}-` : ''}${img.name}${path.extname(source)}`);
      copyFileSync(source, path.join(paths.evidence, name));
      return name;
    });
    const note = r.caseRefs.length > 0 ? [r.note, `e2e: ${r.title}`].filter(Boolean).join(' – ') : r.note;
    target.evidence = evidenceCell(r.verdict, { note, evidence: names });
    return names.length;
  };

  for (const r of results) {
    // A test that names its cases (qa-case annotation) reports on them and keeps their written steps.
    if (r.caseRefs.length > 0) {
      for (const ref of r.caseRefs) {
        const target = report.cases.find((c) => matchesRef(c, ref));
        if (!target) throw new Error(`"${r.title}" covers ${ref}, which is not a case in the report.`);
        if (!target.steps && r.steps.length > 0) target.steps = toCell(r.steps.map((s, i) => `${i + 1}. ${s}`).join('\n'));
        summary.updated.push(target.id);
        summary.evidence += record(target, r);
      }
      continue;
    }
    let target = report.cases.find((c) => fromCell(c.title) === r.title);
    if (!target) {
      target = {
        id: `TC-${String(++next).padStart(2, '0')}`, title: toCell(r.title), precondition: toCell(r.describe.join(' › ')),
        steps: '', expected: toCell(r.annotations.join('\n')), priority: '', type: 'Functional', automation: '', coverage: '', evidence: NOT_RUN,
      };
      report.cases.push(target);
      summary.created.push(target.id);
    } else {
      summary.updated.push(target.id);
    }
    if (r.steps.length > 0) target.steps = toCell(r.steps.map((s, i) => `${i + 1}. ${s}`).join('\n'));
    summary.evidence += record(target, r);
  }
  saveReport(outputDir, issueKey, report, loaded.page);
  summary.counts = countCases(report.cases);
  return summary;
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

/** Width and height from a PNG's header; undefined for other files. */
export function pngSize(file: string): { width: number; height: number } | undefined {
  if (!/\.png$/i.test(file) || !existsSync(file)) return undefined;
  const head = readFileSync(file).subarray(0, 24);
  if (head.length < 24 || head.toString('latin1', 12, 16) !== 'IHDR') return undefined;
  return { width: head.readUInt32BE(16), height: head.readUInt32BE(20) };
}

export type PublishResult =PublishPlan & { url: string; version: number; pageId: string };

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
  const paths = qaPaths(opts.outputDir, issueKey);
  const tall = (file: string) => {
    const size = pngSize(path.join(paths.evidence, file));
    return !!size && size.height > size.width;
  };
  const body = renderReport(evidenceBelowTable(loaded.report, tall)).replace(/^# .+\n+/, '');
  const storage = stretchTables(await client.wikiToStorage(reportToWiki(body)));
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
  await client.setFullWidth(saved.id);
  for (const file of loaded.evidenceFiles) {
    await client.uploadAttachment(saved.id, file, readFileSync(path.join(paths.evidence, file)));
  }
  saveReport(opts.outputDir, issueKey, loaded.report, { site, pageId: saved.id });
  if (plan.link) {
    await new JiraClient(profile.config, profile.apiToken).addRemoteLink(issueKey, saved.url, `Test report: ${plan.title}`);
  }
  return { ...plan, url: saved.url, version: saved.version, pageId: saved.id };
}
