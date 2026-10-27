// Keeps the Claude Code plugin in step with the CLI after `pnpm build`: writes skills/jirallm/SKILL.md
// from AGENT_GUIDE (the text `jirallm agent-guide` prints) and copies the package version into
// .claude-plugin/plugin.json. A test fails when the committed skill drifts from the guide.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { AGENT_GUIDE } from '../dist/cli/commands/agentGuide.js';

mkdirSync('skills/jirallm', { recursive: true });
writeFileSync('skills/jirallm/SKILL.md', AGENT_GUIDE);

const { version } = JSON.parse(readFileSync('package.json', 'utf8'));
const plugin = JSON.parse(readFileSync('.claude-plugin/plugin.json', 'utf8'));
if (plugin.version !== version) {
  plugin.version = version;
  writeFileSync('.claude-plugin/plugin.json', JSON.stringify(plugin, null, 2) + '\n');
}
