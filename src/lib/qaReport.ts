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
  /** Cells of columns that are not one of the fields above (e.g. Test Data, Side effects), keyed by column label. */
  extra?: Record<string, string>;
};
export type CaseField = Exclude<keyof QaCase, 'extra'>;

/** Column labels testers use for each field; any other column is kept in `extra`. */
const FIELD_ALIASES: Record<CaseField, readonly string[]> = {
  id: ['id'],
  title: ['title', 'scenario'],
  precondition: ['precondition', 'situation', 'given'],
  steps: ['steps', 'test step', 'action', 'when'],
  expected: ['expected result', 'expected', 'expected results'],
  priority: ['priority'],
  type: ['type'],
  automation: ['automation layer', 'automation'],
  coverage: ['dev test coverage'],
  evidence: ['evidence', 'result', 'results'],
};

/** The case field a column label maps to, or undefined for a free column kept in `extra`. */
export function columnField(label: string): CaseField | undefined {
  const norm = label.replace(/\*\*/g, '').trim().toLowerCase();
  return (Object.keys(FIELD_ALIASES) as CaseField[]).find((f) => FIELD_ALIASES[f].includes(norm));
}

/**
 * Report layouts the testers use, picked with `qa init --template`:
 * - default: the case table above.
 * - api: backend tickets driven by API calls or messages. A shared base message and a read-back section,
 *   and a Test Data column so each case lists only what it changes.
 * - matrix: one row per situation × action combination with its expected outcome and side effects,
 *   plus an Also-check list for invariants (idempotency, mixed selections, …).
 */
export const TEMPLATES = ['default', 'api', 'matrix'] as const;
export type Template = (typeof TEMPLATES)[number];

const TEMPLATE_COLUMNS: Record<Template, readonly string[]> = {
  default: REPORT_COLUMNS,
  api: [
    'ID', 'Title', 'Precondition', 'Test Data', 'Steps', 'Expected Result', 'Priority', 'Type',
    'Automation Layer', 'Dev test coverage', '**Evidence**',
  ],
  matrix: ['ID', 'Title', 'Situation', 'Action', 'Expected Result', 'Side effects', 'Priority', '**Evidence**'],
};

const TEMPLATE_SECTIONS: Record<Template, string> = {
  default: '',
  api: [
    '## Base message',
    '',
    '`POST <endpoint>`. Every case sends this message; its Test Data column lists only the values it changes.',
    '',
    '```json',
    '{',
    '}',
    '```',
    '',
    '## Read the result',
    '',
    '- `GET <endpoint>`: the fields to check',
  ].join('\n'),
  matrix: [
    '## Dimensions',
    '',
    '- Situation: …',
    '- Action: …',
    '',
    'One row per combination that changes the outcome.',
  ].join('\n'),
};

const TEMPLATE_TRAILER: Record<Template, string> = { default: '', api: '', matrix: '## Also check\n\n- …' };

