import { describe, expect, it } from 'vitest';
import { asciiHtml } from '../cli/commands/slackCopy.js';
import { cfHtml, inlineHtml, normalizeTerminalText, toSlackHtml, toSlackText } from './slackFormat.js';

const BOX = [
  '● Assign to Trang:',
  '',
  '  ┌──────────────────┬──────────┬────────────────────┐',
  '  │      Ticket      │ Priority │        Why         │',
  '  ├──────────────────┼──────────┼────────────────────┤',
  '  │ ZOD-1: route     │ Blocker  │ Money moves.       │',
  '  │ claims (PR #12)  │          │ Check it.          │',
  '  ├──────────────────┼──────────┼────────────────────┤',
  '  │ ZOD-2: privacy   │ —        │ Someone else <b>.  │',
  '  └──────────────────┴──────────┴────────────────────┘',
  '',
  '  Not part of this:',
  '  - ZOD-3 is in **Test**.',
  '    It is approved.',
  '  - ZOD-4 see [the PR](https://github.com/o/r/pull/4)',
].join('\n');

describe('toSlackText', () => {
  it('turns a box table into one bullet per row, joining cells that wrap over lines', () => {
    expect(toSlackText(BOX)).toBe(
      [
        'Assign to Trang:',
        '',
        '• *ZOD-1: route claims (PR #12)* — Blocker — Money moves. Check it.',
        '• *ZOD-2: privacy* — Someone else <b>.',
        '',
        'Not part of this:',
        '',
        '• ZOD-3 is in *Test*. It is approved.',
        '• ZOD-4 see the PR (https://github.com/o/r/pull/4)',
      ].join('\n')
    );
  });

  it('handles markdown pipe tables, headings and code blocks', () => {
    const md = '# Plan\n\n| Key | Why |\n|-----|-----|\n| ZOD-1 | **risky** |\n\n```\nnpm test\n```';
    expect(toSlackText(md)).toBe('*Plan*\n\n• *ZOD-1* — *risky*\n\n```\nnpm test\n```');
  });
});

describe('toSlackHtml', () => {
  it('renders rows as bold-led list items and escapes text', () => {
    const html = toSlackHtml(BOX);
    expect(html).toContain('<li><b>ZOD-1: route claims (PR #12)</b> — Blocker — Money moves. Check it.</li>');
    expect(html).toContain('<li><b>ZOD-2: privacy</b> — Someone else &lt;b&gt;.</li>');
    expect(html).toContain('<li>ZOD-4 see <a href="https://github.com/o/r/pull/4">the PR</a></li>');
    expect(html).not.toContain('Ticket');
  });

  it('nests indented list items', () => {
    expect(toSlackHtml('- a\n  - b\n- c')).toBe('<ul><li>a<ul><li>b</li></ul></li><li>c</li></ul>');
  });
});

describe('inline and terminal details', () => {
  it('keeps code spans untouched and links bare URLs', () => {
    expect(inlineHtml('run `a **b**` at https://x.io/p')).toBe('run <code>a **b**</code> at <a href="https://x.io/p">https://x.io/p</a>');
  });

  it('drops the reply marker and the common indent', () => {
    expect(normalizeTerminalText('\n● First\n  second\n    deeper\n')).toEqual(['First', 'second', '  deeper']);
  });

  it('builds CF_HTML whose offsets point at the fragment', () => {
    const fragment = asciiHtml('<p>a → b</p>');
    expect(fragment).toBe('<p>a &#8594; b</p>');
    const clip = cfHtml(fragment);
    const at = (name: string) => Number(new RegExp(`${name}:(\\d+)`).exec(clip)![1]);
    expect(clip.slice(at('StartFragment'), at('EndFragment'))).toBe(fragment);
    expect(clip.slice(at('StartHTML'), at('EndHTML'))).toMatch(/^<html>.*<\/html>$/);
  });
});
