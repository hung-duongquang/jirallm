import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { changesReport, concerns } from './watch.js';

let dir: string;
const log = (entries: Array<[string, string[]]>) =>
  writeFileSync(path.join(dir, 'CHANGES.md'), `# Changes\n\n${entries.map(([stamp, lines]) => `## ${stamp}\n${lines.join('\n')}\n`).join('\n')}`);

beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), 'jirallm-focus-'));
  log([
    ['2026-11-11 09:31', ['- ZOD-4001: status: To Do → Code Review', '- ZOD-4082: Comments changed']],
    ['2026-11-11 09:33', ['- PR #3198 (ZOD-4001): copilot reviewed: COMMENTED — jirallm pr-status 3198', '- slack/c0-1: 1 new reply in "ZOD-4082 resend"']],
  ]);
});

describe('concerns', () => {
  it('matches whole keys only', () => {
    expect(concerns('- PR #3198 (ZOD-4001): x', ['ZOD-4001'])).toBe(true);
    expect(concerns('- ZOD-40011: x', ['ZOD-4001'])).toBe(false);
    expect(concerns('- XZOD-4001: x', ['ZOD-4001'])).toBe(false);
    expect(concerns('- ZOD-4001: x', [])).toBe(false);
  });
});

describe('changes focused on a session', () => {
  it('prints the session tickets in full and others as one line of names', () => {
    const report = changesReport(dir, true, 20, 's1', { keys: ['ZOD-4082'] })!;
    expect(report).toContain("Changes to this session's tickets (ZOD-4082");
    expect(report).toContain('- ZOD-4082: Comments changed');
    expect(report).toContain('- slack/c0-1: 1 new reply in "ZOD-4082 resend"');
    expect(report).not.toContain('copilot');
    expect(report).toMatch(/Other changes, not this session's tickets .*: ZOD-4001, PR #3198$/);
    expect(changesReport(dir, true, 20, 's1', { keys: ['ZOD-4082'] })).toBeNull();
  });

  it('gives a session without tickets only the line of names', () => {
    const report = changesReport(dir, true, 20, 's2', { keys: [] })!;
    expect(report.split('\n')).toHaveLength(1);
    expect(report).toContain('ZOD-4001, ZOD-4082, PR #3198, a Slack thread');
  });

  it('lets the monitor push only the session tickets, once, without repeating them on the next prompt', () => {
    const pushed = changesReport(dir, true, 20, 's3', { keys: ['ZOD-4001'], pushOnly: true })!;
    expect(pushed).toContain('- ZOD-4001: status');
    expect(pushed).toContain('PR #3198');
    expect(pushed).not.toContain('Other changes');
    expect(changesReport(dir, true, 20, 's3', { keys: ['ZOD-4001'], pushOnly: true })).toBeNull();
    const prompt = changesReport(dir, true, 20, 's3', { keys: ['ZOD-4001'] })!;
    expect(prompt).not.toContain('Changes to this session');
    expect(prompt).toContain('Other changes, not this session\'s tickets (only on request: `jirallm changes`): ZOD-4082, a Slack thread');
  });

  it('pushes nothing for a session without tickets', () => {
    expect(changesReport(dir, true, 20, 's4', { keys: [], pushOnly: true })).toBeNull();
  });
});
