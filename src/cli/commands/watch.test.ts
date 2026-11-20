import { describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { changeEntries, changesReport, commentsChangedSince, concerns, describeChange, followedSlackThreads, frontmatter, prChanges, slackChanges, unseenCount } from './watch.js';
import type { SlackClient } from '../../lib/slack.js';

const task = (status: string, comments: string) =>
  `---\nkey: "ZOD-1"\nstatus: "${status}"\nupdatedAt: "2026-10-22T04:35:11.422+0200"\n---\n\n# ZOD-1\n\n## Description\n\nSame.\n\n## Comments\n\n${comments}\n`;

describe('frontmatter', () => {
  it('reads top-level and nested keys without quotes', () => {
    expect(frontmatter('---\nconfluence:\n  id: "42"\n  version: 3\n---\n# x')).toEqual({ id: '42', version: '3' });
  });
});

describe('describeChange', () => {
  it('names a new file', () => {
    expect(describeChange(null, task('To Do', ''))).toBe('new');
  });

  it('lists changed fields and sections, ignoring updatedAt', () => {
    expect(describeChange(task('To Do', 'a'), task('In Progress', 'a\nb').replace('04:35', '05:00'))).toBe(
      'status: To Do → In Progress; Comments changed'
    );
  });

  it('says what happened to comments, also when they sit in History next to status changes', () => {
    const doc = (count: number, history: string, at = '05:34') =>
      `---\nkey: "ZOD-9"\nupdatedAt: "2026-11-12T${at}:11+0100"\ncommentsUpdatedAt: "2026-11-12T${at}:11+0100"\ncommentCount: ${count}\n---\n\n# ZOD-9\n\n## History\n\n${history}\n`;
    const status = '[STATUS CHANGE] Ann — 11/12/2026: To Do → In Progress';
    const comment = (who: string, text: string) => `---\n[COMMENT] ${who} — 11/12/2026, 11:35:19 AM:\n${text}`;
    // A new comment (the real ZOD-4180 e2e case logged "History changed").
    expect(describeChange(doc(0, status), doc(1, `${status}\n${comment('Hung Duong Quang', 'hi')}`, '05:35'))).toBe('1 new comment (Hung Duong Quang)');
    expect(describeChange(doc(1, comment('Ann', 'a')), doc(0, '', '05:36'))).toBe('1 comment deleted');
    expect(describeChange(doc(1, comment('Ann', 'a')), doc(1, comment('Ann', 'b'), '05:40'))).toBe('comment edited');
    // A status change in History is still named.
    expect(describeChange(doc(0, ''), doc(1, `${status}\n${comment('Bo', 'x')}`, '05:35'))).toBe('1 new comment (Bo); History changed');
  });

  it('marks added and removed fields with ∅', () => {
    expect(describeChange(task('To Do', 'a'), task('To Do', 'a').replace('status: "To Do"\n', 'status: "To Do"\nlabels: ["X"]\n'))).toBe(
      'labels: ∅ → ["X"]'
    );
  });
});

describe('changeEntries', () => {
  it('splits CHANGES.md into stamped entries with their list lines', () => {
    expect(changeEntries('\n## 2026-10-22 10:00\n\n- ZOD-1: new\n- ZOD-2: status: A → B\n\n## 2026-10-22 10:15\n\n- ZOD-1: Comments changed\n')).toEqual([
      { stamp: '2026-10-22 10:00', lines: ['- ZOD-1: new', '- ZOD-2: status: A → B'] },
      { stamp: '2026-10-22 10:15', lines: ['- ZOD-1: Comments changed'] },
    ]);
  });
});

describe('commentsChangedSince', () => {
  const issue = (...updated: string[]) => ({
    key: 'ZOD-1',
    fields: { comment: { comments: updated.map((u) => ({ created: '2026-10-26T09:00:00.000+0100', updated: u })) } },
  });

  it('flags a comment edited after the export, although the issue updated did not move', () => {
    const known = { key: 'ZOD-1', updatedAt: '2026-10-27T04:58:01.948+0100' };
    expect(commentsChangedSince(known, issue('2026-10-27T05:06:14.152+0100'))).toBe(true);
  });

  it('compares with commentsUpdatedAt when the export has it', () => {
    const known = {
      key: 'ZOD-1',
      updatedAt: '2026-10-27T04:00:00.000+0100',
      commentsUpdatedAt: '2026-10-27T05:29:40.860+0100',
    };
    expect(commentsChangedSince(known, issue('2026-10-27T05:29:40.860+0100', '2026-10-26T10:00:00.000+0100'))).toBe(false);
    expect(commentsChangedSince(known, issue('2026-10-27T06:29:40.860+0200'))).toBe(false);
  });

  it('ignores issues without comments', () => {
    expect(commentsChangedSince({ key: 'ZOD-1', updatedAt: '2026-10-27T04:00:00.000+0100' }, { key: 'ZOD-1', fields: {} })).toBe(false);
  });
});

describe('commentsChangedSince: deletions', () => {
  const comments = (n: number) => ({
    key: 'ZOD-1',
    fields: {
      comment: {
        total: n,
        comments: Array.from({ length: n }, () => ({ created: '2026-10-26T09:00:00.000+0100', updated: '2026-10-26T09:00:00.000+0100' })),
      },
    },
  });
  const known = { key: 'ZOD-1', updatedAt: '2026-10-27T05:00:00.000+0100', commentCount: 4 };

  it('flags a deleted comment by the lower count', () => {
    expect(commentsChangedSince(known, comments(3))).toBe(true);
  });

  it('flags the last comment being deleted', () => {
    expect(commentsChangedSince({ ...known, commentCount: 1 }, comments(0))).toBe(true);
  });

  it('does not flag an unchanged count, nor exports without commentCount', () => {
    expect(commentsChangedSince(known, comments(4))).toBe(false);
    expect(commentsChangedSince({ key: 'ZOD-1', updatedAt: known.updatedAt }, comments(3))).toBe(false);
  });
});

describe('prChanges', () => {
  const none = { keys: [], prs: [] };
  const view = (failed: boolean) => JSON.stringify({
    number: 7, title: 'ZOD-1: x', url: 'https://github.com/o/r/pull/7', state: 'OPEN', isDraft: false, mergeable: 'MERGEABLE', reviewDecision: '',
    headRefName: 'feature/ZOD-1-x', baseRefName: 'main', headRefOid: 'h1', latestReviews: [], comments: [], commits: [{ committedDate: '2026-10-29T10:00:00Z' }],
    statusCheckRollup: [{ __typename: 'CheckRun', name: 'Unit', status: 'COMPLETED', conclusion: failed ? 'FAILURE' : 'SUCCESS' }],
  });
  const fakeGh = (opts: { failed: boolean; notifications: string }) => {
    const calls: string[] = [];
    const gh = (_cwd: string, args: string[]) => {
      calls.push(args.slice(0, 2).join(' '));
      if (args[0] === 'repo') return 'o/r';
      if (args[0] === 'api' && args[1] === '-i') return opts.notifications;
      if (args[0] === 'api') return JSON.stringify({ data: { viewer: { login: 'me' }, repository: { pullRequest: { reviewThreads: { nodes: [] } } } } });
      if (args[1] === 'list') return JSON.stringify([{ number: 7, headRefOid: 'h1', statusCheckRollup: JSON.parse(view(opts.failed)).statusCheckRollup }]);
      return view(opts.failed);
    };
    return { gh, calls };
  };

  it('reads a PR in full only when its checks changed or it got a notification', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'prs-'));
    const first = fakeGh({ failed: true, notifications: 'HTTP/2.0 200 OK\nLast-Modified: t1\n\n[]' });
    expect(prChanges('.', dir, false, first.gh, none).map((c) => c.line)).toEqual(['PR #7 (ZOD-1): CI failed: Unit — jirallm pr-status 7']);

    const quiet = fakeGh({ failed: true, notifications: 'HTTP/2.0 304 Not Modified\n\n' });
    expect(prChanges('.', dir, false, quiet.gh, none)).toEqual([]);
    expect(quiet.calls).toEqual(['api -i', 'pr list']);

    const green = fakeGh({ failed: false, notifications: 'HTTP/2.0 304 Not Modified\n\n' });
    expect(prChanges('.', dir, false, green.gh, none)).toEqual([{ line: 'PR #7 (ZOD-1): CI green — jirallm pr-status 7', url: 'https://github.com/o/r/pull/7' }]);

    const review = fakeGh({ failed: false, notifications: 'HTTP/2.0 200 OK\nLast-Modified: t2\n\n[{"repository":{"full_name":"o/r"},"subject":{"type":"PullRequest","url":"https://api.github.com/repos/o/r/pulls/7"}}]' });
    prChanges('.', dir, false, review.gh, none);
    expect(review.calls).toContain('pr view');
  });
});

