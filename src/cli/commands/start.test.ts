import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/config.js', () => ({
  loadProfile: vi.fn(async () => ({
    config: { baseUrl: 'https://x', userEmail: 'u@x', projectKey: 'ZOD' },
    apiToken: 'tok',
  })),
  findOrgsByProjectKey: vi.fn(() => ['solo']),
  readConfig: vi.fn(() => ({ orgs: { solo: { base_url: 'https://x' } } })),
}));

const calls: string[] = [];
const fetchIssueRawMock = vi.fn();
const assignIssueMock = vi.fn(async () => { calls.push('assign'); });
const transitionIssueMock = vi.fn(async () => { calls.push('transition'); return { id: '1', name: 'Start' }; });
const getCurrentUserMock = vi.fn(async () => ({ accountId: 'acc-1', displayName: 'Me' }));
vi.mock('../../lib/jiraClient.js', () => ({
  JiraClient: class {
    fetchIssueRaw = fetchIssueRawMock;
    assignIssue = assignIssueMock;
    transitionIssue = transitionIssueMock;
    getCurrentUser = getCurrentUserMock;
  },
}));

import { branchName, runStart, slugify, worktreePath, type StartDeps } from './start.js';

let logs: string[];
let deps: StartDeps;

beforeEach(() => {
  logs = [];
  calls.length = 0;
  vi.spyOn(console, 'log').mockImplementation((...a) => { logs.push(a.map(String).join(' ')); });
  fetchIssueRawMock.mockReset().mockResolvedValue({
    key: 'ZOD-3775',
    fields: { summary: 'BE - Journal entries overview (data model)', status: { name: 'To Do' } },
  });
  assignIssueMock.mockClear();
  transitionIssueMock.mockClear();
  deps = {
    run: vi.fn((_cmd: string, args: string[]) => { calls.push(`git ${args[2]}`); }),
    exportIssue: vi.fn(() => { calls.push('export'); }),
  };
});

afterEach(() => vi.restoreAllMocks());

describe('slugify', () => {
  it('lowercases, drops punctuation and accents', () => {
    expect(slugify('FE - Filter “Geen uitbetaling” and new permission')).toBe('fe-filter-geen-uitbetaling-and-new-permission');
    expect(slugify('Patiëntfactuur (motor)')).toBe('patientfactuur-motor');
  });

  it('cuts at a word boundary', () => {
    expect(slugify('alpha beta gamma', 10)).toBe('alpha-beta');
  });

  it('builds the branch and worktree path', () => {
    expect(branchName('feature', 'ZOD-1', 'x')).toBe('feature/ZOD-1-x');
    expect(worktreePath('C:/w', 'ZOD-3775')).toBe(path.join('C:/w', '3775'));
  });
});

describe('runStart', () => {
  it('only prints the plan on --dry-run', async () => {
    await runStart('ZOD-3775', { repo: 'repo', worktreeRoot: 'C:/w', dryRun: true }, deps);
    expect(logs.join('\n')).toContain('feature/ZOD-3775-be-journal-entries-overview-data-model');
    expect(calls).toEqual([]);
    expect(assignIssueMock).not.toHaveBeenCalled();
  });

  it('exports, creates the worktree, then assigns and transitions', async () => {
    await runStart('ZOD-3775', { repo: 'repo', worktreeRoot: 'C:/no-such-root' }, deps);
    expect(calls).toEqual(['export', 'git fetch', 'git worktree', 'assign', 'transition']);
    expect(deps.run).toHaveBeenCalledWith('git', [
      '-C', path.resolve('repo'), 'worktree', 'add', '--no-track', '-b',
      'feature/ZOD-3775-be-journal-entries-overview-data-model', path.join('C:/no-such-root', '3775'), 'origin/main',
    ]);
    expect(transitionIssueMock).toHaveBeenCalledWith('ZOD-3775', 'In Progress');
  });

  it('leaves Jira untouched when git fails', async () => {
    deps.run = vi.fn(() => { throw new Error('git failed'); });
    await expect(runStart('ZOD-3775', { repo: 'repo', worktreeRoot: 'C:/no-such-root' }, deps)).rejects.toThrow('git failed');
    expect(assignIssueMock).not.toHaveBeenCalled();
    expect(transitionIssueMock).not.toHaveBeenCalled();
  });

  it('skips the transition when the issue is already in the target status', async () => {
    fetchIssueRawMock.mockResolvedValue({ key: 'ZOD-1', fields: { summary: 's', status: { name: 'In Progress' } } });
    await runStart('ZOD-1', { export: false, assign: false }, deps);
    expect(transitionIssueMock).not.toHaveBeenCalled();
    expect(logs.join('\n')).toContain('already In Progress');
  });
});
