import { describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { applyPrune, exportedTickets, formatBytes, planPrune } from './prune.js';

function ticket(root: string, key: string, body = '', extra: Record<string, string> = {}) {
  const dir = path.join(root, key.toLowerCase());
  mkdirSync(path.join(dir, 'attachments'), { recursive: true });
  writeFileSync(path.join(dir, 'task.md'), `---\nkey: "${key}"\nstatus: "Resolved"\n---\n\n# ${key}\n\n${body}\n`);
  writeFileSync(path.join(dir, '.task.previous.md'), 'old');
  writeFileSync(path.join(dir, 'attachments', 'shot.png'), 'x'.repeat(100));
  for (const [name, content] of Object.entries(extra)) writeFileSync(path.join(dir, name), content);
}

function page(root: string, dir: string, body = '') {
  const p = path.join(root, 'confluence', dir);
  mkdirSync(path.join(p, 'attachments'), { recursive: true });
  writeFileSync(path.join(p, 'page.md'), `---\nconfluence:\n  id: "${dir.split('-')[0]}"\n  title: "Page ${dir}"\n---\n\n${body}\n`);
  writeFileSync(path.join(p, 'attachments', 'big.csv'), 'y'.repeat(1000));
}

const link = (dir: string) => `[spec](../confluence/${dir}/page.md)`;
const pageLink = (dir: string) => `[other](../${dir}/page.md)`;

function setup() {
  const root = mkdtempSync(path.join(tmpdir(), 'jirallm-prune-'));
  page(root, '1-only-done', pageLink('2-nested'));
  page(root, '2-nested');
  page(root, '3-shared');
  page(root, '4-standalone');
  page(root, '5-via-open-page');
  page(root, '6-open-root', pageLink('5-via-open-page'));
  ticket(root, 'ZOD-1', `${link('1-only-done')} ${link('3-shared')} ${link('5-via-open-page')}`, { 'context.md': 'mine' });
  ticket(root, 'ZOD-2', `${link('3-shared')} ${link('6-open-root')}`);
  return root;
}

describe('exportedTickets', () => {
  it('reads key and status from task.md', () => {
    const root = setup();
    expect(exportedTickets(root).map((t) => [t.key, t.dir, t.status]).sort()).toEqual([
      ['ZOD-1', 'zod-1', 'Resolved'],
      ['ZOD-2', 'zod-2', 'Resolved'],
    ]);
  });
});

describe('planPrune', () => {
  it('prunes the finished ticket and pages only it reaches, keeping own files and shared or standalone pages', () => {
    const root = setup();
    const plan = planPrune(root, new Set(['ZOD-1']));
    expect(plan.tickets.map((t) => [t.key, t.kept])).toEqual([['ZOD-1', ['context.md']]]);
    // 2-nested is reached only through page 1, so it goes with it.
    expect(plan.pages.map((p) => p.dir)).toEqual(['1-only-done', '2-nested']);
    expect(plan.bytes).toBeGreaterThan(1000);
  });

  it('keeps a page reachable from a remaining ticket through another page', () => {
    const root = setup();
    expect(planPrune(root, new Set(['ZOD-1'])).pages.map((p) => p.dir)).not.toContain('5-via-open-page');
  });

  it('prunes shared pages once every ticket linking them is finished', () => {
    const root = setup();
    expect(planPrune(root, new Set(['ZOD-1', 'ZOD-2'])).pages.map((p) => p.dir)).toEqual([
      '1-only-done',
      '2-nested',
      '3-shared',
      '5-via-open-page',
      '6-open-root',
    ]);
  });

  it('plans nothing when no ticket is finished', () => {
    const root = setup();
    expect(planPrune(root, new Set())).toEqual({ tickets: [], pages: [], bytes: 0 });
  });
});

describe('applyPrune', () => {
  it('removes export files, keeps own files, and removes folders left empty', () => {
    const root = setup();
    applyPrune(root, planPrune(root, new Set(['ZOD-1', 'ZOD-2'])));
    expect(existsSync(path.join(root, 'zod-1', 'task.md'))).toBe(false);
    expect(existsSync(path.join(root, 'zod-1', 'attachments'))).toBe(false);
    expect(existsSync(path.join(root, 'zod-1', 'context.md'))).toBe(true);
    expect(existsSync(path.join(root, 'zod-2'))).toBe(false);
    expect(existsSync(path.join(root, 'confluence', '3-shared'))).toBe(false);
    expect(existsSync(path.join(root, 'confluence', '4-standalone', 'page.md'))).toBe(true);
    expect(existsSync(path.join(root, 'confluence', '2-nested'))).toBe(false);
  });
});

describe('formatBytes', () => {
  it.each([
    [512, '512 B'],
    [2048, '2 KB'],
    [5 * 1024 * 1024, '5.0 MB'],
  ])('%d → %s', (n, s) => {
    expect(formatBytes(n)).toBe(s);
  });
});