describe('prChanges for PRs a running session reviews', () => {
  const rollup = [{ __typename: 'CheckRun', name: 'Unit', status: 'COMPLETED', conclusion: 'SUCCESS' }];
  const view = (n: number, title: string, branch: string, state = 'OPEN') => JSON.stringify({
    number: n, title, url: `https://github.com/o/r/pull/${n}`, state, isDraft: false, mergeable: 'MERGEABLE', reviewDecision: '',
    headRefName: branch, baseRefName: 'main', headRefOid: 'h1', latestReviews: [], comments: [], commits: [{ committedDate: '2026-10-29T10:00:00Z' }],
    statusCheckRollup: rollup,
  });
  const others = [
    { number: 8, title: 'ZOD-2: theirs', headRefName: 'feature/ZOD-2-x' },
    { number: 9, title: 'Bump deps', headRefName: 'deps' },
    { number: 10, title: 'Unrelated', headRefName: 'feature/ZOD-3-y' },
  ];
  const fakeGh = (states: Record<number, string> = {}) => {
    const calls: string[] = [];
    const gh = (_cwd: string, args: string[]) => {
      calls.push(args.join(' '));
      if (args[0] === 'repo') return 'o/r';
      if (args[0] === 'api' && args[1] === '-i') return 'HTTP/2.0 304 Not Modified' + String.fromCharCode(10).repeat(2);
      if (args[0] === 'api') return JSON.stringify({ data: { viewer: { login: 'me' }, repository: { pullRequest: { reviewThreads: { nodes: [] } } } } });
      if (args[1] === 'list' && args.includes('--author')) return '[]';
      if (args[1] === 'list') return JSON.stringify(others.map((p) => ({ ...p, headRefOid: 'h1', statusCheckRollup: rollup })));
      const n = Number(args[2]);
      const p = others.find((o) => o.number === n)!;
      if (args.includes('state')) return JSON.stringify({ state: states[n] ?? 'OPEN' });
      return view(n, p.title, p.headRefName, states[n]);
    };
    return { gh, calls };
  };

  it('follows the PRs of the sessions tickets and the PRs they named, and drops them quietly when the session ends', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'prs-'));
    const a = fakeGh();
    // First sight of a green PR is no change, but #8 (key ZOD-2) and #9 (named) are now followed; #10 is not.
    expect(prChanges('.', dir, false, a.gh, { keys: ['ZOD-2'], prs: [9] })).toEqual([]);
    // The open-PR list asks for no checks (GitHub timed out on checks of every open PR); only #8 and #9 get theirs.
    expect(a.calls.filter((c) => c.startsWith('pr list --state open'))).toEqual(['pr list --state open --json number,title,headRefName --limit 200']);
    const views = a.calls.filter((c) => c.startsWith('pr view'));
    expect(views.filter((c) => c.endsWith('--json headRefOid,statusCheckRollup'))).toEqual(['pr view 8 --json headRefOid,statusCheckRollup', 'pr view 9 --json headRefOid,statusCheckRollup']);
    expect(views.filter((c) => !c.endsWith('--json headRefOid,statusCheckRollup')).map((c) => c.split(' ')[2])).toEqual(['8', '9']);
    expect(Object.keys(JSON.parse(readFileSync(path.join(dir, '.prs.json'), 'utf8')).prs)).toEqual(['8', '9']);

    // The session ended: PR #8 is still open, so nothing is reported; a merged PR #9 is.
    expect(prChanges('.', dir, false, fakeGh({ 9: 'MERGED' }).gh, { keys: [], prs: [] }).map((c) => c.line)).toEqual(['PR #9: merged']);
    // Kept as finished, so the sessions that followed it drop it later.
    expect(JSON.parse(readFileSync(path.join(dir, '.prs.json'), 'utf8')).finished).toEqual({ 9: 'merged' });
  });

  it("checks my PRs even when GitHub fails on others' PRs, which keep their state", () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'prs-'));
    expect(prChanges('.', dir, false, fakeGh().gh, { keys: ['ZOD-2'], prs: [] })).toEqual([]);
    const busy = fakeGh();
    const gh = (cwd: string, args: string[]) => {
      if (args[1] === 'list' && !args.includes('--author')) {
        throw Object.assign(new Error('Command failed: gh pr list --state open'), { stderr: 'HTTP 504: 504 Gateway Timeout (https://api.github.com/graphql)\n' });
      }
      return busy.gh(cwd, args);
    };
    expect(prChanges('.', dir, false, gh, { keys: ['ZOD-2'], prs: [] })).toEqual([
      { line: 'PRs followed by sessions: gh failed (HTTP 504: 504 Gateway Timeout (https://api.github.com/graphql))', error: true },
    ]);
    expect(busy.calls.some((c) => c.startsWith('pr list --author @me'))).toBe(true);
    expect(Object.keys(JSON.parse(readFileSync(path.join(dir, '.prs.json'), 'utf8')).prs)).toEqual(['8']);
  });

  it('makes no extra call while no session follows anything', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'prs-'));
    const a = fakeGh();
    prChanges('.', dir, false, a.gh, { keys: [], prs: [] });
    expect(a.calls.filter((c) => c.startsWith('pr list'))).toHaveLength(1);
  });

  it('matches the change lines of a named PR', () => {
    expect(concerns('PR #9: CI green', ['pr/9'])).toBe(true);
    expect(concerns('PR #90: CI green', ['pr/9'])).toBe(false);
  });
});

