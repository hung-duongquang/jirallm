import type { Verdict } from './qaReport.js';

/**
 * Turns a Playwright JSON report (`--reporter=json`, or the `json` reporter's outputFile) into test
 * results: one per test, with its steps, verdict, a short note and its image attachments.
 * Only the fields used here are typed; the reporter writes many more.
 */
type PwAttachment = { name: string; contentType: string; path?: string; body?: string };
type PwStep = { title: string; error?: unknown };
type PwResult = {
  status: string;
  duration: number;
  retry?: number;
  error?: { message?: string };
  errors?: Array<{ message?: string }>;
  attachments?: PwAttachment[];
  steps?: PwStep[];
};
type PwTest = { projectName?: string; status: string; annotations?: Array<{ type: string; description?: string }>; results: PwResult[] };
type PwSpec = { title: string; file: string; line: number; tests: PwTest[] };
type PwSuite = { title: string; file?: string; specs?: PwSpec[]; suites?: PwSuite[] };
export type PlaywrightReport = { suites?: PwSuite[] };

export type PlaywrightResult = {
  title: string;
  /** Describe blocks around the test, outermost first (the file itself is left out). */
  describe: string[];
  location: string;
  steps: string[];
  annotations: string[];
  /** A skipped test (e.g. after a failure in a serial block) counts as blocked. */
  verdict: Verdict;
  note: string;
  images: Array<{ name: string; path: string }>;
};

// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-9;]*m/g;

function firstLine(message: string | undefined): string {
  const line = (message ?? '').replace(ANSI, '').split(/\r?\n/).map((l) => l.trim()).find(Boolean) ?? '';
  return line.length > 200 ? `${line.slice(0, 197)}…` : line;
}

function seconds(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${ms} ms`;
}

/** The test.step titles, or else the lines of a text attachment named "steps" or "api-calls". */
function stepsOf(result: PwResult | undefined): string[] {
  const titles = (result?.steps ?? []).map((s) => s.title);
  if (titles.length > 0) return titles;
  const listed = result?.attachments?.find((a) => (a.name === 'steps' || a.name === 'api-calls') && a.body);
  return listed ? Buffer.from(listed.body!, 'base64').toString('utf8').split(/\r?\n/).filter(Boolean) : [];
}

function verdictOf(test: PwTest, last: PwResult | undefined): { verdict: Verdict; note: string } {
  if (!last || test.status === 'skipped') return { verdict: 'blocked', note: 'skipped (not run)' };
  if (test.status === 'expected') return { verdict: 'pass', note: `${seconds(last.duration)}` };
  if (test.status === 'flaky') return { verdict: 'pass', note: `flaky: passed on retry ${last.retry ?? ''}`.trim() };
  const message = last.error?.message ?? last.errors?.[0]?.message;
  return { verdict: 'fail', note: firstLine(message) || last.status };
}

export function playwrightResults(report: PlaywrightReport, grep?: RegExp): PlaywrightResult[] {
  const out: PlaywrightResult[] = [];
  const walk = (suite: PwSuite, describe: string[], isFile: boolean) => {
    const path = isFile ? describe : [...describe, suite.title];
    for (const spec of suite.specs ?? []) {
      if (grep && !grep.test([...path, spec.title].join(' '))) continue;
      for (const test of spec.tests) {
        const last = test.results[test.results.length - 1];
        const { verdict, note } = verdictOf(test, last);
        out.push({
          title: spec.title,
          describe: path,
          location: `${spec.file.replace(/\\/g, '/')}:${spec.line}`,
          steps: stepsOf(last),
          annotations: (test.annotations ?? []).map((a) => a.description ?? '').filter(Boolean),
          verdict,
          note,
          images: (last?.attachments ?? [])
            .filter((a): a is PwAttachment & { path: string } => !!a.path && a.contentType.startsWith('image/'))
            .map((a) => ({ name: a.name, path: a.path })),
        });
      }
    }
    for (const child of suite.suites ?? []) walk(child, path, false);
  };
  // Top-level suites are files; their title is the file path, which `location` already carries.
  for (const file of report.suites ?? []) walk(file, [], true);
  return out;
}
