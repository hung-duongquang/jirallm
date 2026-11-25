import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ciState, lastActiveBeforeGap, mailSections, resolveSince, slackLines, watchLogSection, type Mail } from './catchup.js';
import { stampOf } from './closedSessions.js';

const H = 3600_000;
const NOW = new Date(2026, 10, 25, 8, 21).getTime();

describe('catchup', () => {
  it('starts at the last prompt before the latest long gap, else a day back', () => {
    const fri = new Date(2026, 10, 20, 17, 30).getTime();
    expect(lastActiveBeforeGap([NOW - 60_000, fri, fri - 2 * H], NOW)).toBe(fri);
    expect(lastActiveBeforeGap([NOW - H, NOW - 2 * H], NOW)).toBeUndefined();
    const dir = mkdtempSync(path.join(tmpdir(), 'catchup-'));
    expect(resolveSince(undefined, dir, NOW)).toBe(NOW - 24 * H);
    writeFileSync(path.join(dir, 'a.last'), new Date(fri).toISOString());
    writeFileSync(path.join(dir, 'b.last'), new Date(NOW - 60_000).toISOString());
    expect(resolveSince(undefined, dir, NOW)).toBe(fri);
    expect(resolveSince('4d', dir, NOW)).toBe(NOW - 96 * H);
    expect(resolveSince('2026-11-20 10:04', dir, NOW)).toBe(new Date(2026, 10, 20, 10, 4).getTime());
    expect(() => resolveSince('last week', dir, NOW)).toThrow(/--since/);
  });

  it('sums up CI', () => {
    expect(ciState([])).toBe('no CI');
    expect(ciState([{ conclusion: 'SUCCESS' }, { conclusion: 'FAILURE' }])).toBe('**CI failed (1)**');
    expect(ciState([{ conclusion: 'SUCCESS' }, { status: 'IN_PROGRESS' }])).toBe('CI running');
    expect(ciState([{ conclusion: 'SUCCESS' }, { state: 'SUCCESS' }, { conclusion: 'SKIPPED' }])).toBe('CI green');
  });

  it('lists one line per Slack thread, newest first, without my own messages or older ones', () => {
    const since = NOW - 48 * H;
    const ts = (ms: number) => String(ms / 1000);
    const lines = slackLines(
      [
        { ts: ts(NOW - H), user: 'U1', username: 'trung', text: 'check comments <@ME>', permalink: 'https://x.slack.com/archives/C1/p1?thread_ts=100.1', channel: { id: 'C1', name: 'team' } },
        { ts: ts(NOW - 2 * H), user: 'U1', username: 'trung', text: 'also this', permalink: 'https://x.slack.com/archives/C1/p2?thread_ts=100.1', channel: { id: 'C1', name: 'team' } },
        { ts: ts(NOW - 3 * H), user: 'ME', username: 'me', text: 'mine', permalink: 'https://x.slack.com/archives/C1/p3', channel: { id: 'C1' } },
        { ts: ts(NOW - 5 * H), user: 'U2', username: 'anne', text: 'hi', permalink: 'https://x.slack.com/archives/D1/p4', channel: { id: 'D1', is_im: true } },
        { ts: ts(since - H), user: 'U2', username: 'anne', text: 'old', permalink: 'https://x.slack.com/archives/D1/p5', channel: { id: 'D1', is_im: true } },
      ],
      'ME',
      since
    );
    expect(lines).toHaveLength(3);
    expect(lines[0]).toMatch(/trung \*\*tagged you\*\* in #team: "check comments @…"/);
    expect(lines[1]).toMatch(/trung wrote in #team: "also this"/);
    expect(lines[2]).toMatch(/anne wrote in DM: "hi"/);
  });

  it('lists mail from people, unread to me first, and counts notifications per sender', () => {
    const mail = (m: Partial<Mail>): Mail => ({ subject: 's', from: 'Anne', received: new Date(NOW - H).toISOString(), unread: false, important: false, flagged: false, toMe: true, preview: '', ...m });
    const [people, bulk] = mailSections([
      mail({ subject: 'read one', unread: false }),
      mail({ subject: 'Planning', unread: true, important: true, preview: 'Hi Hung,\nCan you join?' }),
      mail({ from: 'Jira', subject: '[JIRA] ZOD-1', unread: true }),
      mail({ from: 'Jira', subject: '[JIRA] ZOD-2' }),
      mail({ from: 'GitHub', subject: 'PR' }),
    ]);
    expect(people.lines).toHaveLength(2);
    expect(people.lines[0]).toMatch(/Anne · unread, \*\*important\*\* · \*\*Planning\*\* · Can you join\?/);
    expect(bulk.lines).toEqual(['Jira: 2 (1 unread)', 'GitHub: 1']);
  });

  it('tells GitHub and Jira mail sent under a person\'s name apart, and folds repeated reminders', () => {
    const mail = (m: Partial<Mail>): Mail => ({ subject: 's', from: 'Anne', received: new Date(NOW - H).toISOString(), unread: false, important: false, flagged: false, toMe: true, preview: '', ...m });
    const [people, bulk] = mailSections([
      mail({ subject: '[topicushealthcare/zorgdeclaraties] ZOD-1: Fix (PR #3)' }),
      mail({ subject: 'Re: [topicushealthcare/zorgdeclaraties-skills] ZOD-2 (PR #4)', unread: true }),
      mail({ from: 'Phuong', subject: '[JIRA] Phuong assigned ZOD-5 to you' }),
      mail({ from: 'AFAS', subject: 'Signaal - Je hebt week 46 nog niet afgesloten', received: new Date(NOW - 2 * H).toISOString() }),
      mail({ from: 'AFAS', subject: 'Signaal - Je hebt week 47 nog niet afgesloten', unread: true }),
      mail({ from: 'Koen', subject: 'Release' }),
    ]);
    expect(people.lines).toHaveLength(2);
    expect(people.lines[0]).toMatch(/AFAS \(×2\) · unread · \*\*Signaal - Je hebt week 47/);
    expect(bulk.lines).toEqual(['GitHub: 2 (1 unread) — Anne 2', 'Jira: 1 — Phuong 1']);
  });

  it('lists the important watch lines since, newest per item, and counts the rest', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'catchup-log-'));
    mkdirSync(dir, { recursive: true });
    const since = NOW - 48 * H;
    writeFileSync(
      path.join(dir, 'CHANGES.md'),
      [
        `## ${stampOf(since - H)}`, '', '- PR #1 (ZOD-1): CI failed: old', '',
        `## ${stampOf(since + H)}`, '', '- PR #2 (ZOD-2): CI failed: build', '- ZOD-3: status: To Do → In Progress', '',
        `## ${stampOf(since + 2 * H)}`, '', '- PR #2 (ZOD-2): trung reviewed: APPROVED', '- ZOD-4: 1 new comment (Anne)', '',
      ].join('\n')
    );
    const s = watchLogSection(dir, since);
    expect(s.lines).toHaveLength(3);
    expect(s.lines[0]).toMatch(/PR #2 \(ZOD-2\): trung reviewed: APPROVED|ZOD-4: 1 new comment/);
    expect(s.lines.join('\n')).not.toMatch(/old|CI failed: build/);
    expect(s.lines.at(-1)).toMatch(/and 1 status/);
  });
});
