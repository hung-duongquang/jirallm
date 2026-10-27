// Publishes two generated branches to a remote (default: `fork`), without touching the
// working tree or the current branch:
//
//   release   - the built package (dist/, ui/, package.json, README.md, LICENSE) plus the Claude Code
//               plugin (.claude-plugin/, hooks/, skills/), so users can
//               `npm install -g github:<owner>/jirallm#release` without building anything.
//   gh-pages  - ui/index.html as the GitHub Pages site.
//
// Run after `pnpm build`:  node scripts/publish-branches.mjs [remote]

import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';

const remote = process.argv[2] ?? 'fork';
const tmp = mkdtempSync(join(tmpdir(), 'jirallm-publish-'));
const indexFile = join(tmp, 'index');
const env = { ...process.env, GIT_INDEX_FILE: indexFile };

const git = (args, input) =>
  execFileSync('git', args, { env, input, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).trim();
const blob = (content) => git(['hash-object', '-w', '--stdin'], content);
const add = (path, sha) => git(['update-index', '--add', '--cacheinfo', `100644,${sha},${path}`]);

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

/** Builds a tree from `files` ({path: content}) and returns a parentless commit. */
function commit(files, message) {
  rmSync(indexFile, { force: true });
  git(['read-tree', '--empty']);
  for (const [path, content] of Object.entries(files)) add(path, blob(content));
  const tree = git(['write-tree']);
  return git(['commit-tree', tree, '-m', message]);
}

try {
  if (!existsSync('dist/cli/index.js')) throw new Error('dist/ is missing - run `pnpm build` first.');
  const source = git(['rev-parse', '--short', 'HEAD']);

  const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
  delete pkg.devDependencies; // nothing is built on install
  delete pkg.scripts;
  const release = {
    'package.json': JSON.stringify(pkg, null, 2) + '\n',
    'README.md': readFileSync('README.md'),
    LICENSE: readFileSync('LICENSE'),
  };
  for (const file of [...walk('dist'), ...walk('ui'), ...walk('.claude-plugin'), ...walk('hooks'), ...walk('skills')]) {
    if (/\.test\.(js|d\.ts|js\.map|d\.ts\.map)$/.test(file)) continue;
    release[relative('.', file).split(sep).join('/')] = readFileSync(file);
  }

  const pages = { 'index.html': readFileSync('ui/index.html'), '.nojekyll': '' };

  const releaseCommit = commit(release, `release: built from ${source}`);
  const pagesCommit = commit(pages, `pages: ui/index.html from ${source}`);

  execFileSync('git', ['push', '--force', remote, `${releaseCommit}:refs/heads/release`], { stdio: 'inherit' });
  execFileSync('git', ['push', '--force', remote, `${pagesCommit}:refs/heads/gh-pages`], { stdio: 'inherit' });
  console.log(`Published release (${Object.keys(release).length} files) and gh-pages from ${source}.`);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
