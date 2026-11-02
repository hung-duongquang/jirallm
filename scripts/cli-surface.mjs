#!/usr/bin/env node
// Lists the CLI's commands and their long options, to see what an upstream merge added:
//
//   node scripts/cli-surface.mjs > before.json        (before the merge, on the old build)
//   node scripts/cli-surface.mjs --diff before.json   (after the merge and build)
//
// The diff prints new and removed commands and options, and marks the ones the agent guide
// (src/cli/commands/agentGuide.ts) does not mention, so they can be added to the skill.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(root, 'dist', 'cli', 'index.js');

function help(args) {
  try {
    return execFileSync(process.execPath, [cli, ...args, '--help'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch (err) {
    return err.stdout ?? '';
  }
}

/** Command names from a "Commands:" block (first word of each entry line, aliases dropped). */
function commandsOf(text) {
  const block = text.split(/^Commands:\s*$/m)[1]?.split(/^\S/m)[0] ?? '';
  return block
    .split('\n')
    .map((l) => l.match(/^ {2}([a-z][\w:-]*)(?:\|[\w-]+)?(?:\s|$)/)?.[1])
    .filter((c) => c && c !== 'help');
}

/** Long options from an "Options:" block. */
function optionsOf(text) {
  const block = text.split(/^Options:\s*$/m)[1]?.split(/^\S/m)[0] ?? '';
  return [...new Set([...block.matchAll(/^\s+(?:-\w, )?(--[\w-]+)/gm)].map((m) => m[1]))]
    .filter((o) => o !== '--help')
    .sort();
}

function surface() {
  const out = {};
  for (const cmd of commandsOf(help([]))) {
    const text = help([cmd]);
    out[cmd] = optionsOf(text);
    for (const sub of commandsOf(text)) out[`${cmd} ${sub}`] = optionsOf(help([cmd, sub]));
  }
  return out;
}

const now = surface();
const diffAt = process.argv.indexOf('--diff');
if (diffAt < 0) {
  process.stdout.write(`${JSON.stringify(now, null, 2)}\n`);
} else {
  const before = JSON.parse(readFileSync(process.argv[diffAt + 1], 'utf8'));
  const guide = readFileSync(join(root, 'src', 'cli', 'commands', 'agentGuide.ts'), 'utf8');
  const inGuide = (word) => guide.includes(word);
  const lines = [];
  for (const [cmd, opts] of Object.entries(now)) {
    if (!(cmd in before)) {
      lines.push(`+ ${cmd}${inGuide(`jirallm ${cmd}`) ? '' : '   (not in the agent guide)'}`);
      continue;
    }
    for (const o of opts.filter((o) => !before[cmd].includes(o))) {
      lines.push(`+ ${cmd} ${o}${inGuide(o) ? '' : '   (not in the agent guide)'}`);
    }
    for (const o of before[cmd].filter((o) => !opts.includes(o))) lines.push(`- ${cmd} ${o}`);
  }
  for (const cmd of Object.keys(before).filter((c) => !(c in now))) {
    lines.push(`- ${cmd}${inGuide(`jirallm ${cmd}`) ? '   (still in the agent guide!)' : ''}`);
  }
  console.log(lines.length ? lines.join('\n') : 'No CLI commands or options added or removed.');
}
