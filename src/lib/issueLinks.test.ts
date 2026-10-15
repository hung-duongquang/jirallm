import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { jiraIssueKeyFromUrl, linkLocalIssues } from './issueLinks.js';
import { convertADFToMarkdown } from './adfToMarkdown.js';

const JIRA = 'https://acme.atlassian.net/browse';

describe('jiraIssueKeyFromUrl', () => {
  it('reads the issue key from a browse URL', () => {
    expect(jiraIssueKeyFromUrl(`${JIRA}/ZOD-3568`)).toBe('ZOD-3568');
    expect(jiraIssueKeyFromUrl(`${JIRA}/zod-12?focusedCommentId=1`)).toBe('ZOD-12');
  });

  it('ignores other URLs', () => {
    expect(jiraIssueKeyFromUrl('https://acme.atlassian.net/wiki/spaces/X')).toBeUndefined();
    expect(jiraIssueKeyFromUrl(`${JIRA}/ZOD-1/extra`)).toBeUndefined();
  });
});

describe('convertADFToMarkdown Jira issue links', () => {
  const doc = (...content: unknown[]) => ({ version: 1, type: 'doc', content }) as never;
  const paragraph = (...content: unknown[]) => ({ type: 'paragraph', content });

  it('writes an issue smart link with its key as the link text', () => {
    const out = convertADFToMarkdown(
      doc(paragraph({ type: 'inlineCard', attrs: { url: `${JIRA}/ZOD-3568` } }))
    );
    expect(out).toBe(`[ZOD-3568](${JIRA}/ZOD-3568)\n`);
  });

  it('shortens a pasted issue URL link but keeps custom link text', () => {
    const link = (text: string) => ({
      type: 'text',
      text,
      marks: [{ type: 'link', attrs: { href: `${JIRA}/ZOD-1` } }],
    });
    expect(convertADFToMarkdown(doc(paragraph(link(`${JIRA}/ZOD-1`))))).toBe(
      `[ZOD-1](${JIRA}/ZOD-1)\n`
    );
    expect(convertADFToMarkdown(doc(paragraph(link('the parent story'))))).toBe(
      `[the parent story](${JIRA}/ZOD-1)\n`
    );
  });
});

describe('linkLocalIssues', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'jirallm-links-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('links an exported bundle relative to the issue folder', () => {
    mkdirSync(join(dir, 'zod-2'));
    writeFileSync(join(dir, 'zod-2', 'task.md'), '# two');
    const out = linkLocalIssues(`See [ZOD-2](${JIRA}/ZOD-2).`, { outputDir: dir, selfKey: 'ZOD-1' });
    expect(out).toBe('See [ZOD-2](../zod-2/task.md).');
  });

  it('falls back to a loose KEY….md file, preferring the shortest name', () => {
    writeFileSync(join(dir, 'ZOD-3-some-title-test-result.md'), '');
    writeFileSync(join(dir, 'ZOD-3-some-title.md'), '');
    writeFileSync(join(dir, 'ZOD-30-other.md'), '');
    const out = linkLocalIssues(`[ZOD-3](${JIRA}/ZOD-3)`, { outputDir: dir });
    expect(out).toBe('[ZOD-3](../ZOD-3-some-title.md)');
  });

  it('keeps the Jira link when there is no local copy, or for the issue itself', () => {
    const md = `[ZOD-9](${JIRA}/ZOD-9) [ZOD-1](${JIRA}/ZOD-1)`;
    expect(linkLocalIssues(md, { outputDir: dir, selfKey: 'ZOD-1' })).toBe(md);
  });

  it('links issues from the same run that are not written yet', () => {
    const out = linkLocalIssues(`[ZOD-4](${JIRA}/ZOD-4)`, { outputDir: dir, batchKeys: ['zod-4'] });
    expect(out).toBe('[ZOD-4](../zod-4/task.md)');
  });

  it('encodes spaces in loose file names and leaves other links alone', () => {
    writeFileSync(join(dir, 'ZOD-5 + ZOD-6 Report.md'), '');
    const md = `[r](${JIRA}/ZOD-5) [site](https://example.com/browse)`;
    expect(linkLocalIssues(md, { outputDir: dir })).toBe(
      '[r](../ZOD-5%20+%20ZOD-6%20Report.md) [site](https://example.com/browse)'
    );
  });
});
