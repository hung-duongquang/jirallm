// Claude Code runs a plugin's hooks from the version directory the session started with
// (…/plugins/cache/jirallm/jirallm/<version>/hooks): after `jirallm upgrade` a running session keeps the
// old hooks until it is restarted, while the CLI they call is already the new one. These helpers find
// the newest installed version next to this one, so the hooks (run.mjs) and the monitor follow an
// upgrade on their next run without restarting any session. Outside the versioned cache (a checkout)
// they keep this directory.
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const VERSION = /^(\d+)\.(\d+)\.(\d+)$/;

const newer = (a, b) => {
  const x = VERSION.exec(a).slice(1).map(Number);
  const y = VERSION.exec(b).slice(1).map(Number);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
  return false;
};

/** The hooks directory of the newest installed plugin version (this one when it is not in the versioned cache). */
export function latestHooksDir(hooksDir = here) {
  const root = path.dirname(hooksDir);
  const own = path.basename(root);
  if (!VERSION.test(own)) return hooksDir;
  let best = own;
  try {
    for (const d of readdirSync(path.dirname(root))) {
      if (VERSION.test(d) && newer(d, best) && existsSync(path.join(path.dirname(root), d, 'hooks', 'run.mjs'))) best = d;
    }
  } catch {
    return hooksDir;
  }
  return path.join(path.dirname(root), best, 'hooks');
}

/** Path of `file` (e.g. "changes.mjs") in the newest installed version's hooks. */
export function latestHook(file, hooksDir = here) {
  const dir = latestHooksDir(hooksDir);
  const p = path.join(dir, file);
  return existsSync(p) ? p : path.join(hooksDir, file);
}
