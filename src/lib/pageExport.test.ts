import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { exportConfluencePage, PREVIOUS_PAGE_FILE, type ConfluenceClient } from './confluence.js';

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

function fakeClient(text: string, version: number): ConfluenceClient {
  return {
    origin: 'https://x.atlassian.net',
    getPage: async () => ({
      id: '42',
      title: 'Spec',
      version,
      webUrl: 'https://x.atlassian.net/wiki/spaces/Z/pages/42/Spec',
      adf: { type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] },
    }),
    listAttachments: async () => [],
  } as unknown as ConfluenceClient;
}

describe('exportConfluencePage earlier copy', () => {
  it('keeps the replaced page.md only when the page changed', async () => {
    const outputDir = mkdtempSync(join(tmpdir(), 'jl-page-'));
    dirs.push(outputDir);
    const first = await exportConfluencePage(fakeClient('old text', 1), '42', { outputDir });
    const previous = join(outputDir, 'confluence', first.dirName, PREVIOUS_PAGE_FILE);
    expect(first.status).toBe('new');
    expect(existsSync(previous)).toBe(false);

    expect((await exportConfluencePage(fakeClient('old text', 1), '42', { outputDir })).status).toBe('unchanged');
    expect(existsSync(previous)).toBe(false);

    expect((await exportConfluencePage(fakeClient('new text', 2), '42', { outputDir })).status).toBe('changed');
    expect(readFileSync(previous, 'utf8')).toContain('old text');
  });
});
