import { describe, expect, it } from 'vitest';
import {
  buildReport, countResults, parseAcceptanceScenarios, parseReport, renderReport, reportToWiki, setResult, splitRow,
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
});
