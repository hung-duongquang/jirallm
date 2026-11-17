# Contributing to jirallm

Thanks for considering a contribution! This document explains how to get a working dev environment and how to propose changes.

By participating in this project you agree to abide by the [Code of Conduct](./CODE_OF_CONDUCT.md).

## Ways to contribute

- Report a bug using the [bug report template](./.github/ISSUE_TEMPLATE/bug_report.md)
- Propose an enhancement using the [feature request template](./.github/ISSUE_TEMPLATE/feature_request.md)
- Improve documentation
- Submit a pull request that fixes a bug or implements an accepted feature

For non-trivial changes, please open an issue first so we can discuss the approach before you invest time in code.

## Development setup

Prerequisites:

- Node.js >= 20
- [pnpm](https://pnpm.io/) (recommended) or npm
- `ffmpeg` on your `PATH` if you want to test video frame extraction

Clone and install:

```bash
git clone https://github.com/hung-duongquang/jirallm.git
cd jirallm
pnpm install
```

Build:

```bash
pnpm build       # one-shot
pnpm dev         # tsc --watch
```

Run the CLI from your local checkout:

```bash
node dist/cli/index.js PROJ-123 --output-dir ./jira-export
```

Set up credentials by running `node dist/cli/index.js init` (writes `~/.config/jirallm/config.toml` and stores the API token in your OS keychain). For one-off runs you can also bypass the keychain by passing `--base-url`, `--user-email`, and `--api-token` directly on the command line. Use a personal sandbox project — never commit real ticket content.

## Coding guidelines

- TypeScript strict mode; prefer type inference and `type` aliases over `interface`
- ESM only — use `.js` import specifiers in source as required by Node ESM
- Keep functions small, pure, and composable; avoid hidden globals
- Do not log secrets, tokens, or raw issue payloads from third parties
- Follow the existing folder structure (`src/lib`, `src/cli`)

## Pull request process

1. Fork the repo and create a feature branch from `main` (e.g. `feat/jql-pagination`)
2. Make your changes in focused commits with clear messages
3. Run `pnpm build` and verify the CLI still works end-to-end against a real issue
4. Update `README.md` when behavior changes. Adding notes under `## [Unreleased]` in `CHANGELOG.md` is optional but preferred — whatever you write there is what ships in the release notes; leave it empty and the entry is generated from your commit subject instead
5. Open a PR using the [pull request template](./.github/PULL_REQUEST_TEMPLATE.md) and describe the motivation and trade-offs
6. Be ready to iterate on review feedback

## Collaborators

Collaborators have write access: push branches (or small fixes) straight to this repo instead of forking, and cut releases as below. The repo owner adds a new collaborator under Settings → Collaborators (role **Write**), or with `gh api -X PUT repos/hung-duongquang/jirallm/collaborators/<login> -f permission=push`.

## Releasing (collaborators)

There is no npm publish. Users install from the generated `release` branch (`npm install -g github:hung-duongquang/jirallm#release`), and the GitHub Pages site is the generated `gh-pages` branch. Never edit either by hand.

1. Make sure `main` is up to date and pushed: `git pull`, then `git push origin main`
2. Bump the version in **both** `package.json` and `.claude-plugin/plugin.json` (Claude Code caches the plugin by version, so an unchanged version makes `claude plugin update` a no-op). Bump `vscode/package.json` only when `vscode/` changed
3. Build right before publishing, because the script packs the local `dist/` as is: `npx pnpm@10 build` (use pnpm 10; npm resolves newer deps and `tsc` fails)
4. Run the tests: `npx pnpm@10 test`
5. Publish: `node scripts/publish-branches.mjs origin`. This force-pushes fresh `release` and `gh-pages` commits
6. Optionally tag it: `git tag vX.Y.Z && git push origin vX.Y.Z`, then `gh release create vX.Y.Z --generate-notes`
7. Update your own install: `npm install -g github:hung-duongquang/jirallm#release` (stop a running `jirallm ui` / `watch` first, or Windows reports EBUSY), then `claude plugin marketplace update jirallm && claude plugin update jirallm@jirallm`

The daily update check in `jirallm` reads the `release` branch, so users see the new version within a few minutes.

## Reporting security issues

Please do **not** open a public issue for security vulnerabilities. Follow the process in [SECURITY.md](./SECURITY.md).

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](./LICENSE).
