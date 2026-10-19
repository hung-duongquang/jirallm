import { markdownToWiki } from './markdownToWiki.js';

/**
 * Tester's report in the team's Confluence layout: a header table (Jira, Env, Results), a
 * precondition section and one row per test case whose last cell holds evidence + verdict.
 * Cells are markdown with `<br/>` for line breaks, exactly as they appear in the table.
 */
export const REPORT_COLUMNS = [
  'ID', 'Title', 'Precondition', 'Steps', 'Expected Result', 'Priority', 'Type',
  'Automation Layer', 'Dev test coverage', '**Evidence**',
] as const;

export type QaCase = {
  id: string;
  title: string;
  precondition: string;
  steps: string;
  expected: string;
  priority: string;
  type: string;
  automation: string;
  coverage: string;
  evidence: string;
};
const CASE_FIELDS = [
  'id', 'title', 'precondition', 'steps', 'expected', 'priority', 'type', 'automation', 'coverage', 'evidence',
] as const satisfies ReadonlyArray<keyof QaCase>;

export type QaReport = {
  title: string;
  /** Header rows other than Results (which is computed), e.g. Ticket, Env, API. */
  header: Array<{ label: string; value: string }>;
  precondition: string;
  cases: QaCase[];
  /** Anything after the case table, kept as written. */
  trailer: string;
};

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
const isTableLine = (line: string) => line.trim().startsWith('|');
const stripBold = (s: string) => s.replace(/\*\*/g, '').trim();

/** Text a user typed (newlines, pipes) as a single table cell. */
export const toCell = (text: string) => text.replace(/\r?\n/g, '<br/>').replace(/(?<!\\)\|/g, '\\|').trim();
/** A table cell back as plain multi-line text, for editing. */
export const fromCell = (cell: string) => cell.replace(/<br\s*\/?>/g, '\n').replace(/\\\|/g, '|');

export type AcScenario = { title: string; given: string; when: string; then: string };

