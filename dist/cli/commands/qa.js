import { readFileSync } from 'node:fs';
import path from 'node:path';
import { loadProfile } from '../../lib/config.js';
import { qaImportPlaywright, qaInit, qaPublish, qaRecordResult } from '../../lib/qa.js';
import { parseIssueKey } from '../issueKey.js';
import { resolveOrg } from '../resolveOrg.js';
async function profileFor(issueKeyArg, org) {
    const parsed = parseIssueKey(issueKeyArg);
    const resolved = resolveOrg(parsed.org, org, parsed.projectKey);
    return { key: parsed.key, profile: await loadProfile({ org: resolved, project: parsed.projectKey }) };
}
export async function runQaInit(issueKeyArg, opts) {
    const { key, profile } = await profileFor(issueKeyArg, opts.org);
    const { path: file, caseCount } = await qaInit(profile, key, {
        outputDir: opts.outputDir ?? './jira-export', env: opts.env, api: opts.api, template: opts.template, force: opts.force,
    });
    console.log(caseCount > 0
        ? `✓ ${file}: ${caseCount} test case(s) from the acceptance criteria. Fill in steps, then record results with \`jirallm qa result\`.`
        : `✓ ${file}: no Scenario/Given/When/Then table in the acceptance criteria. Add cases by hand, or run the e2e tests and \`jirallm qa import\` their JSON report.`);
}
export function runQaResult(issueKey, caseId, verdict, opts) {
    const key = parseIssueKey(issueKey).key;
    const files = (opts.evidence ?? []).map((f) => ({ name: path.basename(f), data: readFileSync(f) }));
    const { counts } = qaRecordResult(opts.outputDir ?? './jira-export', key, caseId, verdict, { note: opts.note, files });
    console.log(`✓ ${caseId} ${verdict}. Results: ${counts.passed}/${counts.total} passed, ${counts.failed} failed.`);
}
export function runQaImport(issueKey, json, opts) {
    const key = parseIssueKey(issueKey).key;
    const r = qaImportPlaywright(opts.outputDir ?? './jira-export', key, json, opts);
    const { passed, failed, blocked, total } = r.counts;
    console.log(`✓ ${r.created.length} new, ${r.updated.length} updated case(s), ${r.evidence} screenshot(s). Results: ${passed}/${total} passed, ${failed} failed, ${blocked} blocked.`);
}
export async function runQaPublish(issueKeyArg, opts) {
    const { key, profile } = await profileFor(issueKeyArg, opts.org);
    const result = await qaPublish(profile, key, { ...opts, outputDir: opts.outputDir ?? './jira-export' });
    const { counts } = result;
    const summary = `${counts.passed}/${counts.total} passed, ${counts.failed} failed, ${result.evidenceFiles.length} file(s)`;
    if (opts.dryRun) {
        const target = result.action === 'update' ? `update page ${result.pageId}` : `create "${result.title}" in space ${result.space}`;
        console.log(`Dry run — would ${target} on ${result.site}: ${summary}${result.link ? `, link from ${key}` : ''}`);
        return;
    }
    const done = result;
    console.log(`✓ ${done.url} (v${done.version}, ${summary})`);
}
//# sourceMappingURL=qa.js.map