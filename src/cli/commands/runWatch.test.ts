import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { runChanges, runItems } from './runWatch.js';
import { concerns } from './watch.js';

const ITEM = 'run/topicus/aws/44';

/** A fake `gh api` answering for one run whose state the test changes between rounds. */
function fakeGh() {
  const state = {
    run: { status: 'waiting', conclusion: null as string | null, display_title: 'rolt uit naar productie', html_url: 'https://github.com/topicus/aws/actions/runs/44' },
    approvals: [] as unknown[],
    jobs: [] as unknown[],
    calls: 0,
  };
  const gh = (_cwd: string, args: string[]) => {
    state.calls++;
    const p = args[1]!;
    if (p.endsWith('/approvals')) return JSON.stringify(state.approvals);
    if (p.endsWith('/pending_deployments')) return JSON.stringify([{ environment: { name: 'productie' } }]);
    if (p.includes('/jobs')) return JSON.stringify({ jobs: state.jobs });
    return JSON.stringify(state.run);
  };
  return { state, gh };
}

describe('runItems', () => {
  it('names the Actions runs linked in a text', () => {
    expect(runItems('<https://github.com/topicus/aws/actions/runs/44|rolt uit> and github.com/o/r/actions/runs/7/job/1, again https://github.com/topicus/aws/actions/runs/44')).toEqual([
      ITEM,
      'run/o/r/7',
    ]);
  });
});

describe('runChanges', () => {
  it('reports waiting for approval, the approval, and the result, then stops asking', () => {
    const out = mkdtempSync(path.join(tmpdir(), 'jl-runs-'));
    const { state, gh } = fakeGh();
    const lines = () => runChanges(out, false, gh, [ITEM]).map((c) => c.line);

    expect(lines()).toEqual(['Run 44 (topicus/aws): waiting for approval (productie) — rolt uit naar productie']);
    expect(lines()).toEqual([]);

    state.run.status = 'in_progress';
    state.approvals = [{ state: 'approved', user: { login: 'trung' }, environments: [{ name: 'productie' }] }];
    expect(lines()).toEqual(['Run 44 (topicus/aws): approved by trung (productie), running — rolt uit naar productie']);

    state.run.status = 'completed';
    state.run.conclusion = 'failure';
    state.jobs = [{ name: 'deploy', conclusion: 'failure' }, { name: 'build', conclusion: 'success' }];
    const [failed] = lines();
    expect(failed).toBe('Run 44 (topicus/aws): failure: deploy — rolt uit naar productie');
    expect(concerns(failed!, [ITEM])).toBe(true);
    expect(concerns(failed!, ['run/topicus/aws/4'])).toBe(false);

    const before = state.calls;
    expect(lines()).toEqual([]);
    expect(state.calls).toBe(before);
  });

  it('asks nothing when no session follows a run', () => {
    const { state, gh } = fakeGh();
    expect(runChanges(mkdtempSync(path.join(tmpdir(), 'jl-runs-')), false, gh, [])).toEqual([]);
    expect(state.calls).toBe(0);
  });
});
