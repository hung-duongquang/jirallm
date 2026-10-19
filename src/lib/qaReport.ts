import { markdownToWiki } from './markdownToWiki.js';

/**
 * Tester's report in the team's Confluence layout: a header table (Jira, Env, Results), a
 * precondition section and one row per test case whose last cell holds evidence + verdict.
 */
export const REPORT_COLUMNS = [
  'ID', 'Title', 'Precondition', 'Steps', 'Expected Result', 'Priority', 'Type',
  'Automation Layer', 'Dev test coverage', '**Evidence**',
] as const;

export type Verdict = 'pass' | 'fail' | 'blocked';
const VERDICT_LABEL: Record<Verdict, string> = { pass: 'PASSED', fail: 'FAILED', blocked: 'BLOCKED' };
export const NOT_RUN = 'NOT RUN';

/** Splits a markdown table row on unescaped pipes. */
export function splitRow(line: string): string[] {
  const cells: string[] = [];
  let cell = '';
  const body = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  for (let i = 0; i < body.length; i++) {
    if (body[i] === '\\' && body[i + 1] === '|') { cell += '\\|'; i++; continue; }
    if (body[i] === '|') { cells.push(cell.trim()); cell = ''; continue; }
    cell += body[i];
  }
  cells.push(cell.trim());
  return cells;
}

const joinRow = (cells: readonly string[]) => `| ${cells.join(' | ')} |`;
const isSeparator = (line: string) => /^\|?\s*:?-{3,}/.test(line.trim());

export type AcScenario = { title: string; given: string; when: string; then: string };

/** Acceptance-criteria tables (a header with Scenario … Then) from an exported task.md. */
export function parseAcceptanceScenarios(taskMd: string): AcScenario[] {
  const lines = taskMd.split(/\r?\n/);
  const scenarios: AcScenario[] = [];
  for (let i = 0; i < lines.length - 1; i++) {
    if (!lines[i].trim().startsWith('|') || !isSeparator(lines[i + 1])) continue;
    const header = splitRow(lines[i]).map((h) => h.replace(/\*/g, '').trim().toLowerCase());
    const col = (name: string) => header.findIndex((h) => h === name || h.startsWith(name));
    const [s, g, w, t] = [col('scenario'), col('given'), col('when'), col('then')];
    if (s < 0 || t < 0) continue;
    for (let j = i + 2; j < lines.length && lines[j].trim().startsWith('|'); j++) {
      const cells = splitRow(lines[j]);
      scenarios.push({
        title: cells[s] ?? '',
        given: g >= 0 ? cells[g] ?? '' : '',
        when: w >= 0 ? cells[w] ?? '' : '',
        then: cells[t] ?? '',
      });
      i = j;
    }
  }
  return scenarios;
}

export type ReportHeader = { issueKey: string; issueUrl: string; title: string; env?: string };

export function buildReport(header: ReportHeader, scenarios: readonly AcScenario[]): string {
  const rows = scenarios.map((sc, idx) =>
    joinRow([
      `TC-${String(idx + 1).padStart(2, '0')}`, sc.title, sc.given, sc.when, sc.then,
      '', 'Functional', '', '', NOT_RUN,
    ])
  );
  return [
    `# ${header.title}`,
    '',
    '| **Jira** | |',
    '| --- | --- |',
    `| **Ticket** | [${header.issueKey}](${header.issueUrl}) |`,
    `| **Env** | ${header.env ?? ''} |`,
    `| **Results** | 0/${scenarios.length} |`,
    '',
    '## Precondition',
    '',
    '- …',
    '',
    joinRow(REPORT_COLUMNS),
    joinRow(REPORT_COLUMNS.map(() => '---')),
    ...rows,
    '',
  ].join('\n');
}

const RESULTS_ROW = /^\|[ \t]*\*\*Results\*\*[ \t]*\|.*\|[ \t]*$/m;

/** Rows of the test-case table: lines starting with `| TC-`. */
const isCaseRow = (line: string) => /^\|\s*TC-\d+/.test(line);

export function countResults(report: string): { passed: number; failed: number; total: number } {
  const rows = report.split(/\r?\n/).filter(isCaseRow);
  const last = (l: string) => splitRow(l).at(-1) ?? '';
  return {
    passed: rows.filter((l) => /\bPASSED\b/.test(last(l))).length,
    failed: rows.filter((l) => /\bFAILED\b/.test(last(l))).length,
    total: rows.length,
  };
}

function withResultsLine(report: string): string {
  const { passed, failed, total } = countResults(report);
  const summary = `${passed}/${total}${failed ? ` (${failed} failed)` : ''}`;
  return report.replace(RESULTS_ROW, `| **Results** | ${summary} |`);
}

/** Sets the evidence cell of one case: images/files first, then the verdict and note. */
export function setResult(
  report: string,
  caseId: string,
  verdict: Verdict,
  opts: { note?: string; evidence?: readonly string[] } = {}
): string {
  const lines = report.split('\n');
  const idx = lines.findIndex((l) => isCaseRow(l) && splitRow(l)[0] === caseId);
  if (idx < 0) throw new Error(`${caseId} is not in the report.`);
  const cells = splitRow(lines[idx]);
  const media = (opts.evidence ?? []).map((f) =>
    /\.(png|jpe?g|gif|webp)$/i.test(f) ? `![${f}](attachments/${f})` : `[${f}](attachments/${f})`
  );
  const note = opts.note ? ` – ${opts.note.replace(/\|/g, '\\|').replace(/\r?\n/g, '<br/>')}` : '';
  cells[cells.length - 1] = [...media, `**${VERDICT_LABEL[verdict]}**${note}`].join('<br/>');
  lines[idx] = joinRow(cells);
  return withResultsLine(lines.join('\n'));
}

/** Jira-wiki for Confluence's wiki→storage converter: cell line breaks and attachment images. */
export function reportToWiki(report: string): string {
  return markdownToWiki(report)
    .split('\n')
    // In a data row an empty cell gives "||", which wiki reads as a header cell from there on.
    .map((line) => (/^\|[^|]/.test(line) ? line.replace(/(?<!\\)\|(?=\|)/g, '| ') : line))
    .join('\n')
    .replace(/<br\s*\/?>/g, ' \\\\ ')
    .replace(/!attachments\/([^!|]+)!/g, '!$1!')
    .replace(/\[([^|\]]+)\|attachments\/([^\]]+)\]/g, '[^$2]');
}
