import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { SlackClient, SlackMessage } from '../../lib/slack.js';
import { concerns } from './watch.js';
import { belowChanges, belowWindow, followedBelow } from './slackBelow.js';

const START = '1700000000.000100';
const at = (minutes: number) => (1700000000 + minutes * 60).toFixed(6);
const msg = (minutes: number, text: string, extra: Partial<SlackMessage> = {}): SlackMessage => ({ ts: at(minutes), user: 'U1', text, ...extra });

describe('belowWindow', () => {
  it('ends at the first quiet gap of 3 hours; a reply in a branching thread keeps it open', () => {
    const history = [
      msg(5, 'one'),
      msg(30, 'two', { reply_count: 2, latest_reply: at(200) }), // its thread goes on until 3h20
      msg(350, 'three'), // 2.5 h after the last reply: still the same conversation
      msg(700, 'next morning'), // gap of almost 6 h: another conversation
      msg(710, 'more'),
    ];
    const { messages, lastActivity } = belowWindow(history, START, undefined);
    expect(messages.map((m) => m.text)).toEqual(['one', 'two', 'three']);
    expect(lastActivity).toBe(Number(at(350)));
  });

  it('stops after the first 6 messages in a busy channel that never goes quiet', () => {
    const history = Array.from({ length: 20 }, (_, i) => msg(5 + i * 10, `m${i}`));
    expect(belowWindow(history, START, undefined).messages.map((m) => m.text)).toEqual(['m0', 'm1', 'm2', 'm3', 'm4', 'm5']);
  });

  it('starts counting from the last reply of the linked thread, and skips its replies', () => {
    const { messages } = belowWindow([msg(1, 'reply', { thread_ts: START }), msg(300, 'after')], START, at(200));
    expect(messages.map((m) => m.text)).toEqual(['after']);
  });
});

describe('belowChanges', () => {
  function setup() {
    const out = mkdtempSync(path.join(tmpdir(), 'jl-below-'));
    const dir = 'c1-1700000000000100';
    mkdirSync(path.join(out, 'slack', dir), { recursive: true });
    writeFileSync(
      path.join(out, 'slack', dir, 'thread.md'),
      `---\nslack:\n  title: "deploy"\n  lastTs: "${START}"\n  url: "https://ws.slack.com/archives/C1/p1700000000000100"\n---\n# x\n`
    );
    const history: SlackMessage[] = [msg(5, 'one')];
    const replies: SlackMessage[] = [];
    const client = {
      call: async (method: string) => ({ ok: true, messages: method === 'conversations.history' ? history : replies }),
      userName: async () => 'Trung',
    } as unknown as SlackClient;
    return { out, dir, history, replies, client };
  }

  it('records the conversation first, then reports new messages and thread replies below it, until it goes quiet', async () => {
    const { out, dir, history, replies, client } = setup();
    const now = Number(at(10)) * 1000;
    expect(await belowChanges(out, false, client, new Set([dir]), now)).toEqual([]);
    expect(readFileSync(path.join(out, 'slack', dir, 'below.md'), 'utf8')).toContain('one');

    history.push(msg(20, 'two', { reply_count: 1, latest_reply: at(25) }));
    replies.push(msg(20, 'two'), msg(25, 'moved into the thread'));
    const [change] = await belowChanges(out, false, client, new Set([dir]), Number(at(26)) * 1000);
    expect(change!.line).toBe(
      `slack/${dir} below: 1 new message, new replies in 1 thread there in the channel below "deploy" (may be another topic; slack/${dir}/below.md; once the channel is on another topic, stop with \`jirallm unfollow below/${dir}\`)`
    );
    expect(concerns(change!.line, [`slack/${dir}`])).toBe(true);
    const below = readFileSync(path.join(out, 'slack', dir, 'below.md'), 'utf8');
    expect(below).toContain('## Trung');
    expect(below).toContain('### ↳ in its thread: Trung');
    expect(below).toContain('moved into the thread');

    // Quiet for more than 3 hours: closed, and later messages are another conversation.
    expect(await belowChanges(out, false, client, new Set([dir]), Number(at(400)) * 1000)).toEqual([]);
    history.push(msg(500, 'tomorrow'));
    expect(await belowChanges(out, false, client, new Set([dir]), Number(at(501)) * 1000)).toEqual([]);
  });

  it('shows a message that is only a screenshot: the image is saved next to below.md and linked', async () => {
    const { out, dir, history, client } = setup();
    history.push(msg(6, '', { files: [{ id: 'F1', name: 'image.png', mimetype: 'image/png' }] }));
    (client as unknown as { download: () => Promise<Buffer> }).download = async () => Buffer.from('png');
    await belowChanges(out, false, client, new Set([dir]), Number(at(10)) * 1000);
    expect(readFileSync(path.join(out, 'slack', dir, 'below.md'), 'utf8')).toContain('![image.png](./F1-image.png)');
    expect(readFileSync(path.join(out, 'slack', dir, 'F1-image.png'), 'utf8')).toBe('png');
  });

  it('waits for the thread export', async () => {
    const out = mkdtempSync(path.join(tmpdir(), 'jl-below-'));
    const client = { call: async () => { throw new Error('not called'); } } as unknown as SlackClient;
    expect(await belowChanges(out, false, client, new Set(['c1-1700000000000100']))).toEqual([]);
    expect(existsSync(path.join(out, '.slack-below.json'))).toBe(true);
  });
});

describe('followedBelow', () => {
  it('names the below links of running sessions', () => {
    const sessions = mkdtempSync(path.join(tmpdir(), 'jl-below-s-'));
    writeFileSync(path.join(sessions, 'live.follow'), 'slack/c1-17\nbelow/C1-17');
    writeFileSync(path.join(sessions, 'live.monitor'), String(process.pid));
    writeFileSync(path.join(sessions, 'gone.follow'), 'below/c2-18');
    expect([...followedBelow(sessions)]).toEqual(['c1-17']);
  });
});
