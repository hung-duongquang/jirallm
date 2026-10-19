import { describe, expect, it } from 'vitest';
import { playwrightResults, type PlaywrightReport } from './qaPlaywright.js';

const report: PlaywrightReport = {
  suites: [{
    title: 'huisartsen\\series.spec.ts',
    file: 'huisartsen\\series.spec.ts',
    specs: [],
    suites: [{
      title: 'Series',
      specs: [
        {
          title: 'creates a series', file: 'huisartsen\\series.spec.ts', line: 10,
          tests: [{
            status: 'expected',
            annotations: [{ type: 'test case', description: 'ZOD-1: POST' }],
            results: [{
              status: 'passed', duration: 1234,
              steps: [{ title: 'create' }, { title: 'list' }],
              attachments: [
                { name: 'api-evidence', contentType: 'image/png', path: 'C:\\r\\api-evidence.png' },
                { name: 'video', contentType: 'video/webm', path: 'C:\\r\\video.webm' },
                { name: 'inline', contentType: 'image/png' },
              ],
            }],
          }],
        },
        {
          title: 'rejects overlap', file: 'huisartsen\\series.spec.ts', line: 20,
          tests: [{ status: 'unexpected', results: [{ status: 'failed', duration: 5, attachments: [{ name: 'api-calls', contentType: 'text/plain', body: Buffer.from('POST /series → 404\nGET /series → 200').toString('base64') }], error: { message: '\u001b[31mError: expect(received).toBe(expected)\u001b[39m\n\nExpected: 400' } }] }],
        },
        {
          title: 'after the failure', file: 'huisartsen\\series.spec.ts', line: 30,
          tests: [{ status: 'skipped', results: [] }],
        },
      ],
    }],
  }],
};

describe('playwrightResults', () => {
  it('maps tests to verdicts, steps, notes and image attachments', () => {
    const [pass, fail, skipped] = playwrightResults(report);
    expect(pass).toMatchObject({
      title: 'creates a series', describe: ['Series'], location: 'huisartsen/series.spec.ts:10',
      steps: ['create', 'list'], annotations: ['ZOD-1: POST'], verdict: 'pass', note: '1.2 s',
      images: [{ name: 'api-evidence', path: 'C:\\r\\api-evidence.png' }],
    });
    expect(fail).toMatchObject({ steps: ['POST /series → 404', 'GET /series → 200'], verdict: 'fail', note: 'Error: expect(received).toBe(expected)', images: [] });
    expect(skipped).toMatchObject({ verdict: 'blocked', note: 'skipped (not run)' });
  });

  it('filters on describe + title', () => {
    expect(playwrightResults(report, /series rejects/i).map((r) => r.title)).toEqual(['rejects overlap']);
  });
});
