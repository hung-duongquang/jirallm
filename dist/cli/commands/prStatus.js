import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { keyFromBranch } from './prContext.js';
const PR_FIELDS = 'number,title,url,state,isDraft,mergeable,reviewDecision,headRefName,baseRefName,headRefOid,statusCheckRollup,latestReviews,comments,commits';
const THREADS_QUERY = `query($o:String!,$n:String!,$p:Int!){viewer{login}repository(owner:$o,name:$n){pullRequest(number:$p){reviewThreads(first:100){nodes{isResolved isOutdated path line comments(first:1){totalCount nodes{author{login} body createdAt url}} last:comments(last:1){nodes{author{login} body createdAt url}}}}}}}`;
const MAX_BODY = 300;
const NOISE_AUTHORS = /^(github-actions|codecov|sonarcloud|qodana)/i;
// Colour codes as real escapes or as the literal "^[" some log downloads contain; cyan lines are the echoed step script.
const ESC = `(?:${String.fromCharCode(27)}|\\^\\[)`;
const ANSI = new RegExp(`${ESC}\\[[0-9;]*m`, 'g');
const ECHOED_SCRIPT = new RegExp(`^${ESC}\\[36;1m`);
const clip = (s, n) => {
    const one = s.replace(/<!--[\s\S]*?-->/g, '').replace(/\s+/g, ' ').trim();
    return one.length > n ? `${one.slice(0, n)}…` : one;
};
const stamp = (ts) => new Date(ts).toLocaleString('sv-SE').slice(0, 16);
/** Maps a statusCheckRollup entry (CheckRun or StatusContext) to pass/fail/pending/skip. */
export function toCheck(item) {
    const name = item.name ?? item.context ?? '?';
    const full = item.workflowName ? `${name} (${item.workflowName})` : name;
    const url = item.detailsUrl ?? item.targetUrl;
    const raw = (item.conclusion || item.state || item.status || '').toUpperCase();
    if (item.__typename === 'CheckRun' && item.status && item.status.toUpperCase() !== 'COMPLETED')
        return { name: full, bucket: 'pending', url };
    if (['FAILURE', 'ERROR', 'TIMED_OUT', 'CANCELLED', 'STARTUP_FAILURE', 'ACTION_REQUIRED'].includes(raw))
        return { name: full, bucket: 'fail', url };
    if (['PENDING', 'EXPECTED', 'QUEUED', 'IN_PROGRESS', 'WAITING', 'REQUESTED', ''].includes(raw))
        return { name: full, bucket: 'pending', url };
    if (['SKIPPED', 'NEUTRAL', 'STALE'].includes(raw))
        return { name: full, bucket: 'skip', url };
    return { name: full, bucket: 'pass', url };
}
/** The rollup lists every run of a re-run check; keep the latest per workflow and name. */
export function latestRuns(items) {
    const byName = new Map();
    for (const item of items) {
        const id = `${item.workflowName ?? ''}/${item.name ?? item.context ?? '?'}`;
        const seen = byName.get(id);
        if (!seen || (item.startedAt ?? '') >= (seen.startedAt ?? ''))
            byName.set(id, item);
    }
    return [...byName.values()];
}
/** The Actions job id in a check's details URL (…/actions/runs/1/job/2). */
export function jobIdFromUrl(url) {
    return url ? /\/actions\/runs\/\d+\/job\/(\d+)/.exec(url)?.[1] : undefined;
}
/**
 * The informative lines of `gh run view --job <id> --log-failed`: prefixes, colours and echoed
 * script lines stripped, then error/failure lines with one line of context, else the tail.
 */
