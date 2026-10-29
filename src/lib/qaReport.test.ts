import { describe, expect, it } from 'vitest';
import {
  buildReport, countResults, evidenceBelowTable, evidenceCell, parseAcceptanceScenarios, parseReport, renderReport, reportToWiki, setResult, splitRow,
} from './qaReport.js';

const TASK_MD = `# Ticket

## Acceptance criteria

| Scenario | Given | When | Then |
| --- | --- | --- | --- |
| Save fixed debtor number | No configuration | PUT with PAT01 | GET returns PAT01 |
| Special character rejected | No configuration | PUT with PAT-01 | 400 \\| nothing stored |

| Other | table |
| --- | --- |
| not | a scenario |
`;

const header = { issueKey: 'ZOD-1', issueUrl: 'https://x/browse/ZOD-1', title: 'BE - Fixed debtor number', env: 'feature8' };

describe('qa report', () => {
  it('splits rows on unescaped pipes only', () => {
    expect(splitRow('| a | b \\| c | d |')).toEqual(['a', 'b \\| c', 'd']);
  });

  it('turns each acceptance scenario into a test case', () => {
    const scenarios = parseAcceptanceScenarios(TASK_MD);
    expect(scenarios.map((s) => s.title)).toEqual(['Save fixed debtor number', 'Special character rejected']);
    const report = buildReport(header, scenarios);
    expect(report).toContain('| TC-01 | Save fixed debtor number | No configuration | PUT with PAT01 | GET returns PAT01 |');
    expect(report).toContain('| **Results** | 0/2 |');
  });

  it('records verdicts with evidence and keeps the Results line in step', () => {
    let report = buildReport(header, parseAcceptanceScenarios(TASK_MD));
    report = setResult(report, 'TC-01', 'pass', { evidence: ['ZOD-1_TC-01_get.png'], note: 'Playwright run' });
    report = setResult(report, 'TC-02', 'fail', { note: 'got 200 | stored' });
    expect(report).toContain('![ZOD-1_TC-01_get.png](attachments/ZOD-1_TC-01_get.png)<br/>**PASSED** – Playwright run |');
    expect(report).toContain('**FAILED** – got 200 \\| stored |');
    expect(countResults(report)).toEqual({ passed: 1, failed: 1, total: 2 });
    expect(report).toContain('| **Results** | 1/2 (1 failed) |\n\n## Precondition');
    expect(() => setResult(report, 'TC-99', 'pass')).toThrow('TC-99');
  });

  it('round-trips a tester-written report, keeping extra header rows and recomputing Results', () => {
    const md = [
      '# BE - Data maintenance', '', '| **Jira** |  |', '| --- | --- |',
      '| **Env** | [feature8](https://feature8.example) |', '| **API** | /api/v1/paramedical/simulate |',
      '| **Results** | 45/45 |', '', '## Precondition', '', '- Create creditor contract', '- RHO 53538585', '',
      '| ID | Title | Precondition | Steps | Expected Result | Priority | Type | Automation Layer | Dev test coverage | **Evidence** |',
      '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
      '| TC-01 | Valid intake | Base data | 1. POST<br/>2. Open | - 200 OK | High | Functional | API | Yes | ![image](attachments/a.png)<br/>PASSED |',
      '| TC-02 | Invalid | Base data | 1. POST | - 400 | High | Negative | API | No | **FAILED** – got 200 |',
    ].join('\n');
    const report = parseReport(md);
    expect(report.header.map((h) => h.label)).toEqual(['Env', 'API']);
    expect(report.precondition).toBe('- Create creditor contract\n- RHO 53538585');
    expect(report.cases[0].steps).toBe('1. POST<br/>2. Open');
    const again = renderReport(report);
    expect(again).toContain('| **API** | /api/v1/paramedical/simulate |');
    expect(again).toContain('| **Results** | 1/2 (1 failed) |');
    expect(parseReport(again)).toEqual(report);
  });

  it('api template: base message section, API header row and a Test Data column that survive edits', () => {
    let md = buildReport({ ...header, api: '/api/v1/paramedical/simulate' }, parseAcceptanceScenarios(TASK_MD), 'api');
    expect(md).toContain('| **API** | /api/v1/paramedical/simulate |');
    expect(md).toContain('## Base message');
    expect(md).toContain('| ID | Title | Precondition | Test Data | Steps |');
    expect(md).toContain('| TC-01 | Save fixed debtor number | No configuration |  | PUT with PAT01 |');

    const report = parseReport(md);
    report.cases[0].extra = { 'Test Data': 'clientId VL-TC01' };
    md = setResult(renderReport(report), 'TC-01', 'pass', { note: 'ok' });
    const again = parseReport(md);
    expect(again.cases[0].extra).toEqual({ 'Test Data': 'clientId VL-TC01' });
    expect(again.cases[0].evidence).toBe('**PASSED** – ok');
    expect(again.precondition).toBe('- …');
    expect(again.sections).toMatch(/^## Base message[\s\S]*```json[\s\S]*## Read the result/);
    expect(parseReport(renderReport(again))).toEqual(again);
  });

  it('matrix template: situation × action rows with side effects and an Also-check list', () => {
    const md = buildReport(header, parseAcceptanceScenarios(TASK_MD), 'matrix');
    expect(md).toContain('| ID | Title | Situation | Action | Expected Result | Side effects | Priority | **Evidence** |');
    expect(md).toContain('| TC-02 | Special character rejected | No configuration | PUT with PAT-01 | 400 \\| nothing stored |  |  | NOT RUN |');
    expect(md).toContain('## Dimensions');
    expect(md.trimEnd().endsWith('## Also check\n\n- …')).toBe(true);
    const report = parseReport(setResult(md, 'TC-02', 'fail'));
    expect(report.cases[1]).toMatchObject({ precondition: 'No configuration', steps: 'PUT with PAT-01', evidence: '**FAILED**' });
    expect(countResults(renderReport(report))).toEqual({ passed: 0, failed: 1, total: 2 });
  });

  it('keeps a tester-written decision matrix with its own column names', () => {
    const md = [
      '# Return info', '', '| **Jira** |  |', '| --- | --- |', '| **Env** | feature4 |', '', '## Precondition', '', '- RHO 53538585', '',
      '| ID | Insurer result | RHO action | Subcontractor | Priority | **Test** |', '| --- | --- | --- | --- | --- | --- |',
      '| R1 | Full approval | None | Approved €12,5 | P1 | :check_mark: |',
    ].join('\n');
    const report = parseReport(md);
    expect(report.cases[0]).toMatchObject({ id: 'R1', priority: 'P1' });
    expect(report.cases[0].extra).toMatchObject({ 'Insurer result': 'Full approval', Test: ':check_mark:' });
    expect(renderReport(report)).toContain('| R1 | Full approval | None | Approved €12,5 | P1 | :check_mark: |');
  });

  it('renders Confluence-ready wiki: cell line breaks and attachment images', () => {
    const report = setResult(buildReport(header, parseAcceptanceScenarios(TASK_MD)), 'TC-01', 'pass', {
      evidence: ['shot.png', 'resp.json'],
    });
    const wiki = reportToWiki(report);
    expect(wiki).toContain('!shot.png! \\\\ [^resp.json] \\\\ *PASSED*');
    expect(wiki).not.toContain('<br');
    const row = wiki.split('\n').find((l) => l.startsWith('|TC-01'))!;
    expect(row).not.toMatch(/(?<!\\)\|\|/); // empty cells stay data cells
  });

  it('escapes literal braces, which wiki would read as macros', () => {
    const wiki = reportToWiki('| ID | Expected |\n| --- | --- |\n| TC-01 | PUT series/{id} and `GET /{x}` |');
    expect(wiki).toContain('PUT series/\\{id\\}');
    expect(wiki).toContain('{{GET /\\{x\\}}}');
  });
});

describe('evidenceBelowTable', () => {
  it('moves the picked images under an Evidence heading per case and leaves the others in the cell', () => {
    const report = parseReport(buildReport(header, parseAcceptanceScenarios(TASK_MD)));
    report.cases[0].evidence = evidenceCell('pass', { evidence: ['ZOD-1_TC-01_api-evidence.png', 'ZOD-1_TC-01_ui.png'], note: '3 s' });
    const moved = evidenceBelowTable(report, (f) => f.includes('api-evidence'));
    expect(moved.cases[0].evidence).toBe('![ZOD-1_TC-01_ui.png](attachments/ZOD-1_TC-01_ui.png)<br/>**PASSED** – 3 s<br/>Screenshot: see Evidence TC-01 below');
    expect(moved.trailer).toContain('## Evidence\n\n### TC-01 – Save fixed debtor number\n\n![ZOD-1_TC-01_api-evidence.png](attachments/ZOD-1_TC-01_api-evidence.png)');
    expect(report.cases[0].evidence).toContain('api-evidence');
    expect(evidenceBelowTable(report, () => false)).toBe(report);
  });
});
