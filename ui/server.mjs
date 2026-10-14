#!/usr/bin/env node
// Local web UI for jirallm: export Jira issues (or a whole GitHub PR stack) and preview the
// resulting task.md files. Listens on 127.0.0.1 only and reuses the CLI's config + keychain.
//
//   node ui/server.mjs [--port 4321] [--output-dir ./jira-export] [--repo owner/name]
//                      [--org name] [--open]

import { createServer } from 'node:http';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const here = dirname(fileURLToPath(import.meta.url));
const lib = await import(new URL('../dist/index.js', import.meta.url)).catch(() => {
  console.error('jirallm is not built yet. Run `pnpm build` (or `npx pnpm@10 run build`) first.');
  process.exit(1);
});
const { JiraExporter, loadProfile, listOrgs } = lib;
const execFileAsync = promisify(execFile);

const { values: args } = parseArgs({
  options: {
    port: { type: 'string', default: process.env.JIRALLM_UI_PORT ?? '4321' },
    'output-dir': { type: 'string', default: process.env.JIRALLM_UI_OUTPUT_DIR },
    repo: { type: 'string', default: process.env.JIRALLM_UI_REPO ?? '' },
    org: { type: 'string', default: process.env.JIRALLM_UI_ORG },
    open: { type: 'boolean', default: false },
  },
});
const port = Number(args.port);
const defaultOutputDir = resolve(args['output-dir'] ?? './jira-export');

const ISSUE_KEY = /\b[A-Z][A-Z0-9]+-\d+\b/;
const ISSUE_KEY_STRICT = /^[A-Z][A-Z0-9]+-\d+$/i;

// ---------- helpers ----------

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function sendJson(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

async function readJsonBody(req) {
  // Requiring JSON blocks cross-site form posts: a browser cannot send this type cross-origin
  // without a CORS preflight, which this server never approves.
  if (!String(req.headers['content-type'] ?? '').startsWith('application/json')) {
    throw new HttpError(415, 'Expected application/json');
  }
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch {
    throw new HttpError(400, 'Invalid JSON body');
  }
}

function resolveOutputDir(dir) {
  return resolve(typeof dir === 'string' && dir.trim() ? dir.trim() : defaultOutputDir);
}

function taskDirFor(outputDir, key) {
  if (!ISSUE_KEY_STRICT.test(key ?? '')) throw new HttpError(400, `Not an issue key: ${key}`);
  const dir = resolve(outputDir, key.toLowerCase());
  if (!dir.startsWith(outputDir + sep)) throw new HttpError(400, 'Invalid path');
  return dir;
}

/** --org wins; otherwise the only configured org (loadProfile cannot infer one without a key). */
function defaultOrg() {
  if (args.org) return args.org;
  const orgs = listOrgs();
  return orgs.length === 1 ? orgs[0] : undefined;
}

let profilePromise;
function profile() {
  profilePromise ??= loadProfile({ org: defaultOrg() }).catch((err) => {
    profilePromise = undefined;
    throw new HttpError(500, `Could not load jirallm config: ${err.message}. Run \`jirallm init\`.`);
  });
  return profilePromise;
}

// ---------- PR stack resolution (GitHub CLI) ----------

async function gh(ghArgs) {
  try {
    const { stdout } = await execFileAsync('gh', ghArgs, { maxBuffer: 16 * 1024 * 1024 });
    return stdout;
  } catch (err) {
    const msg = (err.stderr || err.message || '').toString().trim();
    throw new HttpError(502, `gh ${ghArgs.slice(0, 3).join(' ')} failed: ${msg}`);
  }
}

/** "Stacked on #2813 (ZOD-3602) ← #2812 (ZOD-3601) ← …" → [{pr, key}] from top to bottom. */
function parseStackedOn(body) {
  const line = (body ?? '').split('\n').find((l) => /stacked on/i.test(l));
  if (!line) return [];
  return [...line.matchAll(/#(\d+)(?:\s*\(([A-Z][A-Z0-9]+-\d+)\))?/g)].map((m) => ({
    pr: Number(m[1]),
    key: m[2],
  }));
}

