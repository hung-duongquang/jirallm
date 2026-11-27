// Entry point of every plugin hook (hooks.json): `node run.mjs <hook>` runs <hook>.mjs of the newest
// installed jirallm plugin version, so a session started before `jirallm upgrade` gets the new hooks
// on its next prompt instead of after a restart (latest.mjs). The hook reads stdin and writes stdout
// as if Claude Code had started it directly.
import { pathToFileURL } from 'node:url';
import { latestHook } from './latest.mjs';

const name = process.argv[2] ?? '';
if (!/^[a-z-]+$/.test(name)) process.exit(0);
await import(pathToFileURL(latestHook(`${name}.mjs`)).href);
