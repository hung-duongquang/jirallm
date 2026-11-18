import { describe, expect, it } from 'vitest';
import { feedbackIssue } from './feedback.js';

describe('feedbackIssue', () => {
  it('titles the issue after the first line and lists the facts a maintainer needs', () => {
    const { title, body } = feedbackIssue('The monitor told me about ZOD-1 in my ZOD-2 session\nIt was at 10:00.', {
      cli: '0.44.2',
      plugin: '0.44.2',
      app: 'claude-desktop',
      os: 'Windows_NT 10.0',
      node: '24.18.0',
      session: 's1',
      follows: ['ZOD-2', 'slack/c1-1'],
      deliveries: [{ n: 3, at: '2026-11-18T10:00:00Z', via: 'monitor', items: ['ZOD-1'] }],
      doctor: [{ name: 'Claude Code plugin', severity: 'warn', detail: 'no monitor served it' }],
    });
    expect(title).toBe('The monitor told me about ZOD-1 in my ZOD-2 session');
    expect(body).toContain('It was at 10:00.');
    expect(body).toContain('- jirallm CLI 0.44.2, plugin 0.44.2, app claude-desktop');
    expect(body).toContain('- follows: ZOD-2, slack/c1-1');
    expect(body).toContain('- #3 2026-11-18T10:00:00Z via monitor: ZOD-1');
    expect(body).toContain('- ⚠ Claude Code plugin: no monitor served it');
  });

  it('shortens a long first line', () => {
    expect(feedbackIssue('x'.repeat(100), { cli: '', plugin: '', app: '', os: '', node: '', follows: [], deliveries: [], doctor: [] }).title).toHaveLength(80);
  });
});