async function resolveStack(prNumber, repo) {
  const repoArgs = repo ? ['--repo', repo] : [];
  const fields = 'number,title,headRefName,body,state,url';
  const start = JSON.parse(await gh(['pr', 'view', String(prNumber), ...repoArgs, '--json', fields]));

  // The PR only lists what is *below* it. Find the top of the stack: the PR whose
  // "Stacked on" line mentions this one and has the longest chain.
  const mentions = JSON.parse(
    await gh([
      'pr', 'list', ...repoArgs, '--state', 'all', '--limit', '50',
      '--search', `"#${prNumber}" in:body`, '--json', fields,
    ])
  );
  let top = start;
  let topChain = parseStackedOn(start.body);
  for (const pr of mentions) {
    const chain = parseStackedOn(pr.body);
    if (chain.some((c) => c.pr === prNumber) && chain.length > topChain.length) {
      top = pr;
      topChain = chain;
    }
  }

  const ordered = [...topChain].reverse(); // bottom of the stack first
  ordered.push({ pr: top.number, key: top.title.match(ISSUE_KEY)?.[0] });

  const known = new Map([start, top, ...mentions].map((pr) => [pr.number, pr]));
  const items = await Promise.all(
    ordered.map(async ({ pr, key }) => {
      let info = known.get(pr);
      if (!info) {
        info = JSON.parse(await gh(['pr', 'view', String(pr), ...repoArgs, '--json', fields]));
      }
      const issueKey =
        key ?? info.title.match(ISSUE_KEY)?.[0] ?? info.headRefName.match(ISSUE_KEY)?.[0] ?? null;
      return { pr, key: issueKey, title: info.title, state: info.state, url: info.url };
    })
  );
  return { top: top.number, items };
}

// ---------- export ----------

async function exportIssues(body, res) {
  const keys = [...new Set((body.keys ?? []).map((k) => String(k).trim().toUpperCase()))].filter(
    (k) => ISSUE_KEY_STRICT.test(k)
  );
  if (keys.length === 0) throw new HttpError(400, 'No valid issue keys given');

  const { config, org, project, apiToken } = await profile();
  const outputDir = resolveOutputDir(body.outputDir);
  const o = body.options ?? {};
  const exporter = new JiraExporter(
    { baseUrl: config.baseUrl, userEmail: config.userEmail, projectKey: project.key },
    apiToken
  );
  const videoDefaults = org.videoFrames ?? {};

  // Stream one NDJSON line per issue so the page can show progress.
  res.writeHead(200, { 'content-type': 'application/x-ndjson; charset=utf-8' });
  const emit = (event) => res.write(JSON.stringify(event) + '\n');
  emit({ type: 'start', total: keys.length, outputDir });

  for (const key of keys) {
    emit({ type: 'progress', key });
    try {
      const result = await exporter.exportIssues([key], {
        outputDir,
        includeSubtasks: o.subtasks ?? org.includeSubtasks ?? false,
        includeParent: o.parent ?? false,
        fieldSelector: org.export?.fieldSelector,
        customFieldDefs: org.export?.customFieldDefs,
        withHistory: o.fieldChanges ?? false,
        withStatusChanges: o.statusChanges ?? false,
        withComments: o.comments ?? true,
        withWorklog: o.worklog ?? false,
        videoFrames: {
          enabled: (o.videoFrames ?? true) && videoDefaults.enabled !== false,
          fps: videoDefaults.fps ?? 5,
          maxFrames: videoDefaults.maxFrames ?? 10,
        },
      });
      for (const item of result.imported) emit({ type: 'done', key: item.key, status: 'new', ...pick(item) });
      for (const item of result.updated) emit({ type: 'done', key: item.key, status: 'updated', ...pick(item) });
      for (const fail of result.failed) emit({ type: 'failed', key: fail.key, error: String(fail.error) });
    } catch (err) {
      emit({ type: 'failed', key, error: err.message });
    }
  }
  emit({ type: 'end' });
  res.end();
}

const pick = (item) => ({ path: item.path, attachmentCount: item.attachmentCount ?? 0 });

// ---------- library (already exported issues) ----------

