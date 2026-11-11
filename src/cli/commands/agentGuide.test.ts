import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AGENT_GUIDE, pluginSkillFiles, runAgentGuide } from './agentGuide.js';
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

  it('matches the plugin skill (run `pnpm build` to refresh skills/jirallm/)', () => {
    const files = pluginSkillFiles();
    for (const [file, text] of Object.entries(files)) {
      expect(readFileSync(path.join('skills/jirallm', file), 'utf8').replace(/\r\n/g, '\n'), file).toBe(text);
    }
    expect(readdirSync('skills/jirallm/references').map((f) => `references/${f}`).sort()).toEqual(Object.keys(files).filter((f) => f !== 'SKILL.md').sort());
  });

  it('splits the plugin skill into a short core and references, keeping every section', () => {
    const files = pluginSkillFiles();
    expect(files['SKILL.md']).toMatch(/^---\nname: jirallm\n/);
    expect(files['SKILL.md']!.length).toBeLessThan(AGENT_GUIDE.length / 2);
    expect(files['SKILL.md']).toContain('read `references/review.md`');
    const all = Object.values(files).join('\n');
    for (const heading of AGENT_GUIDE.match(/^## .+$/gm)!) expect(all, heading).toContain(heading);
    expect(files['references/sharepoint.md']).toContain('sharepoint:edit');
    expect(files['SKILL.md']).not.toContain('sharepoint:edit');
  });

  it('refuses a guide section without a place in the skill', () => {
    expect(() => pluginSkillFiles(`${AGENT_GUIDE}\n## Brand new section\n\ntext\n`)).toThrow(/Brand new section/);
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
