import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

describe('isGreeting (prompt hook)', () => {
  it('takes only a bare greeting, so a real prompt keeps its ticket context', async () => {
    const hook = (await import(pathToFileURL(path.resolve('hooks/changes.mjs')).href)) as { isGreeting: (p: string) => boolean };
    for (const p of ['Hi', 'hi!', 'Hello Claude', 'hey 👋', 'chào', 'Xin chào bạn', 'Good morning', 'goedemorgen.']) {
      expect(hook.isGreeting(p), p).toBe(true);
    }
    for (const p of ['Hi, check ZOD-1234', 'hello, why is CI red?', 'ok', 'morning standup notes', 'hi https://x.slack.com/archives/C1/p1']) {
      expect(hook.isGreeting(p), p).toBe(false);
    }
  });
});
