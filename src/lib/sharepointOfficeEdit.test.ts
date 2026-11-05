import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describeEditResults, editPowerPoint, parseEditReport, validateEdits } from './sharepointOfficeEdit.js';
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
      writeFileSync(join(dir, 'notes.md'), '﻿Line one\r\nLine two\r\n');
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

describe('parseEditReport / describeEditResults', () => {
  it('restores a collapsed results list and reports verification', () => {
    const report = parseEditReport({
      wasOpen: false,
      fullName: 'https://contoso.sharepoint.com/sites/a/Shared Documents/d.pptx',
      results: { slide: 10, target: 'shape:TextBox 18', before: 'old', after: 'new\nline', verified: true },
    });
    expect(report.results).toHaveLength(1);
    expect(describeEditResults(report)).toBe(
      ['slide 10 TextBox 18: ✓ verified on SharePoint', '  - old', '  + new', '  + line', 'Saved to SharePoint and verified by reopening (https://contoso.sharepoint.com/sites/a/Shared Documents/d.pptx).'].join('\n')
    );
  });

  it('flags a change that is missing after reopening, and describes dry runs and open windows', () => {
    const failed = parseEditReport({ wasOpen: false, fullName: 'u', results: [{ slide: null, target: 'find', before: 'a', after: 'b', count: 2, verified: false }] });
    expect(describeEditResults(failed)).toContain('all slides: "a" → "b" (2 time(s)) ✗ NOT found after reopening');
    expect(describeEditResults(failed)).toContain('Saved, but not every change was found after reopening');
    const dry = parseEditReport({ wasOpen: false, fullName: 'u', results: [{ slide: 3, target: 'notes', before: 'same', after: 'same' }] });
    expect(describeEditResults(dry, true)).toBe('slide 3 notes:\n  (unchanged)\nDry run: nothing changed.');
    const open = parseEditReport({ wasOpen: true, fullName: 'u', results: [] });
    expect(describeEditResults(open)).toContain('Changed in your open PowerPoint window');
  });
});
