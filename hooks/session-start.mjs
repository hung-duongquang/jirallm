// SessionStart hook of the jirallm Claude Code plugin. Whatever it prints lands in Claude's context:
// the Jira/Confluence changes `jirallm watch` logged since the last session, or a setup hint
// when the CLI is missing. It never fails the session.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

// On Windows the global command is a .cmd/.ps1 shim, which needs a shell; pass one quoted string there.
const run = (args) =>
  process.platform === 'win32'
    ? spawnSync(['jirallm', ...args].map((a) => (/[\s"]/.test(a) ? `"${a}"` : a)).join(' '), {
        encoding: 'utf8',
        shell: true,
        timeout: 15000,
      })
    : spawnSync('jirallm', args, { encoding: 'utf8', timeout: 15000 });

if (run(['--version']).status !== 0) {
  console.log(
    'jirallm plugin: the jirallm CLI is not installed. Ask the user to run ' +
      '`npm install -g github:hung-duongquang/jirallm#release` and then `jirallm init` (their own Jira API token).'
  );
} else {
  const outputDir = path.join(process.env.CLAUDE_PROJECT_DIR || process.cwd(), 'jira-export');
  if (existsSync(outputDir)) {
    const changes = run(['changes', '--unseen', '--output-dir', outputDir]);
    if (changes.status === 0 && changes.stdout.trim()) process.stdout.write(changes.stdout);
  }
}