async function listLibrary(outputDir) {
  if (!existsSync(outputDir)) return [];
  const entries = await readdir(outputDir, { withFileTypes: true });
  const items = await Promise.all(
    entries
      .filter((e) => e.isDirectory() && ISSUE_KEY_STRICT.test(e.name))
      .map(async (e) => {
        const file = join(outputDir, e.name, 'task.md');
        if (!existsSync(file)) return null;
        const [text, info] = await Promise.all([readFile(file, 'utf8'), stat(file)]);
        return {
          key: e.name.toUpperCase(),
          title: text.match(/^# (.+)$/m)?.[1] ?? '',
          status: text.match(/^status: "?([^"\n]+)"?$/m)?.[1] ?? '',
          modified: info.mtime.toISOString(),
          size: info.size,
        };
      })
  );
  return items.filter(Boolean).sort((a, b) => b.modified.localeCompare(a.modified));
}

function openInExplorer(target) {
  const [cmd, cmdArgs] =
    process.platform === 'win32'
      ? ['explorer.exe', [target]]
      : process.platform === 'darwin'
        ? ['open', [target]]
        : ['xdg-open', [target]];
  spawn(cmd, cmdArgs, { detached: true, stdio: 'ignore' }).unref();
}

// ---------- server ----------

const allowedHosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);

const server = createServer(async (req, res) => {
  try {
    // Reject requests for any other Host name (DNS-rebinding protection).
    if (!allowedHosts.has(req.headers.host ?? '')) throw new HttpError(403, 'Forbidden host');
    const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
    const route = `${req.method} ${url.pathname}`;

    switch (route) {
      case 'GET /':
      case 'GET /index.html': {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end(await readFile(join(here, 'index.html')));
        return;
      }
      case 'GET /api/info': {
        const { config, org, project } = await profile();
        sendJson(res, 200, {
          org: org.name,
          project: project.key,
          baseUrl: config.baseUrl,
          userEmail: config.userEmail,
          outputDir: defaultOutputDir,
          repo: args.repo,
          includeSubtasks: org.includeSubtasks ?? false,
        });
        return;
      }
      case 'POST /api/stack': {
        const body = await readJsonBody(req);
        const pr = Number(String(body.pr ?? '').replace('#', ''));
        if (!Number.isInteger(pr) || pr <= 0) throw new HttpError(400, 'Enter a PR number');
        sendJson(res, 200, await resolveStack(pr, String(body.repo ?? '').trim()));
        return;
      }
      case 'POST /api/export': {
        await exportIssues(await readJsonBody(req), res);
        return;
      }
      case 'GET /api/library': {
        sendJson(res, 200, await listLibrary(resolveOutputDir(url.searchParams.get('dir'))));
        return;
      }
      case 'GET /api/task': {
        const dir = taskDirFor(resolveOutputDir(url.searchParams.get('dir')), url.searchParams.get('key'));
        const file = join(dir, 'task.md');
        if (!existsSync(file)) throw new HttpError(404, 'Not exported yet');
        sendJson(res, 200, { markdown: await readFile(file, 'utf8'), path: file });
        return;
      }
      case 'POST /api/open': {
        const body = await readJsonBody(req);
        const outputDir = resolveOutputDir(body.dir);
        const target = body.key ? taskDirFor(outputDir, body.key) : outputDir;
        if (!existsSync(target)) throw new HttpError(404, 'Folder does not exist yet');
        openInExplorer(target);
        sendJson(res, 200, { ok: true });
        return;
      }
      default:
        throw new HttpError(404, 'Not found');
    }
  } catch (err) {
    if (res.headersSent) {
      res.end(JSON.stringify({ type: 'failed', error: err.message }) + '\n');
      return;
    }
    sendJson(res, err.status ?? 500, { error: err.message });
  }
});

server.listen(port, '127.0.0.1', () => {
  const address = `http://127.0.0.1:${port}`;
  console.log(`jirallm UI running at ${address}`);
  console.log(`Exporting to ${defaultOutputDir} (change it in the page). Ctrl+C to stop.`);
  if (args.open) openInExplorer(address);
});
