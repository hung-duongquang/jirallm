import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateRawSync } from 'node:zlib';
import { describeEditResults, editNeedsAttention, editPowerPoint, parseEditReport, validateEdits } from './sharepointOfficeEdit.js';
import { expectations, expectationsMet, pptxParagraphs, splitDocumentUrl, waitForServerContent } from './sharepointServerCheck.js';
import type { SharePointClient } from './sharepoint.js';
import { editsFromOptions } from '../cli/commands/sharepoint.js';

describe('validateEdits', () => {
  it('accepts shape, notes and find edits', () => {
    expect(validateEdits([{ slide: 10, shape: 'TextBox 18', text: 'a\nb' }, { slide: '10', notes: '' }, { find: 'x', replace: '' }])).toEqual([
      { slide: 10, shape: 'TextBox 18', text: 'a\nb' },
      { slide: 10, notes: '' },
      { slide: undefined, find: 'x', replace: '' },
    ]);
  });

  it('refuses incomplete edits with the edit number', () => {
    expect(() => validateEdits([])).toThrow(/No edits/);
    expect(() => validateEdits([{ shape: 'A', text: 'b' }])).toThrow(/edit 1: shape and notes edits need a slide number/);
    expect(() => validateEdits([{ slide: 1, notes: 'n' }, { slide: 0, notes: 'n' }])).toThrow(/edit 2: slide must be/);
    expect(() => validateEdits([{ slide: 1, shape: 'A' }])).toThrow(/shape needs text/);
    expect(() => validateEdits([{ find: 'a' }])).toThrow(/find needs replace/);
    expect(() => validateEdits([{ slide: 1 }])).toThrow(/expected/);
  });
});

