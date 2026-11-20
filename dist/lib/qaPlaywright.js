export const QA_CASE = 'qa-case';
// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-9;]*m/g;
function firstLine(message) {
    const line = (message ?? '').replace(ANSI, '').split(/\r?\n/).map((l) => l.trim()).find(Boolean) ?? '';
    return line.length > 200 ? `${line.slice(0, 197)}…` : line;
}
function seconds(ms) {
    return ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${ms} ms`;
}
/** The test.step titles, or else the lines of a text attachment named "steps" or "api-calls". */
function stepsOf(result) {
    const titles = (result?.steps ?? []).map((s) => s.title);
    if (titles.length > 0)
        return titles;
    const listed = result?.attachments?.find((a) => (a.name === 'steps' || a.name === 'api-calls') && a.body);
    return listed ? Buffer.from(listed.body, 'base64').toString('utf8').split(/\r?\n/).filter(Boolean) : [];
}
function verdictOf(test, last) {
    if (!last || test.status === 'skipped')
        return { verdict: 'blocked', note: 'skipped (not run)' };
    if (test.status === 'expected')
        return { verdict: 'pass', note: `${seconds(last.duration)}` };
    if (test.status === 'flaky')
        return { verdict: 'pass', note: `flaky: passed on retry ${last.retry ?? ''}`.trim() };
    const message = last.error?.message ?? last.errors?.[0]?.message;
    return { verdict: 'fail', note: firstLine(message) || last.status };
}
export function playwrightResults(report, grep) {
    const out = [];
    const walk = (suite, describe, isFile) => {
        const path = isFile ? describe : [...describe, suite.title];
        for (const spec of suite.specs ?? []) {
            if (grep && !grep.test([...path, spec.title].join(' ')))
                continue;
            for (const test of spec.tests) {
                const last = test.results[test.results.length - 1];
                const { verdict, note } = verdictOf(test, last);
                out.push({
                    title: spec.title,
                    describe: path,
                    location: `${spec.file.replace(/\\/g, '/')}:${spec.line}`,
                    steps: stepsOf(last),
                    annotations: (test.annotations ?? []).filter((a) => a.type !== QA_CASE).map((a) => a.description ?? '').filter(Boolean),
                    caseRefs: (test.annotations ?? []).filter((a) => a.type === QA_CASE)
                        .flatMap((a) => (a.description ?? '').split(/[\s,;]+/)).filter(Boolean),
                    verdict,
                    note,
                    images: (last?.attachments ?? [])
                        .filter((a) => !!a.path && a.contentType.startsWith('image/'))
                        .map((a) => ({ name: a.name, path: a.path })),
                });
            }
        }
        for (const child of suite.suites ?? [])
            walk(child, path, false);
    };
    // Top-level suites are files; their title is the file path, which `location` already carries.
    for (const file of report.suites ?? [])
        walk(file, [], true);
    return out;
}
//# sourceMappingURL=qaPlaywright.js.map