export function digestLog(log, max = 25) {
    const lines = log.split(/\r?\n/)
        .map((l) => l.replace(/^[^\t]*\t[^\t]*\t\S+Z ?/, ''))
        .filter((l) => !ECHOED_SCRIPT.test(l))
        .map((l) => l.replace(ANSI, '').trimEnd())
        .filter((l) => l.trim() && !/^(##\[(group|endgroup)\]|shell: |env:| {2}[A-Z_]+: )/.test(l));
    const hit = (l) => /##\[error\]|::error|\b(error|failed|failure)\b|exception\b|assert/i.test(l)
        && !/\b(digest-mismatch|fail-on-cache-miss|continue-on-error|--retry-failed-tests|Expected Digest)\b/i.test(l)
        && !/^\s+[a-z][\w-]*: \S+$/.test(l);
    const frameworkFrame = (l) => /^\s*(at (System|Microsoft|Xunit|NUnit|TUnit|node:)\.?|--- End of)/.test(l);
    const keep = new Set();
    lines.forEach((l, i) => {
        if (!hit(l))
            return;
        keep.add(i);
        if (/##\[error\]/.test(l))
            return;
        for (let j = i + 1; j < Math.min(i + 8, lines.length) && !frameworkFrame(lines[j]); j++)
            keep.add(j);
    });
    const picked = keep.size ? [...keep].sort((a, b) => a - b).map((i) => lines[i]) : lines.slice(-max);
    const unique = picked.filter((l, i, a) => a.indexOf(l) === i).map((l) => (l.length > 240 ? `${l.slice(0, 240)}…` : l));
    return unique.length > max ? [...unique.slice(0, max - 1), `… ${unique.length - max + 1} more line(s)`] : unique;
}
const defaultGh = (cwd, args) => execFileSync('gh', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 });
/** Reads a PR (number, or the current branch's PR when omitted) with its checks, reviews and review threads. */
export function fetchPrState(gh, cwd, pr) {
    const raw = JSON.parse(gh(cwd, ['pr', 'view', ...(pr ? [pr] : []), '--json', PR_FIELDS]));
    const [, owner, name] = /github\.com\/([^/]+)\/([^/]+)\/pull\//.exec(raw.url) ?? [];
    const gql = JSON.parse(gh(cwd, ['api', 'graphql', '-f', `query=${THREADS_QUERY}`, '-F', `o=${owner}`, '-F', `n=${name}`, '-F', `p=${raw.number}`]));
    return {
        number: raw.number,
        title: raw.title,
        url: raw.url,
        state: raw.state,
        isDraft: raw.isDraft,
        mergeable: raw.mergeable,
        reviewDecision: raw.reviewDecision || 'none',
        headRefName: raw.headRefName,
        baseRefName: raw.baseRefName,
        headRefOid: raw.headRefOid,
        lastPush: raw.commits[raw.commits.length - 1]?.committedDate,
        me: gql.data.viewer.login,
        checks: latestRuns(raw.statusCheckRollup ?? []).map(toCheck),
        reviews: raw.latestReviews ?? [],
        threads: gql.data.repository.pullRequest.reviewThreads.nodes.map((t) => ({
            isResolved: t.isResolved, isOutdated: t.isOutdated, path: t.path, line: t.line,
            first: t.comments.nodes[0], last: t.last.nodes[0] ?? t.comments.nodes[0], count: t.comments.totalCount,
        })),
        comments: (raw.comments ?? []).filter((c) => !NOISE_AUTHORS.test(c.author.login)),
    };
}
/** Unresolved threads whose last word is not mine: the reviewer is waiting for an answer or a fix. */
export const threadsAwaitingMe = (s) => s.threads.filter((t) => !t.isResolved && t.last.author.login !== s.me);
/** Renders the PR state as compact markdown; failed jobs get their log digest from `logFor`. */
export function renderPrStatus(s, logFor) {
    const by = (b) => s.checks.filter((c) => c.bucket === b);
    const [fail, pending, pass, skip] = [by('fail'), by('pending'), by('pass'), by('skip')];
    const key = keyFromBranch(s.headRefName);
    const out = [
        `# PR #${s.number}${key ? ` (${key})` : ''}: ${s.title}`,
        '',
        `${s.isDraft ? 'DRAFT' : s.state} · review **${s.reviewDecision}** · mergeable ${s.mergeable} · ${s.headRefName} → ${s.baseRefName} · ${s.url}`,
        s.lastPush ? `Last commit ${stamp(s.lastPush)} (${s.headRefOid.slice(0, 9)})` : '',
        '',
        `## Checks: ${fail.length} failed, ${pending.length} pending, ${pass.length} passed, ${skip.length} skipped`,
        '',
    ];
    for (const c of fail) {
        out.push(`- ✗ ${c.name}${c.url ? ` ${c.url}` : ''}`);
        const job = jobIdFromUrl(c.url);
        if (job)
            out.push(...logFor(job).map((l) => `    ${l}`), `    (full log: gh run view --job ${job} --log-failed)`);
    }
    if (pending.length)
        out.push(`- … pending: ${pending.map((c) => c.name).join(', ')}`);
    if (!fail.length && !pending.length)
        out.push(s.checks.length ? '- all green' : '- no checks');
    out.push('', '## Reviews', '');
    const reviews = s.reviews.filter((r) => r.author.login !== s.me);
    out.push(...(reviews.length ? reviews.map((r) => `- ${r.author.login}: ${r.state} ${stamp(r.submittedAt)}`) : ['- none yet']));
    const open = s.threads.filter((t) => !t.isResolved);
    const waiting = threadsAwaitingMe(s);
    out.push('', `## Unresolved threads: ${open.length} (${waiting.length} awaiting my reply or fix)`, '');
    for (const t of waiting) {
        out.push(`- ${t.path}${t.line ? `:${t.line}` : ''}${t.isOutdated ? ' (outdated)' : ''} · ${t.first.author.login} ${stamp(t.first.createdAt)}${t.count > 1 ? ` · ${t.count} comments, last by ${t.last.author.login}` : ''} · ${t.first.url ?? ''}`);
        out.push(`  > ${clip(t.first.body, MAX_BODY)}`);
        if (t.count > 1)
            out.push(`  > (last) ${clip(t.last.body, MAX_BODY)}`);
    }
    if (open.length > waiting.length)
        out.push(`- ${open.length - waiting.length} more where I replied last (waiting for the reviewer to resolve)`);
    const since = s.lastPush ? Date.parse(s.lastPush) : 0;
    const recent = s.comments.filter((c) => c.author.login !== s.me && Date.parse(c.createdAt) > since);
    if (recent.length) {
        out.push('', '## Conversation comments since the last commit', '');
        for (const c of recent)
            out.push(`- ${c.author.login} ${stamp(c.createdAt)}: ${clip(c.body, MAX_BODY)}`);
    }
    return out.filter((l, i, a) => !(l === '' && a[i - 1] === '')).join('\n');
}
/**
 * Prints a PR's CI checks (failed jobs with the relevant log lines), reviews and unresolved review
 * threads. With --wait, polls until no check is pending and exits 1 when one failed.
 */
export async function runPrStatus(pr, opts, gh = defaultGh) {
    const cwd = path.resolve(opts.repo ?? '.');
    const interval = Number(opts.interval ?? 60);
    const timeout = Number(opts.timeout ?? 90);
    const maxLog = Number(opts.logLines ?? 25);
    if (!(interval > 0) || !(timeout > 0) || !(maxLog > 0))
        throw new Error('--interval, --timeout and --log-lines take positive numbers.');
    const deadline = Date.now() + timeout * 60_000;
    let s = fetchPrState(gh, cwd, pr);
    while (opts.wait && s.checks.some((c) => c.bucket === 'pending') && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, interval * 1000));
        s = fetchPrState(gh, cwd, pr);
    }
    const logFor = (job) => {
        try {
            return digestLog(gh(cwd, ['run', 'view', '--job', job, '--log-failed']), maxLog);
        }
        catch {
            return ['(log not available yet)'];
        }
    };
    console.log(renderPrStatus(s, logFor));
    if (opts.wait) {
        if (s.checks.some((c) => c.bucket === 'pending'))
            console.log(`\nStill pending after ${timeout} min.`);
        if (s.checks.some((c) => c.bucket === 'fail'))
            process.exitCode = 1;
    }
}
export function snapshotOf(s) {
    return {
        number: s.number,
        title: s.title,
        url: s.url,
        key: keyFromBranch(s.headRefName),
        head: s.headRefOid,
        failed: s.checks.filter((c) => c.bucket === 'fail').map((c) => c.name).sort(),
        pending: s.checks.filter((c) => c.bucket === 'pending').length,
        reviews: Object.fromEntries(s.reviews.filter((r) => r.author.login !== s.me).map((r) => [r.author.login, `${r.state}@${r.submittedAt}`])),
        awaiting: threadsAwaitingMe(s).length,
        comments: s.comments.filter((c) => c.author.login !== s.me).length,
    };
}
/** What changed for one PR between two watch runs, as a CHANGES.md line (undefined when nothing did). */
export function describePrChange(prev, cur) {
    const label = `PR #${cur.number}${cur.key ? ` (${cur.key})` : ''}`;
    const parts = [];
    const settled = cur.pending === 0;
    if (!prev) {
        if (cur.failed.length)
            parts.push(`CI failed: ${cur.failed.join(', ')}`);
        if (cur.awaiting)
            parts.push(`${cur.awaiting} review thread(s) awaiting me`);
        return parts.length ? `${label}: ${parts.join('; ')} — jirallm pr-status ${cur.number}` : undefined;
    }
    const newFails = cur.failed.filter((f) => prev.head !== cur.head || !prev.failed.includes(f));
    if (newFails.length)
        parts.push(`CI failed: ${newFails.join(', ')}`);
    else if (settled && !cur.failed.length && (prev.failed.length || (prev.pending > 0 && prev.head === cur.head) || prev.head !== cur.head))
        parts.push('CI green');
    for (const [who, st] of Object.entries(cur.reviews))
        if (prev.reviews[who] !== st)
            parts.push(`${who} reviewed: ${st.split('@')[0]}`);
    if (cur.awaiting > prev.awaiting)
        parts.push(`${cur.awaiting - prev.awaiting} new review thread(s)/repl(ies) awaiting me`);
    if (cur.comments > prev.comments)
        parts.push(`${cur.comments - prev.comments} new comment(s)`);
    return parts.length ? `${label}: ${parts.join('; ')} — jirallm pr-status ${cur.number}` : undefined;
}
/** Head commit plus each check's bucket: changes on a push and whenever a check starts or finishes. */
export function checksSignature(head, rollup) {
    return [head, ...latestRuns(rollup).map(toCheck).map((c) => `${c.name}:${c.bucket}`).sort()].join('|');
}
/** My open PRs in the repo at `cwd` with their checks signature, in one call. */
export function myOpenPrs(gh, cwd) {
    const prs = JSON.parse(gh(cwd, ['pr', 'list', '--author', '@me', '--state', 'open', '--json', 'number,headRefOid,statusCheckRollup', '--limit', '50']));
    return prs.map((p) => ({ number: p.number, sig: checksSignature(p.headRefOid, p.statusCheckRollup ?? []) }));
}
/** Splits `gh api -i` output into status, headers and body. */
export function parseHttp(raw) {
    const [head = '', ...rest] = raw.split(/\r?\n\r?\n/);
    const [statusLine = '', ...headerLines] = head.split(/\r?\n/);
    const headers = Object.fromEntries(headerLines.map((l) => [l.slice(0, l.indexOf(':')).toLowerCase(), l.slice(l.indexOf(':') + 1).trim()]));
    return { status: Number(/HTTP\/\S+ (\d+)/.exec(statusLine)?.[1] ?? 0), headers, body: rest.join('\n\n') };
}
/**
 * PRs in the repo of `cwd` with a GitHub notification (review, comment, CI activity, …) since the
 * previous call. Sends If-Modified-Since, so a quiet poll is a 304 that costs no rate limit.
 * `prs` is undefined when the call failed and the caller should refresh everything.
 */
