import { describe, expect, it } from 'vitest';
import { stretchTables } from './confluence.js';

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
