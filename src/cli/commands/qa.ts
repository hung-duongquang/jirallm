import { readFileSync } from 'node:fs';
import path from 'node:path';
import { loadProfile } from '../../lib/config.js';
import { qaInit, qaPublish, qaRecordResult, type PublishResult } from '../../lib/qa.js';
import type { Verdict } from '../../lib/qaReport.js';
import { parseIssueKey } from '../issueKey.js';
import { resolveOrg } from '../resolveOrg.js';

async function profileFor(issueKeyArg: string, org?: string) {
  const parsed = parseIssueKey(issueKeyArg);
  const resolved = resolveOrg(parsed.org, org, parsed.projectKey);
  return { key: parsed.key, profile: await loadProfile({ org: resolved, project: parsed.projectKey }) };
}

export type QaInitOptions = { org?: string; outputDir?: string; env?: string; force?: boolean };

export async function runQaInit(issueKeyArg: string, opts: QaInitOptions): Promise<void> {
  const { key, profile } = await profileFor(issueKeyArg, opts.org);
  const { path: file, caseCount } = await qaInit(profile, key, { outputDir: opts.outputDir ?? './jira-export', env: opts.env, force: opts.force });
  console.log(`✓ ${file}: ${caseCount} test case(s) from the acceptance criteria. Fill in steps, then record results with \`jirallm qa result\`.`);
}

export type QaResultOptions = { outputDir?: string; note?: string; evidence?: string[] };

export function runQaResult(issueKey: string, caseId: string, verdict: string, opts: QaResultOptions): void {
  const key = parseIssueKey(issueKey).key;
  const files = (opts.evidence ?? []).map((f) => ({ name: path.basename(f), data: readFileSync(f) }));
  const { counts } = qaRecordResult(opts.outputDir ?? './jira-export', key, caseId, verdict as Verdict, { note: opts.note, files });
  console.log(`✓ ${caseId} ${verdict}. Results: ${counts.passed}/${counts.total} passed, ${counts.failed} failed.`);
}

export type QaPublishOptions = {
  org?: string; outputDir?: string; space?: string; parent?: string; site?: string; dryRun?: boolean; link?: boolean;
};

export async function runQaPublish(issueKeyArg: string, opts: QaPublishOptions): Promise<void> {
  const { key, profile } = await profileFor(issueKeyArg, opts.org);
  const result = await qaPublish(profile, key, { ...opts, outputDir: opts.outputDir ?? './jira-export' });
  const { counts } = result;
  const summary = `${counts.passed}/${counts.total} passed, ${counts.failed} failed, ${result.evidenceFiles.length} file(s)`;
  if (opts.dryRun) {
    const target = result.action === 'update' ? `update page ${result.pageId}` : `create "${result.title}" in space ${result.space}`;
    console.log(`Dry run — would ${target} on ${result.site}: ${summary}${result.link ? `, link from ${key}` : ''}`);
    return;
  }
  const done = result as PublishResult;
  console.log(`✓ ${done.url} (v${done.version}, ${summary})`);
}
