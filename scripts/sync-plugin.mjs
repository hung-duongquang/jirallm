// Keeps the Claude Code plugin in step with the CLI after `pnpm build`: writes the skill
// (skills/jirallm/SKILL.md plus references/*.md, split from AGENT_GUIDE, the text `jirallm agent-guide`
// prints) and copies the package version into .claude-plugin/plugin.json. A test fails when the
// committed skill drifts from the guide.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pluginSkillFiles } from '../dist/cli/commands/agentGuide.js';

const root = 'skills/jirallm';
rmSync(path.join(root, 'references'), { recursive: true, force: true });
for (const [file, text] of Object.entries(pluginSkillFiles())) {
  mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  writeFileSync(path.join(root, file), text);
}

const { version } = JSON.parse(readFileSync('package.json', 'utf8'));
const plugin = JSON.parse(readFileSync('.claude-plugin/plugin.json', 'utf8'));
if (plugin.version !== version) {
  plugin.version = version;
  writeFileSync('.claude-plugin/plugin.json', JSON.stringify(plugin, null, 2) + '\n');
}
