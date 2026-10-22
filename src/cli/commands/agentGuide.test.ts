import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AGENT_GUIDE, runAgentGuide } from './agentGuide.js';
import { tsvCell, toTsv } from './search.js';

afterEach(() => vi.restoreAllMocks());

describe('agent-guide', () => {
  it('is a valid skill: frontmatter with name and description', () => {
    expect(AGENT_GUIDE).toMatch(/^---\nname: jirallm\ndescription: .+\nmodel: sonnet\n---\n/);
  });

  it('installs as a Claude Code skill', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'jirallm-guide-'));
    vi.spyOn(console, 'log').mockImplementation(() => {});
    runAgentGuide({ install: dir });
    expect(readFileSync(path.join(dir, '.claude', 'skills', 'jirallm', 'SKILL.md'), 'utf8')).toBe(AGENT_GUIDE);
  });
});

describe('search --format tsv', () => {
  it('collapses nested values to one line', () => {
    expect(tsvCell({ key: 'ZOD-1', fields: {} })).toBe('ZOD-1');
    expect(tsvCell([{ name: 'Sprint 30' }, { name: 'Sprint 31' }])).toBe('Sprint 30, Sprint 31');
    expect(tsvCell('a\tb\nc')).toBe('a b c');
    expect(tsvCell(null)).toBe('');
  });

  it('prints a header and one line per row, columns in first-seen order', () => {
    const tsv = toTsv([
      { key: 'ZOD-1', summary: 'One', status: 'To Do' },
      { key: 'ZOD-2', summary: 'Two', assignee: 'Me' },
    ]);
    expect(tsv.split('\n')).toEqual([
      'key\tsummary\tstatus\tassignee',
      'ZOD-1\tOne\tTo Do\t',
      'ZOD-2\tTwo\t\tMe',
    ]);
  });
});
