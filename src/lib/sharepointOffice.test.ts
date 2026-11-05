import { describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { exportOfficeDocument, normalizeOfficeDocument, parseCsv, parseOfficeLink, renderOfficeDocument, type OfficeDocument } from './sharepointOffice.js';

describe('parseOfficeLink', () => {
  it('reads sharing links by their type letter', () => {
    expect(parseOfficeLink('https://contoso.sharepoint.com/:p:/s/Zorg/IQAMXj9B?e=ccS7xt')).toMatchObject({ kind: 'powerpoint', site: 'Zorg' });
    expect(parseOfficeLink('https://contoso.sharepoint.com/:w:/s/HR/EaBc')).toMatchObject({ kind: 'word', site: 'HR' });
    expect(parseOfficeLink('https://contoso.sharepoint.com/:x:/r/sites/Fin/Shared%20Documents/Budget.xlsx?d=w1')).toMatchObject({
      kind: 'excel',
      site: 'Fin',
      fileName: 'Budget.xlsx',
    });
  });

  it('reads file paths and Doc.aspx viewer links by extension', () => {
    expect(parseOfficeLink('https://contoso.sharepoint.com/sites/Zorg/Shared%20Documents/Update%205-11.pptx')).toMatchObject({
      kind: 'powerpoint',
      site: 'Zorg',
      fileName: 'Update 5-11.pptx',
    });
    expect(parseOfficeLink('https://contoso.sharepoint.com/sites/Zorg/_layouts/15/Doc.aspx?sourcedoc={x}&file=Plan.docx&action=default')).toMatchObject({
      kind: 'word',
      fileName: 'Plan.docx',
    });
  });

  it('leaves pages, folders, PDFs and other hosts alone', () => {
    expect(parseOfficeLink('https://contoso.sharepoint.com/sites/Intranet/SitePages/Home.aspx')).toBeUndefined();
    expect(parseOfficeLink('https://contoso.sharepoint.com/:f:/s/Zorg/Folder')).toBeUndefined();
    expect(parseOfficeLink('https://contoso.sharepoint.com/:b:/s/Zorg/Pdf')).toBeUndefined();
    expect(parseOfficeLink('https://example.com/deck.pptx')).toBeUndefined();
    expect(parseOfficeLink('not a url')).toBeUndefined();
  });
});

describe('parseCsv', () => {
  it('handles quotes, doubled quotes, commas and newlines inside fields', () => {
    expect(parseCsv('﻿a,"b, c","say ""hi"""\r\n1,"two\nlines",3\r\n')).toEqual([
      ['a', 'b, c', 'say "hi"'],
      ['1', 'two\nlines', '3'],
    ]);
  });
});

const deck: OfficeDocument = {
  kind: 'powerpoint',
  name: 'Update.pptx',
  slides: [
    { index: 1, hidden: false, title: '', shapes: [{ name: 'TextBox 1', paragraphs: ['MONTHLY UPDATE'] }, { name: 'TextBox 2', paragraphs: ['5th November'] }], tables: [], pictures: 1, notes: '' },
    {
      index: 2,
      hidden: true,
      title: 'Team | Vietnam',
      shapes: [{ name: 'TextBox 3', paragraphs: ['Past month', 'RHO', 'GLI'] }],
      tables: [[['Who', 'What'], ['Hung', 'slides | notes']]],
      pictures: 0,
      notes: 'Line one\nLine two',
    },
  ],
};

describe('renderOfficeDocument', () => {
  it('renders slides with titles, nested paragraphs, tables and notes', () => {
    const md = renderOfficeDocument('https://x.sharepoint.com/:p:/s/a/b', deck);
    expect(md).toContain('# Update.pptx\n\n2 slide(s) · [Open in SharePoint](https://x.sharepoint.com/:p:/s/a/b)');
    // No title placeholder: the first text box becomes the heading.
    expect(md).toContain('## Slide 1: MONTHLY UPDATE\n\n- 5th November\n');
    expect(md).toContain('_1 picture(s)/chart(s) not exported as text_');
    expect(md).toContain('## Slide 2: Team | Vietnam (hidden)\n\n- Past month\n  - RHO\n  - GLI\n');
    expect(md).toContain('| Who | What |\n| --- | --- |\n| Hung | slides \\| notes |');
    expect(md).toContain('**Notes:**\n\n> Line one\n> Line two\n');
  });

  it('renders Word outline levels as headings, lists and tables', () => {
    const md = renderOfficeDocument('u', {
      kind: 'word',
      name: 'Plan.docx',
      blocks: [
        { type: 'paragraph', level: 1, list: false, text: 'Doel' },
        { type: 'paragraph', level: 10, list: false, text: 'Body text.' },
        { type: 'paragraph', level: 10, list: true, text: 'item' },
        { type: 'table', rows: [['A', 'B'], ['1']] },
      ],
    });
    expect(md).toContain('## Doel\n\nBody text.\n\n- item\n\n| A | B |\n| --- | --- |\n| 1 |  |');
  });

  it('renders Excel sheets as tables and skips empty rows', () => {
    const md = renderOfficeDocument('u', { kind: 'excel', name: 'B.xlsx', sheets: [{ name: 'Q4', csv: 'k,v\r\n,\r\nx,1\r\n', rows: 3, columns: 2 }, { name: 'Empty', csv: '', rows: 1, columns: 1 }] });
    expect(md).toContain('## Sheet: Q4\n\n| k | v |\n| --- | --- |\n| x | 1 |');
    expect(md).toContain('## Sheet: Empty\n\n_(empty)_');
  });
});

describe('normalizeOfficeDocument', () => {
  it('restores arrays that Windows PowerShell collapsed to a single value', () => {
    const doc = normalizeOfficeDocument({
      kind: 'powerpoint',
      name: 'd.pptx',
      slides: { index: 1, hidden: false, title: '', shapes: { name: 'T', paragraphs: 'only one' }, tables: [['a', 'b']], pictures: 0, notes: '' },
    });
    expect(doc).toEqual({
      kind: 'powerpoint',
      name: 'd.pptx',
      slides: [{ index: 1, hidden: false, title: '', shapes: [{ name: 'T', paragraphs: ['only one'] }], tables: [[['a', 'b']]], pictures: 0, notes: '' }],
    });
    expect(normalizeOfficeDocument({ kind: 'word', name: 'w', blocks: { type: 'table', rows: ['x'] } })).toEqual({ kind: 'word', name: 'w', blocks: [{ type: 'table', rows: [['x']] }] });
  });
});

describe('exportOfficeDocument', () => {
  it('writes document.md and the copy, and keeps the previous version on change', async () => {
    const out = mkdtempSync(join(tmpdir(), 'jirallm-office-test-'));
    try {
      let name = 'Zorgdeclaraties update 5-11-2026.pptx';
      const extract = async (_link: unknown, opts: { copyTo?: string } = {}) => {
        if (opts.copyTo) writeFileSync(opts.copyTo, 'PPTX');
        return { ...deck, name } as OfficeDocument;
      };
      const url = 'https://contoso.sharepoint.com/:p:/s/Zorgdeclaraties/IQAM';
      const first = await exportOfficeDocument(url, { outputDir: out, extract });
      expect(first.path).toBe(join(out, 'sharepoint', 'zorgdeclaraties-zorgdeclaraties-update-5-11-2026', 'document.md'));
      expect(first.copy && readFileSync(first.copy, 'utf8')).toBe('PPTX');
      expect(first.copy?.endsWith('zorgdeclaraties-update-5-11-2026.pptx')).toBe(true);
      expect(readFileSync(first.path, 'utf8')).toMatch(/^---\nsharepoint:\n {2}title: "Zorgdeclaraties update 5-11-2026.pptx"\n {2}site: "Zorgdeclaraties"\n {2}kind: powerpoint\n/);
      expect(first.changed).toBe(true);

      const same = await exportOfficeDocument(url, { outputDir: out, extract, copy: false });
      expect(same.changed).toBe(false);
      expect(same.copy).toBeUndefined();

      deck.slides[0].shapes[1].paragraphs = ['6th November'];
      const changed = await exportOfficeDocument(url, { outputDir: out, extract });
      expect(changed.changed).toBe(true);
      expect(existsSync(join(changed.dir, '.document.previous.md'))).toBe(true);
      name = 'x.pptx';
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  });

  it('refuses links that are not Office documents', async () => {
    await expect(exportOfficeDocument('https://contoso.sharepoint.com/sites/a/SitePages/b.aspx', { outputDir: '.' })).rejects.toThrow(/Not a SharePoint Office document link/);
  });
});