export function notifiedPrs(gh, cwd, repo, lastModified, since) {
    const args = ['api', '-i', `/notifications?all=true&per_page=50${since ? `&since=${encodeURIComponent(since)}` : ''}`];
    if (lastModified)
        args.push('-H', `If-Modified-Since: ${lastModified}`);
    let raw;
    try {
        raw = gh(cwd, args);
    }
    catch (err) {
        raw = String(err.stdout ?? '');
    }
    const res = parseHttp(raw);
    if (res.status === 304)
        return { prs: [], lastModified };
    if (res.status !== 200)
        return { lastModified };
    const items = JSON.parse(res.body);
    const prs = items
        .filter((n) => n.repository.full_name.toLowerCase() === repo.toLowerCase() && n.subject.type === 'PullRequest')
        .map((n) => Number(/\/pulls\/(\d+)$/.exec(n.subject.url ?? '')?.[1]))
        .filter((n) => n > 0);
    return { prs: [...new Set(prs)], lastModified: res.headers['last-modified'] ?? lastModified };
}
/** `owner/name` of the repo at `cwd`. */
export const repoSlug = (gh, cwd) => gh(cwd, ['repo', 'view', '--json', 'nameWithOwner', '-q', '.nameWithOwner']).trim();
/**
 * Shows a Windows toast (no-op elsewhere); clicking it opens `url`. Uses Windows PowerShell, which
 * still has the WinRT notification API, under PowerShell's own app id.
 */
export function toast(title, lines, url) {
    if (process.platform !== 'win32')
        return;
    const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const body = lines.slice(0, 3).map((l) => `<text>${esc(l.length > 120 ? `${l.slice(0, 120)}…` : l)}</text>`).join('');
    const launch = url ? ` activationType="protocol" launch="${esc(url)}"` : '';
    const xml = `<toast${launch}><visual><binding template="ToastGeneric"><text>${esc(title)}</text>${body}</binding></visual></toast>`;
    const script = [
        '[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] > $null',
        '[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] > $null',
        '$x = New-Object Windows.Data.Xml.Dom.XmlDocument',
        `$x.LoadXml('${xml.replace(/'/g, "''")}')`,
        "[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe').Show([Windows.UI.Notifications.ToastNotification]::new($x))",
    ].join('\n');
    try {
        execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { stdio: 'ignore', timeout: 20_000 });
    }
    catch { /* a missed toast must not fail the watch run */ }
}
export { defaultGh };
//# sourceMappingURL=prStatus.js.map