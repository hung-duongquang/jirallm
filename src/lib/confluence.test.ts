import { describe, expect, it } from 'vitest';
import { stretchTables, toCql, widenColumn } from './confluence.js';

describe('stretchTables', () => {
  it('gives every bare table the full page width', () => {
    const out = stretchTables('<table><tbody><tr><td>a</td></tr></tbody></table><p>x</p><table><tbody></tbody></table>');
    expect(out.match(/<table data-layout="full-width" class="relative-table" style="width: 100.0%;">/g)).toHaveLength(2);
    expect(out).not.toContain('<table>');
  });

  it('leaves tables that already carry attributes alone', () => {
    const table = '<table class="wrapped"><tbody></tbody></table>';
    expect(stretchTables(table)).toBe(table);
  });
});

describe('toCql', () => {
  it('turns plain words into a full-text search over pages', () => {
    expect(toCql('test rapport')).toBe('text ~ "test rapport" AND type in (page, blogpost, whiteboard)');
  });

  it('escapes quotes in plain words', () => {
    expect(toCql('say "hi"')).toBe('text ~ "say \\"hi\\"" AND type in (page, blogpost, whiteboard)');
  });

  it('keeps real CQL as is', () => {
    expect(toCql(' title ~ "ZOD-1" ')).toBe('title ~ "ZOD-1"');
  });

  it('adds the space filter before ORDER BY', () => {
    expect(toCql('title ~ "x" ORDER BY lastmodified DESC', 'ZOD')).toBe(
      '(title ~ "x") AND space = "ZOD" ORDER BY lastmodified DESC'
    );
  });
});

describe('widenColumn', () => {
  it('gives the labelled column its share and splits the rest over the others', () => {
    const table = '<table><tbody><tr><th>ID</th><th>Title</th><th><strong>Evidence</strong></th></tr><tr><td>1</td><td>t</td><td>e</td></tr></tbody></table>';
    expect(widenColumn(`${table}<table><tbody><tr><th>Jira</th></tr></tbody></table>`, 'Evidence', 40)).toBe(
      '<table><colgroup><col style="width: 30.0%;" /><col style="width: 30.0%;" /><col style="width: 40.0%;" /></colgroup>'
        + table.slice('<table>'.length) + '<table><tbody><tr><th>Jira</th></tr></tbody></table>'
    );
  });
});