describe('slackChanges', () => {
  const thread = (lastReplyAt: string, lastTs: string) =>
    `---\nslack:\n  title: "T"\n  lastReplyAt: "${lastReplyAt}"\n  lastTs: "${lastTs}"\n  url: "https://ws.slack.com/archives/C1/p1793000000000100"\n---\n# x\n`;

  it('asks only for replies after the export and skips threads idle for 14 days', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'slackwatch-'));
    const now = Date.parse('2026-11-02T10:00:00Z');
    mkdirSync(path.join(dir, 'slack', 'c1-1793000000000100'), { recursive: true });
    writeFileSync(path.join(dir, 'slack', 'c1-1793000000000100', 'thread.md'), thread('2026-11-01T10:00:00Z', '1793000500.000100'));
    mkdirSync(path.join(dir, 'slack', 'c1-1790000000000100'), { recursive: true });
    writeFileSync(path.join(dir, 'slack', 'c1-1790000000000100', 'thread.md'), thread('2026-10-01T10:00:00Z', '1790000500.000100'));
    const calls: Record<string, string>[] = [];
    const client = {
      call: async (_m: string, params: Record<string, string>) => {
        calls.push(params);
        return { ok: true, messages: [{ ts: '1793000000.000100' }, { ts: '1793000600.000100' }] };
      },
    } as unknown as SlackClient;
    const changes = await slackChanges(dir, true, client, now);
    expect(calls).toEqual([{ channel: 'C1', ts: '1793000000.000100', oldest: '1793000500.000100', inclusive: 'false', limit: '50' }]);
    expect(changes).toEqual([{ line: 'slack/c1-1793000000000100: would re-export (new replies)', url: 'https://ws.slack.com/archives/C1/p1793000000000100' }]);
  });

  it('reports nothing when only the parent comes back', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'slackwatch-'));
    mkdirSync(path.join(dir, 'slack', 'c1-1793000000000100'), { recursive: true });
    writeFileSync(path.join(dir, 'slack', 'c1-1793000000000100', 'thread.md'), thread('2026-11-01T10:00:00Z', '1793000500.000100'));
    const client = { call: async () => ({ ok: true, messages: [{ ts: '1793000000.000100' }] }) } as unknown as SlackClient;
    expect(await slackChanges(dir, false, client, Date.parse('2026-11-02T10:00:00Z'))).toEqual([]);
  });

  it('reads a short thread whole in the same one call and notices edits and deletions, not bot edits', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'slackwatch-'));
    const file = path.join(dir, 'slack', 'c1-1793000000000100', 'thread.md');
    mkdirSync(path.dirname(file), { recursive: true });
    const withCount = (extra: string) => thread('2026-11-01T10:00:00Z', '1793000500.000100').replace('  url:', `  messages: 3\n${extra}  url:`);
    const parent = { ts: '1793000000.000100' };
    let messages: Record<string, unknown>[] = [parent, { ts: '1793000400.000100' }, { ts: '1793000500.000100' }];
    const calls: Record<string, string>[] = [];
    const client = { call: async (_m: string, p: Record<string, string>) => (calls.push(p), { ok: true, messages }) } as unknown as SlackClient;
    const at = Date.parse('2026-11-02T10:00:00Z');

    // Exported before edits were tracked: the first look only sets where edits start.
    writeFileSync(file, withCount(''));
    messages[1] = { ts: '1793000400.000100', edited: { ts: '1793000450.000000' } };
    expect(await slackChanges(dir, false, client, at)).toEqual([]);
    expect(calls).toEqual([{ channel: 'C1', ts: '1793000000.000100', limit: '200' }]);
    expect(readFileSync(file, 'utf8')).toContain('  lastEditTs: "1793000450.000000"');

    // A later edit by a person shows; one by a bot does not.
    messages = [parent, { ts: '1793000400.000100', edited: { ts: '1793000450.000000' } }, { ts: '1793000500.000100', edited: { ts: '1793000900.000000' }, bot_id: 'B1' }];
    expect(await slackChanges(dir, true, client, at)).toEqual([]);
    messages = [parent, { ts: '1793000400.000100', edited: { ts: '1793000950.000000' } }, { ts: '1793000500.000100' }];
    expect(await slackChanges(dir, true, client, at)).toEqual([
      { line: 'slack/c1-1793000000000100: would re-export (edited or deleted messages)', url: 'https://ws.slack.com/archives/C1/p1793000000000100' },
    ]);

    // One of the three exported messages gone.
    writeFileSync(file, withCount('  lastEditTs: "1793000950.000000"\n'));
    messages = [parent, { ts: '1793000500.000100' }];
    expect(await slackChanges(dir, true, client, at)).toHaveLength(1);
    messages = [parent, { ts: '1793000400.000100', edited: { ts: '1793000950.000000' } }, { ts: '1793000500.000100' }];
    expect(await slackChanges(dir, true, client, at)).toEqual([]);
    expect(calls).toHaveLength(5); // one call per check, never more
  });

  it('checks only the threads given (those running sessions follow) between full rounds', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'slackwatch-'));
    for (const t of ['c1-1793000000000100', 'c1-1793000000000200']) {
      mkdirSync(path.join(dir, 'slack', t), { recursive: true });
      writeFileSync(path.join(dir, 'slack', t, 'thread.md'), thread('2026-11-01T10:00:00Z', '1793000500.000100'));
    }
    const calls: Record<string, string>[] = [];
    const client = { call: async (_m: string, p: Record<string, string>) => (calls.push(p), { ok: true, messages: [] }) } as unknown as SlackClient;
    await slackChanges(dir, true, client, Date.parse('2026-11-02T10:00:00Z'), new Set(['c1-1793000000000200']));
    expect(calls).toHaveLength(1);
  });
});

