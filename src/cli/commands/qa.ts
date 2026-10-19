import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { loadProfile } from '../../lib/config.js';
import { ConfluenceClient } from '../../lib/confluence.js';
import { JiraClient } from '../../lib/jiraClient.js';
import {
  buildReport, countResults, parseAcceptanceScenarios, reportToWiki, setResult, type Verdict,
} from '../../lib/qaReport.js';
import { parseIssueKey } from '../issueKey.js';
import { resolveOrg } from '../resolveOrg.js';

/** Report and evidence live next to the exported ticket: <output-dir>/<key>/test-report.md + test-report/ */
function reportPaths(outputDir: string, issueKey: string) {
  const dir = path.join(outputDir, issueKey.toLowerCase());
  return { dir, report: path.join(dir, 'test-report.md'), evidence: path.join(dir, 'test-report') };
}

const PAGE_META = /^<!-- confluence-page: (\S+) (\d+) -->\n/;

async function profileFor(issueKeyArg: string, org?: string) {
  const parsed = parseIssueKey(issueKeyArg);
  const resolved = resolveOrg(parsed.org, org, parsed.projectKey);
  return { key: parsed.key, profile: await loadProfile({ org: resolved, project: parsed.projectKey }) };
}

export type QaInitOptions = { org?: string; outputDir?: string; env?: string; force?: boolean };

export async function runQaInit(issueKeyArg: string, opts: QaInitOptions): Promise<void> {
  const { key, profile } = await profileFor(issueKeyArg, opts.org);
  const paths = reportPaths(opts.outputDir ?? './jira-export', key);
  if (existsSync(paths.report) && !opts.force) throw new Error(`${paths.report} exists; pass --force to start over.`);

  const taskMd = path.join(paths.dir, 'task.md');
  if (!existsSync(taskMd)) throw new Error(`No export at ${taskMd}; run \`jirallm ${key}\` first.`);
  const scenarios = parseAcceptanceScenarios(readFileSync(taskMd, 'utf8'));
  const issue = await new JiraClient(profile.config, profile.apiToken).fetchIssueRaw(key, []);
  const title = String((issue.fields as { summary?: unknown } | undefined)?.summary ?? key);

  mkdirSync(paths.evidence, { recursive: true });
  writeFileSync(paths.report, buildReport(
    { issueKey: key, issueUrl: `${profile.config.baseUrl}/browse/${key}`, title, env: opts.env },
    scenarios.length > 0 ? scenarios : [{ title: '', given: '', when: '', then: '' }]
  ));
  console.log(`✓ ${paths.report}: ${scenarios.length} test case(s) from the acceptance criteria. Fill in steps, then record results with \`jirallm qa result\`.`);
}

export type QaResultOptions = { outputDir?: string; note?: string; evidence?: string[] };

export function runQaResult(issueKey: string, caseId: string, verdict: string, opts: QaResultOptions): void {
  if (!['pass', 'fail', 'blocked'].includes(verdict)) throw new Error('Verdict must be pass, fail or blocked.');
  const key = parseIssueKey(issueKey).key;
  const paths = reportPaths(opts.outputDir ?? './jira-export', key);
  if (!existsSync(paths.report)) throw new Error(`No report at ${paths.report}; run \`jirallm qa init ${key}\` first.`);

  mkdirSync(paths.evidence, { recursive: true });
  const names = (opts.evidence ?? []).map((file) => {
    const name = `${key}_${caseId}_${path.basename(file)}`;
    copyFileSync(file, path.join(paths.evidence, name));
    return name;
  });
  const updated = setResult(readFileSync(paths.report, 'utf8'), caseId, verdict as Verdict, { note: opts.note, evidence: names });
  writeFileSync(paths.report, updated);
  const { passed, failed, total } = countResults(updated);
  console.log(`✓ ${caseId} ${verdict}. Results: ${passed}/${total} passed, ${failed} failed.`);
}

export type QaPublishOptions = {
  org?: string; outputDir?: string; space?: string; parent?: string; site?: string; dryRun?: boolean; link?: boolean;
};

export async function runQaPublish(issueKeyArg: string, opts: QaPublishOptions): Promise<void> {
  const { key, profile } = await profileFor(issueKeyArg, opts.org);
  const paths = reportPaths(opts.outputDir ?? './jira-export', key);
  if (!existsSync(paths.report)) throw new Error(`No report at ${paths.report}.`);
  const raw = readFileSync(paths.report, 'utf8');
  const meta = PAGE_META.exec(raw);
  const report = raw.replace(PAGE_META, '');
  const title = /^# (.+)$/m.exec(report)?.[1]?.trim() ?? key;
  const body = report.replace(/^# .+\n+/, '');

  const site = opts.site ?? profile.org.confluenceUrls?.[0] ?? profile.config.baseUrl;
  const allowed = [profile.config.baseUrl, ...(profile.org.confluenceUrls ?? [])].map((u) => new URL(u).origin);
  if (!allowed.includes(new URL(site).origin)) throw new Error(`${site} is not a configured site.`);
  if (!meta && !opts.space) throw new Error('First publish needs --space (and optionally --parent <pageId>).');

  const files = existsSync(paths.evidence) ? readdirSync(paths.evidence) : [];
  const { passed, failed, total } = countResults(report);
  if (opts.dryRun) {
    console.log(`Dry run — would ${meta ? `update page ${meta[2]}` : `create "${title}" in space ${opts.space}`} on ${site}`);
    console.log(`  results ${passed}/${total} (${failed} failed), ${files.length} evidence file(s)`);
    if (opts.link !== false) console.log(`  link the page from ${key}`);
    return;
  }

  const client = new ConfluenceClient(new URL(site).origin, profile.config.userEmail, profile.apiToken);
  const storage = await client.wikiToStorage(reportToWiki(body));
  // Images refer to attachments by filename and resolve on render, so uploading after the save is fine.
  const saved = await client.savePage({ pageId: meta?.[2], spaceKey: opts.space ?? '', parentId: opts.parent, title, storage });
  for (const file of files) await client.uploadAttachment(saved.id, file, readFileSync(path.join(paths.evidence, file)));

  writeFileSync(paths.report, `<!-- confluence-page: ${new URL(site).origin} ${saved.id} -->\n${report}`);
  if (opts.link !== false) {
    await new JiraClient(profile.config, profile.apiToken).addRemoteLink(key, saved.url, `Test report: ${title}`);
  }
  console.log(`✓ ${saved.url} (v${saved.version}, ${passed}/${total} passed, ${failed} failed, ${files.length} file(s))`);
}
