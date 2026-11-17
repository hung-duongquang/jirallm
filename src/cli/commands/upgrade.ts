import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { confirm, intro, isCancel, note, outro } from '@clack/prompts';
import { detectJsPackageManagerFromUserAgent } from '../../lib/platform.js';
import { runInteractive } from '../../lib/runCommand.js';
import { fetchLatestVersion, isNewer, RELEASE_SOURCE } from '../updateCheck.js';

export { fetchLatestVersion };

export type InstallMethod =
  | { kind: 'npx' }
  | { kind: 'homebrew' }
  | { kind: 'npm' | 'pnpm' | 'yarn' };

export type UpgradeOpts = { yes?: boolean; check?: boolean; json?: boolean };

export function detectInstallMethod(
  binaryPath: string = process.argv[1] ?? '',
  userAgent: string | undefined = process.env.npm_config_user_agent
): InstallMethod {
  if (/[\\/](_npx|dlx)[\\/]/.test(binaryPath)) return { kind: 'npx' };
  if (/\/(Cellar|homebrew)\//i.test(binaryPath)) return { kind: 'homebrew' };
  return { kind: detectJsPackageManagerFromUserAgent(userAgent) };
}

export function upgradeCommandFor(method: InstallMethod, source: string = RELEASE_SOURCE): string | undefined {
  switch (method.kind) {
    case 'pnpm':
      return `pnpm add -g ${source}`;
    case 'yarn':
      return `yarn global add ${source}`;
    case 'npm':
      return `npm install -g ${source}`;
    default:
      return undefined;
  }
}

function readPackageMeta(): { name: string; version: string } {
  const require = createRequire(import.meta.url);
  const pkg = require('../../../package.json') as { name: string; version: string };
  return { name: pkg.name, version: pkg.version };
}

/** The installed package's root (dist/cli/commands/upgrade.js → ../../..). */
const packageRoot = () => path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/** Native modules and libraries (*.node, *.dll) under `dir`. */
function nativeFiles(dir: string): string[] {
  const found: string[] = [];
  const walk = (d: string) => {
    let entries;
    try {
      entries = readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(node|dll)$/i.test(e.name)) found.push(p);
    }
  };
  walk(dir);
  return found;
}

/**
 * Windows: a running jirallm (a watch, `jirallm resume`, a `changes --follow`) keeps its native modules
 * loaded (the keyring; sharp before 0.40.4), and npm fails with EBUSY replacing the install. A loaded
 * file can still be moved within the drive: they go to a temp folder, and the old process keeps using
 * them. The same goes for npm's backup folders (`.jirallm-*`) a failed install left, which npm reuses;
 * those are removed once emptied of locked files.
 */
export function moveLockedNativeFiles(root: string = packageRoot(), platform: string = process.platform): number {
  const parent = path.dirname(root);
  // Only an installed copy (<global>/node_modules/jirallm), never a source checkout's dependencies.
  if (platform !== 'win32' || path.basename(parent) !== 'node_modules') return 0;
  let backups: string[] = [];
  try {
    backups = readdirSync(parent).filter((d) => d.startsWith(`.${path.basename(root)}-`)).map((d) => path.join(parent, d));
  } catch {
    // No backups.
  }
  const park = path.join(os.tmpdir(), 'jirallm-locked-dlls', String(Date.now()));
  let moved = 0;
  for (const file of [root, ...backups].flatMap((d) => nativeFiles(path.join(d, 'node_modules')))) {
    try {
      mkdirSync(park, { recursive: true });
      renameSync(file, path.join(park, `${moved}-${path.basename(file)}`));
      moved++;
    } catch {
      // npm reports what still blocks it.
    }
  }
  for (const b of backups) {
    try {
      rmSync(b, { recursive: true, force: true });
    } catch {
      // npm reports it if it matters.
    }
  }
  return moved;
}

/** Whether the jirallm Claude Code plugin is installed (Claude Code's installed_plugins.json names it). */
export function pluginInstalled(home: string = os.homedir()): boolean {
  try {
    return readFileSync(path.join(home, '.claude', 'plugins', 'installed_plugins.json'), 'utf8').includes('"jirallm@jirallm"');
  } catch {
    return false;
  }
}

/** The plugin's hooks call the CLI, so it is updated with it (Claude Code loads it on its next start). */
async function upgradePlugin(): Promise<void> {
  if (!pluginInstalled()) return;
  for (const cmd of ['claude plugin marketplace update jirallm', 'claude plugin update jirallm@jirallm']) {
    const code = await runInteractive(cmd);
    if (code !== 0) {
      console.error(`\`${cmd}\` exited with code ${code}; run it yourself to update the Claude Code plugin.`);
      return;
    }
  }
}

export async function runUpgrade(opts: UpgradeOpts = {}): Promise<void> {
  const { name, version } = readPackageMeta();
  const method = detectInstallMethod();

  if (opts.check) {
    const latest = await fetchLatestVersion();
    const outdated = isNewer(latest, version);
    if (opts.json) {
      console.log(JSON.stringify({ current: version, latest, outdated }));
    } else {
      console.log(`Current: ${version}`);
      console.log(`Latest:  ${latest}`);
      console.log(outdated ? `Update available: ${version} → ${latest}` : 'Up to date.');
    }
    if (outdated) process.exit(1);
    return;
  }

  if (method.kind === 'npx') {
    console.log(
      `You're running ${name} via npx/dlx — there's nothing to upgrade. Re-running with the latest version is automatic.`
    );
    return;
  }

  if (method.kind === 'homebrew') {
    console.log(`Installed via Homebrew. Run:\n  brew upgrade ${name}`);
    return;
  }

  const cmd = upgradeCommandFor(method);
  if (!cmd) {
    console.error(`Could not determine an upgrade command for install method "${method.kind}".`);
    process.exit(1);
  }

  intro(`${name} upgrade`);
  note(`Will run:\n  ${cmd}`, `Upgrading ${name} (${method.kind})`);

  if (!opts.yes) {
    const ok = await confirm({ message: `Proceed with \`${cmd}\`?`, initialValue: true });
    if (isCancel(ok) || ok !== true) {
      outro('Cancelled.');
      return;
    }
  }

  const moved = method.kind === 'npm' ? moveLockedNativeFiles() : 0;
  if (moved) console.log(`Moved ${moved} file(s) that a running jirallm keeps loaded out of the way.`);
  const code = await runInteractive(cmd);
  if (code !== 0) {
    console.error(`\nUpgrade command exited with code ${code}.`);
    process.exit(code);
  }
  await upgradePlugin();
  outro(`Upgrade complete. Restart Claude Code sessions to load the new plugin; \`${name} --version\` shows the CLI's version.`);
}