describe('followedSlackThreads', () => {
  it('names the threads of running sessions only', () => {
    const sessions = mkdtempSync(path.join(tmpdir(), 'slackwatch-s-'));
    writeFileSync(path.join(sessions, 'live.follow'), 'slack/C1-17\npr/3\nrun/o/r/4');
    writeFileSync(path.join(sessions, 'live.monitor'), String(process.pid));
    writeFileSync(path.join(sessions, 'gone.follow'), 'slack/c2-18');
    expect([...followedSlackThreads(sessions)]).toEqual(['c1-17']);
  });
});

describe('changesReport', () => {
  it('with unseen, reports each entry once and moves the marker, so a follow loop never repeats', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'changes-'));
    const file = path.join(dir, 'CHANGES.md');
    writeFileSync(file, '\n## 2026-11-04 10:00\n\n- ZOD-1: status: To Do → In Progress\n');
    expect(changesReport(dir, true, 20)).toContain('- ZOD-1: status: To Do → In Progress (2026-11-04 10:00)');
    expect(changesReport(dir, true, 20)).toBeNull();
    writeFileSync(file, '\n## 2026-11-04 10:00\n\n- ZOD-1: status: To Do → In Progress\n\n## 2026-11-04 10:05\n\n- #12 ZOD-2: CI failed\n');
    const next = changesReport(dir, true, 20)!;
    expect(next).toContain('since 2026-11-04 10:00');
    expect(next).toContain('- #12 ZOD-2: CI failed (2026-11-04 10:05)');
    expect(next).not.toContain('ZOD-1');
    expect(changesReport(dir, false, 20)).toContain('ZOD-1');
  });
});

