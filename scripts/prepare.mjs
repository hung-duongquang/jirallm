// Builds dist/ when the package is installed straight from git
// (`npm install -g github:<owner>/jirallm#<branch>`), where no prebuilt dist exists.
//
// npm resolves dependency versions without pnpm's lockfile, so a newer transitive type
// definition can make `tsc` report type errors although it still emits working JavaScript.
// Those must not abort an install: only a missing build output fails this step.

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
let tsc;
try {
  tsc = require.resolve('typescript/bin/tsc');
} catch {
  if (existsSync('dist/cli/index.js')) process.exit(0);
  console.error('prepare: typescript is not installed and dist/ is missing.');
  process.exit(1);
}

const result = spawnSync(process.execPath, [tsc], { stdio: 'inherit' });
if (result.status === 0) process.exit(0);

if (existsSync('dist/cli/index.js')) {
  console.warn('prepare: tsc reported type errors; the emitted build is used anyway.');
  process.exit(0);
}
process.exit(result.status ?? 1);