describe('editsFromOptions', () => {
  it('builds edits from flags and reads @file values', () => {
    const dir = mkdtempSync(join(tmpdir(), 'jirallm-edit-test-'));
    try {
      writeFileSync(join(dir, 'notes.md'), '\uFEFFLine one\r\nLine two\r\n');
      writeFileSync(join(dir, 'edits.json'), JSON.stringify([{ find: 'a', replace: 'b' }]));
      expect(
        editsFromOptions({ slide: '10', shape: 'TextBox 18', text: 'x', notes: `@${join(dir, 'notes.md')}`, edits: join(dir, 'edits.json') })
      ).toEqual([
        { slide: undefined, find: 'a', replace: 'b' },
        { slide: 10, shape: 'TextBox 18', text: 'x' },
        { slide: 10, notes: 'Line one\nLine two' },
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('needs paired flags and at least one edit', () => {
    expect(() => editsFromOptions({ slide: '1', shape: 'A' })).toThrow(/--shape and --text go together/);
    expect(() => editsFromOptions({ find: 'a' })).toThrow(/--find and --replace go together/);
    expect(() => editsFromOptions({})).toThrow(/Nothing to change/);
  });
});

describe('editPowerPoint', () => {
  it('only edits PowerPoint links on SharePoint', async () => {
    await expect(editPowerPoint('https://example.com/x.pptx', [{ slide: 1, notes: '' }])).rejects.toThrow(/Not a SharePoint Office document link/);
    await expect(editPowerPoint('https://contoso.sharepoint.com/:w:/s/a/b', [{ slide: 1, notes: '' }])).rejects.toThrow(/Only PowerPoint/);
  });
});

describe('editPowerPoint with the server check', () => {
  const url = 'https://contoso.sharepoint.com/:p:/s/Team/abc';
  const fullName = 'https://contoso.sharepoint.com/sites/Team/Shared Documents/deck.pptx';
  // Stands in for PowerShell: writes the report the script would write to -Out.
  const run = (results: object[]) => async (args: string[]) => {
    writeFileSync(args[args.indexOf('-Out') + 1], JSON.stringify({ wasOpen: false, fullName, results }));
  };
  const notes = [{ slide: 10, target: 'notes', before: 'old', after: 'New notes\nwith VIPLive' }];
  const client = (modified: () => string, content: () => Buffer) =>
    ({
      json: async () => ({ TimeLastModified: modified(), UIVersionLabel: '18.0' }),
      download: async () => content(),
    }) as unknown as SharePointClient;

  it('is verified once SharePoint holds a newer file with every changed line', async () => {
    let calls = 0;
    const report = await editPowerPoint(url, [{ slide: 10, notes: 'New notes\nwith VIPLive' }], {
      run: run(notes),
      client: client(
        () => new Date(Date.now() + (++calls > 1 ? 1000 : -3_600_000)).toISOString(),
        () => pptx({ 'ppt/notesSlides/notesSlide4.xml': notesXml(['New notes', 'with VIPLive']) })
      ),
      sleep: async () => {},
    });
    expect(report.server).toMatchObject({ status: 'verified', version: '18.0' });
    expect(report.results[0].verified).toBe(true);
    expect(editNeedsAttention(report)).toBe(false);
    expect(describeEditResults(report)).toContain('slide 10 notes: ✓ on SharePoint');
    expect(describeEditResults(report)).toContain('SharePoint has every change (version 18.0');
  });

  it('stays pending when the server never gets the change (upload stuck in the Office cache)', async () => {
    const report = await editPowerPoint(url, [{ slide: 10, notes: 'x' }], {
      run: run(notes),
      client: client(
        () => new Date(Date.now() - 3_600_000).toISOString(),
        () => pptx({ 'ppt/notesSlides/notesSlide4.xml': notesXml(['old']) })
      ),
      verifyTimeoutMs: 0,
      sleep: async () => {},
    });
    expect(report.server).toMatchObject({ status: 'pending', version: '18.0' });
    expect(report.results[0].verified).toBe(false);
    expect(editNeedsAttention(report)).toBe(true);
    expect(describeEditResults(report)).toContain('✗ not on SharePoint yet');
    expect(describeEditResults(report)).toContain('Keep PowerPoint open so it can finish uploading');
  });

  it('says the upload was not checked when there is no SharePoint session', async () => {
    const report = await editPowerPoint(url, [{ slide: 10, notes: 'x' }], { run: run(notes), client: null });
    expect(report.server).toMatchObject({ status: 'unchecked' });
    expect(editNeedsAttention(report)).toBe(false);
    expect(describeEditResults(report)).toContain('the upload to SharePoint was not checked');
  });

  it('skips the server check on a dry run', async () => {
    const report = await editPowerPoint(url, [{ slide: 10, notes: 'x' }], { run: run(notes), dryRun: true, client: null });
    expect(report.server).toBeUndefined();
    expect(describeEditResults(report, true)).toContain('Dry run: nothing changed.');
  });
});

describe('parseEditReport', () => {
  it('restores a collapsed results list', () => {
    const report = parseEditReport({ wasOpen: true, fullName: 'u', results: { slide: 3, target: 'notes', before: 'same', after: 'same' } });
    expect(report.results).toEqual([{ slide: 3, target: 'notes', before: 'same', after: 'same' }]);
  });
});

/** A minimal .pptx: a zip (deflated entries) of the given XML parts. */
function pptx(parts: Record<string, string>): Buffer {
  const locals: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const [name, xml] of Object.entries(parts)) {
    const data = deflateRawSync(Buffer.from(xml));
    const nameBuf = Buffer.from(name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt16LE(nameBuf.length, 26);
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(8, 10);
    cd.writeUInt32LE(data.length, 20);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt32LE(offset, 42);
    locals.push(local, nameBuf, data);
    central.push(cd, nameBuf);
    offset += 30 + nameBuf.length + data.length;
  }
  const cdBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(Object.keys(parts).length, 10);
  eocd.writeUInt32LE(cdBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cdBuf, eocd]);
}

function notesXml(paragraphs: string[]): string {
  return `<p:notes><p:txBody>${paragraphs.map((p) => `<a:p><a:r><a:t>${p.replace(/&/g, '&amp;')}</a:t></a:r></a:p>`).join('')}</p:txBody></p:notes>`;
}

describe('sharepointServerCheck', () => {
  it('reads slide and notes paragraphs from a pptx, joining runs and decoding entities', () => {
    const buf = pptx({
      'ppt/slides/slide1.xml':
        '<p:sld><a:p><a:r><a:t>Presenter: </a:t></a:r><a:r><a:t>Hung &amp; co</a:t></a:r></a:p><a:p><a:r><a:t>A</a:t></a:r><a:br/><a:r><a:t>B</a:t></a:r></a:p></p:sld>',
      'ppt/notesSlides/notesSlide1.xml': notesXml(['Note & 1']),
      'ppt/media/image1.png': 'not xml',
    });
    expect(pptxParagraphs(buf)).toEqual(['Presenter: Hung & co', 'A\nB', 'Note & 1']);
  });

  it('checks expected lines against paragraphs and splits document URLs', () => {
    const list = expectations([
      { target: 'notes', before: 'x', after: 'Past month: done\n\n Line two ' },
      { target: 'find', before: ' + VAT', after: '' },
      { target: 'find', before: 'Hung', after: 'Hung Duong' },
    ]);
    expect(list).toEqual([
      { present: ['Past month: done', 'Line two'], absent: [] },
      { present: [], absent: [' + VAT'] },
      { present: ['Hung Duong'], absent: [] },
    ]);
    expect(expectationsMet(['Past month: done', 'Line two', 'Presenter: Hung Duong'], list)).toEqual([true, true, true]);
    expect(expectationsMet(['Release + VAT', 'Presenter: Hung'], list)).toEqual([false, false, false]);
    expect(splitDocumentUrl('https://contoso.sharepoint.com/sites/Zorg/Gedeelde%20documenten/x.pptx')).toEqual({
      site: 'https://contoso.sharepoint.com/sites/Zorg',
      path: '/sites/Zorg/Gedeelde documenten/x.pptx',
    });
    expect(splitDocumentUrl('C:\\local\\x.pptx')).toBeUndefined();
  });

  it('downloads again only when the server version changes, until the content matches', async () => {
    const versions = ['18.0', '18.0', '18.0', '19.0'];
    let downloads = 0;
    const fake = {
      json: async () => ({ TimeLastModified: '2026-11-05T04:00:00Z', UIVersionLabel: versions.shift() ?? '19.0' }),
      download: async () => {
        downloads++;
        return pptx({ 'ppt/slides/slide1.xml': `<a:p><a:r><a:t>${downloads > 1 ? 'new text' : 'old text'}</a:t></a:r></a:p>` });
      },
    } as unknown as SharePointClient;
    const check = await waitForServerContent(fake, 'https://contoso.sharepoint.com/sites/Zorg/D/x.pptx', [{ present: ['new text'], absent: [] }], {
      sleep: async () => {},
    });
    expect(check).toMatchObject({ verified: [true], timedOut: false, info: { version: '19.0' } });
    expect(downloads).toBe(2);
  });
});