/** Acceptance-criteria tables (a header with Scenario … Then) from an exported task.md. */
export function parseAcceptanceScenarios(taskMd: string): AcScenario[] {
  const lines = taskMd.split(/\r?\n/);
  const scenarios: AcScenario[] = [];
  for (let i = 0; i < lines.length - 1; i++) {
    if (!isTableLine(lines[i]) || !isSeparator(lines[i + 1])) continue;
    const header = splitRow(lines[i]).map((h) => stripBold(h).toLowerCase());
    const col = (name: string) => header.findIndex((h) => h === name || h.startsWith(name));
    const [s, g, w, t] = [col('scenario'), col('given'), col('when'), col('then')];
    if (s < 0 || t < 0) continue;
    for (let j = i + 2; j < lines.length && isTableLine(lines[j]); j++) {
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

export function countCases(cases: readonly QaCase[]): { passed: number; failed: number; blocked: number; total: number } {
  const has = (label: string) => cases.filter((c) => new RegExp(`\\b${label}\\b`).test(c.evidence)).length;
  return { passed: has('PASSED'), failed: has('FAILED'), blocked: has('BLOCKED'), total: cases.length };
}

function resultsText(cases: readonly QaCase[]): string {
  const { passed, failed, blocked, total } = countCases(cases);
  const extra = [failed ? `${failed} failed` : '', blocked ? `${blocked} blocked` : ''].filter(Boolean).join(', ');
  return `${passed}/${total}${extra ? ` (${extra})` : ''}`;
}

export function renderReport(report: QaReport): string {
  const header = report.header.filter((h) => stripBold(h.label).toLowerCase() !== 'results');
  return [
    `# ${report.title}`,
    '',
    '| **Jira** | |',
    '| --- | --- |',
    ...header.map((h) => joinRow([`**${stripBold(h.label)}**`, h.value])),
    joinRow(['**Results**', resultsText(report.cases)]),
    '',
    '## Precondition',
    '',
    report.precondition.trim() || '- …',
    '',
    joinRow(REPORT_COLUMNS),
    joinRow(REPORT_COLUMNS.map(() => '---')),
    ...report.cases.map((c) => joinRow(CASE_FIELDS.map((f) => c[f]))),
    '',
    ...(report.trailer.trim() ? [report.trailer.trim(), ''] : []),
  ].join('\n');
}

export function parseReport(markdown: string): QaReport {
  const lines = markdown.split(/\r?\n/);
  const report: QaReport = { title: '', header: [], precondition: '', cases: [], trailer: '' };
  report.title = lines.find((l) => l.startsWith('# '))?.slice(2).trim() ?? '';

  const tables: Array<{ start: number; end: number }> = [];
  for (let i = 0; i < lines.length - 1; i++) {
    if (!isTableLine(lines[i]) || !isSeparator(lines[i + 1])) continue;
    let end = i + 2;
    while (end < lines.length && isTableLine(lines[end])) end++;
    tables.push({ start: i, end });
    i = end;
  }
  const caseTable = tables.find((t) => stripBold(splitRow(lines[t.start])[0] ?? '').toLowerCase() === 'id');
  const headerTable = tables.find((t) => t !== caseTable);

  if (headerTable) {
    for (const line of lines.slice(headerTable.start + 2, headerTable.end)) {
      const [label = '', value = ''] = splitRow(line);
      // Results is computed from the cases on every render.
      if (stripBold(label).toLowerCase() !== 'results') report.header.push({ label: stripBold(label), value });
    }
  }
  if (caseTable) {
    for (const line of lines.slice(caseTable.start + 2, caseTable.end)) {
      const cells = splitRow(line);
      report.cases.push(Object.fromEntries(CASE_FIELDS.map((f, i) => [f, cells[i] ?? ''])) as QaCase);
    }
    report.trailer = lines.slice(caseTable.end).join('\n').trim();
  }
  const pre = lines.findIndex((l) => /^##\s+Precondition/i.test(l));
  if (pre >= 0) {
    const stop = caseTable ? caseTable.start : lines.length;
    report.precondition = lines.slice(pre + 1, stop).join('\n').trim();
  }
  return report;
}

export type ReportHeader = { issueKey: string; issueUrl: string; title: string; env?: string };

export function newReport(header: ReportHeader, scenarios: readonly AcScenario[]): QaReport {
  return {
    title: header.title,
    header: [
      { label: 'Ticket', value: `[${header.issueKey}](${header.issueUrl})` },
      { label: 'Env', value: header.env ?? '' },
    ],
    precondition: '',
    cases: scenarios.map((sc, idx) => ({
      id: `TC-${String(idx + 1).padStart(2, '0')}`,
      title: sc.title,
      precondition: sc.given,
      steps: sc.when,
      expected: sc.then,
      priority: '',
      type: 'Functional',
      automation: '',
      coverage: '',
      evidence: NOT_RUN,
    })),
    trailer: '',
  };
}

export const buildReport = (header: ReportHeader, scenarios: readonly AcScenario[]): string =>
  renderReport(newReport(header, scenarios));

export function countResults(markdown: string): { passed: number; failed: number; total: number } {
  const { passed, failed, total } = countCases(parseReport(markdown).cases);
  return { passed, failed, total };
}

/** Evidence cell: images/files first, then the verdict and note. */
export function evidenceCell(verdict: Verdict, opts: { note?: string; evidence?: readonly string[] } = {}): string {
  const media = (opts.evidence ?? []).map((f) =>
    /\.(png|jpe?g|gif|webp)$/i.test(f) ? `![${f}](attachments/${f})` : `[${f}](attachments/${f})`
  );
  const note = opts.note ? ` – ${toCell(opts.note)}` : '';
  return [...media, `**${VERDICT_LABEL[verdict]}**${note}`].join('<br/>');
}

/** Sets the evidence cell of one case and recomputes the Results line. */
export function setResult(
  markdown: string,
  caseId: string,
  verdict: Verdict,
  opts: { note?: string; evidence?: readonly string[] } = {}
): string {
  const report = parseReport(markdown);
  const target = report.cases.find((c) => c.id === caseId);
  if (!target) throw new Error(`${caseId} is not in the report.`);
  target.evidence = evidenceCell(verdict, opts);
  return renderReport(report);
}

/** Jira-wiki for Confluence's wiki→storage converter: cell line breaks and attachment images. */
export function reportToWiki(report: string): string {
  // Literal braces (e.g. "series/{id}") read as macros in wiki; park them so only the converter's own markup keeps its braces.
  return markdownToWiki(report.replace(/\{/g, '\u0001').replace(/\}/g, '\u0002'))
    .replace(/\u0001/g, '\\{')
    .replace(/\u0002/g, '\\}')
    .split('\n')
    // In a data row an empty cell gives "||", which wiki reads as a header cell from there on.
    .map((line) => {
      if (/^\|[^|]/.test(line)) return line.replace(/(?<!\\)\|(?=\|)/g, '| ');
      // An empty header cell ("||||") would vanish; keep it as a cell.
      if (line.startsWith('||')) return line.replace(/\|\|(?=\|\|)/g, '|| ');
      return line;
    })
    .join('\n')
    .replace(/<br\s*\/?>/g, ' \\\\ ')
    .replace(/!attachments\/([^!|]+)!/g, '!$1!')
    .replace(/\[([^|\]]+)\|attachments\/([^\]]+)\]/g, '[^$2]');
}