export type QaReport = {
  title: string;
  /** Header rows other than Results (which is computed), e.g. Ticket, Env, API. */
  header: Array<{ label: string; value: string }>;
  precondition: string;
  /** Sections between the precondition and the case table (base message, lookup tables, …), kept as written. */
  sections?: string;
  /** Case table column labels as written; REPORT_COLUMNS when absent. */
  columns?: string[];
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

function cellFor(c: QaCase, label: string): string {
  const field = columnField(label);
  return field ? c[field] : c.extra?.[stripBold(label)] ?? '';
}

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
  const columns = report.columns?.length ? report.columns : REPORT_COLUMNS;
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
    ...(report.sections?.trim() ? [report.sections.trim(), ''] : []),
    joinRow(columns),
    joinRow(columns.map(() => '---')),
    ...report.cases.map((c) => joinRow(columns.map((label) => cellFor(c, label)))),
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
    const columns = splitRow(lines[caseTable.start]);
    if (columns.join('|') !== REPORT_COLUMNS.join('|')) report.columns = columns;
    for (const line of lines.slice(caseTable.start + 2, caseTable.end)) {
      const cells = splitRow(line);
      const c: QaCase = {
        id: '', title: '', precondition: '', steps: '', expected: '', priority: '', type: '', automation: '', coverage: '', evidence: '',
      };
      columns.forEach((label, i) => {
        const field = columnField(label);
        if (field) c[field] = cells[i] ?? '';
        else (c.extra ??= {})[stripBold(label)] = cells[i] ?? '';
      });
      report.cases.push(c);
    }
    report.trailer = lines.slice(caseTable.end).join('\n').trim();
  }
  const pre = lines.findIndex((l) => /^##\s+Precondition/i.test(l));
  if (pre >= 0) {
    const stop = caseTable ? caseTable.start : lines.length;
    // The precondition runs to the next section heading; later sections are kept as written.
    const next = lines.findIndex((l, i) => i > pre && i < stop && /^#{1,2}\s/.test(l));
    report.precondition = lines.slice(pre + 1, next >= 0 ? next : stop).join('\n').trim();
    if (next >= 0) report.sections = lines.slice(next, stop).join('\n').trim();
  }
  return report;
}

export type ReportHeader = { issueKey: string; issueUrl: string; title: string; env?: string; api?: string };

export function newReport(header: ReportHeader, scenarios: readonly AcScenario[], template: Template = 'default'): QaReport {
  return {
    title: header.title,
    header: [
      { label: 'Ticket', value: `[${header.issueKey}](${header.issueUrl})` },
      { label: 'Env', value: header.env ?? '' },
      ...(template === 'api' || header.api ? [{ label: 'API', value: header.api ?? '' }] : []),
    ],
    precondition: '',
    ...(template === 'default' ? {} : { sections: TEMPLATE_SECTIONS[template], columns: [...TEMPLATE_COLUMNS[template]] }),
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
    trailer: TEMPLATE_TRAILER[template],
  };
}

export const buildReport = (header: ReportHeader, scenarios: readonly AcScenario[], template: Template = 'default'): string =>
  renderReport(newReport(header, scenarios, template));

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

/**
 * A copy of the report with the images `moveOut` picks taken out of the case table into an Evidence section below it.
 * Confluence shrinks a cell image to the column width, so a tall one (e.g. a log of API calls) can't be read in an 11-column table.
 */
export function evidenceBelowTable(report: QaReport, moveOut: (file: string) => boolean): QaReport {
  const sections: string[] = [];
  const cases = report.cases.map((c) => {
    const moved: string[] = [];
    const evidence = c.evidence.replace(/!\[[^\]]*\]\(attachments\/([^)]+)\)(<br\/>)?/g, (m, file: string) => {
      if (!moveOut(file)) return m;
      moved.push(`![${file}](attachments/${file})`);
      return '';
    });
    if (!moved.length) return c;
    sections.push(`### ${c.id}${c.title ? ` – ${c.title}` : ''}`, '', ...moved.flatMap((m) => [m, '']));
    return { ...c, evidence: `${evidence.replace(/(<br\/>)+$/, '')}<br/>Screenshot: see Evidence ${c.id} below` };
  });
  if (!sections.length) return report;
  const trailer = [...(report.trailer.trim() ? [report.trailer.trim(), ''] : []), '## Evidence', '', ...sections].join('\n').trim();
  return { ...report, cases, trailer };
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
  return markdownToWiki(report.replaceAll('{', '\u0001').replaceAll('}', '\u0002'))
    .replaceAll('\u0001', '\\{')
    .replaceAll('\u0002', '\\}')
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
    .replace(/\[([^|\]]+)\|attachments\/([^\]]+)\]/g, '[^$2]')
    // Code blocks show their text literally, so braces there need no escape.
    .replace(/(\{code(?::[^}\n]*)?\}\n)([\s\S]*?)(\{code\})/g, (_m, open: string, body: string, close: string) =>
      open + body.replaceAll('\\{', '{').replaceAll('\\}', '}') + close);
}