describe('changesReport per session', () => {
  const entry = (stamp: string, line: string) => `\n## ${stamp}\n\n- ${line}\n`;

  it('gives every session every change, not only the first one to look', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'changes-session-'));
    const file = path.join(dir, 'CHANGES.md');
    writeFileSync(file, entry('2026-11-09 10:00', 'ZOD-1: status: To Do → In Progress'));
    // Both sessions start after the first entry was seen by an earlier session.
    expect(changesReport(dir, true, 20)).toContain('ZOD-1');
    expect(changesReport(dir, true, 20, 'session-a')).toBeNull();
    expect(changesReport(dir, true, 20, 'session-b')).toBeNull();

    writeFileSync(file, entry('2026-11-09 10:00', 'ZOD-1: status: To Do → In Progress') + entry('2026-11-09 11:30', 'ZOD-2: Comments changed'));
    expect(unseenCount(dir, 'session-a')).toBe(1);
    expect(changesReport(dir, true, 20, 'session-a')).toContain('ZOD-2');
    expect(changesReport(dir, true, 20, 'session-a')).toBeNull();
    expect(unseenCount(dir, 'session-a')).toBe(0);
    // Session A moved the shared marker, yet B still gets the change.
    expect(unseenCount(dir, 'session-b')).toBe(1);
    expect(changesReport(dir, true, 20, 'session-b')).toContain('ZOD-2');
    // A new session starts from what the latest session saw.
    expect(changesReport(dir, true, 20, 'session-c')).toBeNull();
  });

  it('refuses a session id that could leave the marker folder', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'changes-session-'));
    writeFileSync(path.join(dir, 'CHANGES.md'), entry('2026-11-09 10:00', 'ZOD-1: x'));
    expect(() => changesReport(dir, true, 20, '../evil')).toThrow(/--session/);
  });
});
