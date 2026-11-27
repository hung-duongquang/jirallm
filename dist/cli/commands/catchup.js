/**
 * `jirallm catchup`: one brief of what happened while the user was away (a weekend, a holiday): their
 * work as they left it (open tickets, open PRs, unpushed worktrees, closed sessions with news), what
 * needs them (review requests, tickets newly assigned, Slack mentions and DMs, unread mail), today's
 * meetings and what the watch logged meanwhile. Read only: nothing is answered, moved or marked read.
 * Each source fails on its own ("could not read …") so one missing login does not hide the rest.
 */
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { listOrgs, loadProfile } from '../../lib/config.js';
import { confluenceForMe, forMeLine, githubForMe, jiraForMe } from './forMe.js';
import { JiraClient } from '../../lib/jiraClient.js';
import { hasSlackToken, loadSlackAuth, SlackClient } from '../../lib/slack.js';
import { closedSessionNews, IMPORTANT, stampOf } from './closedSessions.js';
/** A gap without prompts this long counts as being away (a night, a weekend, a holiday). */
const AWAY_GAP_MS = 8 * 3600 * 1000;
const DAY_MS = 24 * 3600 * 1000;
// ---------------------------------------------------------------------------------------------
// Since when
// ---------------------------------------------------------------------------------------------
/**
 * `--since`: "4d" / "36h", a day (YYYY-MM-DD, local midnight) or a local time ("YYYY-MM-DD HH:MM").
 * Without it: the user's last prompt before the latest gap of 8 hours or more (the plugin keeps each
 * session's last prompt in <tmp>/jirallm-sessions/<id>.last), else 24 hours ago.
 */
export function resolveSince(value, sessionsDir, now = Date.now()) {
    if (value) {
        const rel = /^(\d+)\s*([dh])$/i.exec(value.trim());
        if (rel)
            return now - Number(rel[1]) * (rel[2].toLowerCase() === 'd' ? DAY_MS : 3600 * 1000);
        const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?$/.exec(value.trim());
        if (!m)
            throw new Error(`--since needs "4d", "36h", YYYY-MM-DD or "YYYY-MM-DD HH:MM", got: ${value}`);
        const [, y, mo, d, h = '0', mi = '0'] = m;
        return new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi)).getTime();
    }
    return lastActiveBeforeGap(promptTimes(sessionsDir), now) ?? now - DAY_MS;
}
function promptTimes(sessionsDir) {
    const times = [];
    let files;
    try {
        files = readdirSync(sessionsDir).filter((f) => f.endsWith('.last'));
    }
    catch {
        return times;
    }
    for (const f of files) {
        try {
            const t = Date.parse(readFileSync(path.join(sessionsDir, f), 'utf8').trim());
            if (!Number.isNaN(t))
                times.push(t);
        }
        catch {
            // Skipped.
        }
    }
    return times;
}
/** The newest activity before the newest gap of AWAY_GAP_MS (counting the gap up to now). */
export function lastActiveBeforeGap(times, now) {
    const sorted = [now, ...times.filter((t) => t <= now)].sort((a, b) => b - a);
    for (let i = 0; i + 1 < sorted.length; i++)
        if (sorted[i] - sorted[i + 1] >= AWAY_GAP_MS)
            return sorted[i + 1];
    return undefined;
}
// ---------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------
const errText = (err) => {
    const e = err;
    const lines = String(e?.stderr || e?.message || err).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    return (lines.at(-1) ?? 'unknown error').slice(0, 200);
};
const oneLine = (text, max = 110) => {
    const line = text.replace(/<@[A-Z0-9]+>/g, '@…').replace(/<([^|>]+)\|([^>]+)>/g, '$2').replace(/<([^>]+)>/g, '$1').replace(/\s+/g, ' ').trim();
    return line.length > max ? `${line.slice(0, max - 1)}…` : line;
};
const pad = (n) => String(n).padStart(2, '0');
/** Local "Thu 20 Nov 10:04". */
export function when(ms) {
    const d = new Date(ms);
    const day = d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }).replace(',', '');
    return `${day} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
const jqlTime = (ms) => {
    const d = new Date(ms);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
function run(cmd, args, cwd, timeoutMs = 60_000) {
    return new Promise((resolve, reject) => {
        execFile(cmd, args, { cwd, encoding: 'utf8', timeout: timeoutMs, windowsHide: true, maxBuffer: 32 * 1024 * 1024 }, (err, stdout, stderr) => {
            if (err)
                reject(Object.assign(err, { stderr }));
            else
                resolve(stdout);
        });
    });
}
// ---------------------------------------------------------------------------------------------
// Jira
// ---------------------------------------------------------------------------------------------
const fieldName = (v) => (v && typeof v === 'object' && 'name' in v ? String(v.name) : '');
const displayName = (v) => (v && typeof v === 'object' && 'displayName' in v ? String(v.displayName) : 'unassigned');
let profilePromise;
/** The Jira profile (the only org when one is configured), loaded once for all sections. */
function catchupProfile() {
    const orgs = listOrgs();
    profilePromise ??= loadProfile({ org: orgs.length === 1 ? orgs[0] : undefined });
    return profilePromise;
}
async function jiraSections(since) {
    const profile = await catchupProfile();
    const client = new JiraClient(profile.config, profile.apiToken);
    const base = profile.config.baseUrl.replace(/\/+$/, '');
    const link = (key) => `[${key}](${base}/browse/${key})`;
    const at = jqlTime(since);
    const fields = ['summary', 'status', 'updated', 'assignee'];
    const [mine, assigned, watched] = await Promise.all([
        client.searchIssues('assignee = currentUser() AND statusCategory != Done ORDER BY updated DESC', { fields, limit: 50 }),
        client.searchIssues(`assignee changed to currentUser() after "${at}" ORDER BY updated DESC`, { fields, limit: 30 }),
        client.searchIssues(`(watcher = currentUser() OR reporter = currentUser()) AND (assignee != currentUser() OR assignee is EMPTY) AND updated >= "${at}" ORDER BY updated DESC`, { fields, limit: 30 }),
    ]);
    const changed = (i) => Date.parse(String(i.fields.updated ?? '')) >= since;
    const newly = new Set(assigned.issues.map((i) => i.key));
    const row = (i, extra = '') => `${link(i.key)} · ${fieldName(i.fields.status)} · ${oneLine(String(i.fields.summary ?? ''), 90)}${extra}`;
    return [
        {
            title: 'Jira: assigned to you since',
            lines: assigned.issues.map((i) => row(i, ` · now ${displayName(i.fields.assignee)}`)),
        },
        {
            title: 'Jira: your open tickets',
            lines: mine.issues.map((i) => row(i, `${changed(i) ? ' · **changed since**' : ''}${newly.has(i.key) ? ' · new to you' : ''}`)),
        },
        {
            title: 'Jira: tickets you watch or reported that changed',
            lines: watched.issues.map((i) => row(i, ` · ${displayName(i.fields.assignee)}`)),
        },
    ];
}
/** "CI failed (2)", "CI running", "CI green" or "no CI". */
export function ciState(rollup) {
    const items = rollup ?? [];
    if (!items.length)
        return 'no CI';
    const outcome = (c) => (c.conclusion || c.state || '').toUpperCase();
    const failed = items.filter((c) => ['FAILURE', 'TIMED_OUT', 'CANCELLED', 'ACTION_REQUIRED', 'ERROR', 'STARTUP_FAILURE'].includes(outcome(c))).length;
    if (failed)
        return `**CI failed (${failed})**`;
    if (items.some((c) => (c.status && c.status.toUpperCase() !== 'COMPLETED') || ['PENDING', 'EXPECTED'].includes(outcome(c))))
        return 'CI running';
    return 'CI green';
}
async function githubSections(repoDir, since) {
    const day = new Date(since - DAY_MS).toISOString().slice(0, 10);
    const [mineRaw, reviewRaw, mergedRaw] = await Promise.all([
        run('gh', ['pr', 'list', '--author', '@me', '--state', 'open', '--json', 'number,title,url,isDraft,reviewDecision,mergeable,updatedAt,statusCheckRollup', '--limit', '30'], repoDir),
        run('gh', ['pr', 'list', '--search', 'review-requested:@me', '--state', 'open', '--json', 'number,title,url,author,updatedAt', '--limit', '30'], repoDir),
        run('gh', ['pr', 'list', '--author', '@me', '--state', 'merged', '--search', `merged:>=${day}`, '--json', 'number,title,url,mergedAt', '--limit', '30'], repoDir),
    ]);
    const mine = JSON.parse(mineRaw);
    const review = JSON.parse(reviewRaw);
    const merged = JSON.parse(mergedRaw).filter((p) => Date.parse(p.mergedAt) >= since);
    const decision = (d) => (d === 'APPROVED' ? '**approved**' : d === 'CHANGES_REQUESTED' ? '**changes requested**' : d === 'REVIEW_REQUIRED' ? 'review required' : 'no review yet');
    return [
        {
            title: 'GitHub: your review is requested',
            lines: review.map((p) => `[#${p.number}](${p.url}) by ${p.author?.login ?? '?'} · ${oneLine(p.title, 90)}`),
        },
        {
            title: 'GitHub: your open PRs',
            lines: mine.map((p) => [
                `[#${p.number}](${p.url})${p.isDraft ? ' (draft)' : ''} · ${decision(p.reviewDecision)} · ${ciState(p.statusCheckRollup)}`,
                p.mergeable === 'CONFLICTING' ? '**conflicts**' : '',
                Date.parse(p.updatedAt) >= since ? 'activity since' : '',
                oneLine(p.title, 80),
            ]
                .filter(Boolean)
                .join(' · ')),
        },
        { title: 'GitHub: your PRs merged since', lines: merged.map((p) => `[#${p.number}](${p.url}) · ${oneLine(p.title, 90)}`) },
    ];
}
/** A worktree whose last commit is older than this before `since` is old work: left out. */
const WORKTREE_RECENT_MS = 14 * DAY_MS;
/**
 * Worktrees of the repo, recently committed to, with commits on no remote branch (so a branch whose
 * PR was squash-merged and whose remote branch still exists does not count) or files not committed.
 */
async function worktreeSection(repoDir, since) {
    const list = await run('git', ['worktree', 'list', '--porcelain'], repoDir);
    const trees = list
        .split(/\r?\n\r?\n/)
        .map((block) => ({ dir: /^worktree (.+)$/m.exec(block)?.[1], branch: /^branch refs\/heads\/(.+)$/m.exec(block)?.[1] }))
        .filter((t) => Boolean(t.dir && t.branch && existsSync(t.dir)));
    const lines = [];
    await Promise.all(trees.map(async (t) => {
        try {
            const last = Number((await run('git', ['log', '-1', '--format=%ct'], t.dir, 20_000)).trim()) * 1000;
            if (last < since - WORKTREE_RECENT_MS)
                return;
            const dirty = (await run('git', ['status', '--porcelain', '--untracked-files=no'], t.dir, 20_000)).split(/\r?\n/).filter(Boolean).length;
            const n = Number((await run('git', ['rev-list', '--count', 'HEAD', '--not', '--remotes'], t.dir, 20_000)).trim());
            const ahead = n ? `${n} commit${n === 1 ? '' : 's'} on no remote branch` : '';
            const parts = [ahead, dirty ? `${dirty} changed file${dirty === 1 ? '' : 's'} not committed` : ''].filter(Boolean);
            if (parts.length && !/^(main|master|develop)$/.test(t.branch))
                lines.push(`${t.dir} (${t.branch}): ${parts.join(', ')}`);
        }
        catch {
            // A broken worktree: skipped.
        }
    }));
    return { title: 'Local: worktrees with unpushed work', lines: lines.sort() };
}
// ---------------------------------------------------------------------------------------------
// Slack
// ---------------------------------------------------------------------------------------------
/**
 * Slack since, not the user's own messages: each thread that tags the user is one line (its newest
 * tag), first; other direct messages are one line per conversation (people chat in a DM or group DM
 * without threads), with how many more messages it had.
 */
export function slackLines(matches, me, since) {
    const groups = new Map();
    const seen = new Set();
    for (const m of [...matches].sort((a, b) => Number(b.ts) - Number(a.ts))) {
        const id = `${m.channel?.id ?? ''}:${m.ts}`;
        if (seen.has(id))
            continue; // found by both searches
        seen.add(id);
        if (m.user === me || Number(m.ts) * 1000 < since || !m.permalink)
            continue;
        const tag = (m.text ?? '').includes(`<@${me}>`);
        const thread = /[?&]thread_ts=([\d.]+)/.exec(m.permalink)?.[1] ?? m.ts;
        const key = `${m.channel?.id ?? ''}:${tag ? thread : 'dm'}`;
        const known = groups.get(key);
        if (!known)
            groups.set(key, { ...m, count: 1, tag });
        else
            known.count++;
    }
    return [...groups.values()]
        .sort((a, b) => Number(b.tag) - Number(a.tag) || Number(b.ts) - Number(a.ts))
        .map((m) => {
        const where = m.channel?.is_im ? 'DM' : m.channel?.is_mpim ? 'group DM' : m.channel?.name ? `#${m.channel.name}` : 'Slack';
        const more = m.count > 1 ? ` (+${m.count - 1} more)` : '';
        const what = m.tag ? '**tagged you**' : 'wrote';
        return `${when(Number(m.ts) * 1000)} · ${m.username ?? 'someone'} ${what} in ${where}${more}: "${oneLine(m.text ?? '')}" — [open](${m.permalink})`;
    });
}
async function slackSection(since, client) {
    const slack = client ?? new SlackClient(await loadSlackAuth());
    const me = (await slack.call('auth.test', {})).user_id;
    if (!me)
        throw new Error('Slack did not say who you are');
    const day = new Date(since - DAY_MS).toISOString().slice(0, 10);
    // Two searches: messages that tag the user, and direct messages to them (no tag needed).
    // Separate caps: a busy group DM must not push the tags out.
    const tags = await slack.search(`<@${me}> after:${day}`, 100);
    const dms = await slack.search(`to:<@${me}> after:${day}`, 300);
    return { title: 'Slack: mentions and direct messages', lines: slackLines([...tags.matches, ...dms.matches], me, since) };
}
const OUTLOOK_PS = String.raw `
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$since = [DateTime]::Parse($env:JIRALLM_SINCE).ToUniversalTime()
# Only an Outlook that is open: starting one over COM (New-Object) runs a hidden classic Outlook,
# which hangs on its first-run screen when the user reads mail in the new Outlook (no COM there).
# Once the default profile has a mail account (it was set up), starting it is safe; it syncs first.
$started = $false
try { $ol = [Runtime.InteropServices.Marshal]::GetActiveObject('Outlook.Application') }
catch {
  $root = 'HKCU:\Software\Microsoft\Office\16.0\Outlook'
  $profileName = (Get-ItemProperty $root -ErrorAction SilentlyContinue).DefaultProfile
  if (-not $profileName) { $profileName = 'Outlook' }
  $accounts = Get-ChildItem "$root\Profiles\$profileName\9375CFF0413111d3B88A00104B2A6676" -ErrorAction SilentlyContinue
  if (-not $accounts) { [Console]::Error.WriteLine('classic Outlook is not set up (the new Outlook has no COM): open "Outlook (classic)" once and sign in; mail and calendar skipped'); exit 3 }
  $ol = New-Object -ComObject Outlook.Application
  $started = $true
}
if ($started) {
  try { $ol.GetNamespace('MAPI').SendAndReceive($false) } catch {}
  Start-Sleep -Seconds 20
}
$ns = $ol.GetNamespace('MAPI')
$me = $ns.CurrentUser.Name
$filter = '@SQL="urn:schemas:httpmail:datereceived" >= ''' + $since.ToString('yyyy-MM-dd HH:mm') + ''''
$items = $ns.GetDefaultFolder(6).Items.Restrict($filter)
$items.Sort('[ReceivedTime]', $true)
$mails = @()
foreach ($m in $items) {
  if ($mails.Count -ge 300) { break }
  if ($m.Class -ne 43) { continue }
  $body = ''
  try { $body = [string]$m.Body } catch {}
  if ($body.Length -gt 400) { $body = $body.Substring(0, 400) }
  $to = ''
  try { $to = [string]$m.To } catch {}
  $mails += [pscustomobject]@{
    subject = [string]$m.Subject; from = [string]$m.SenderName; received = $m.ReceivedTime.ToString('o')
    unread = [bool]$m.UnRead; important = ($m.Importance -eq 2); flagged = ($m.FlagStatus -eq 2)
    toMe = ($me -and $to -like "*$me*"); preview = $body
  }
}
$cal = $ns.GetDefaultFolder(9).Items
$cal.Sort('[Start]')
$cal.IncludeRecurrences = $true
$today = [DateTime]::Today
$fmt = 'g'
$range = "[Start] < '" + $today.AddDays(1).ToString($fmt) + "' AND [End] > '" + $today.ToString($fmt) + "'"
$meetings = @()
foreach ($a in $cal.Restrict($range)) {
  if ($meetings.Count -ge 30) { break }
  $meetings += [pscustomobject]@{ subject = [string]$a.Subject; start = $a.Start.ToString('o'); end = $a.End.ToString('o'); location = [string]$a.Location; allDay = [bool]$a.AllDayEvent }
}
[pscustomobject]@{ mails = @($mails); meetings = @($meetings) } | ConvertTo-Json -Depth 4 -Compress
`;
async function readOutlook(since) {
    if (process.platform !== 'win32')
        throw new Error('Outlook is read over COM, on Windows only');
    const out = await new Promise((resolve, reject) => {
        execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', OUTLOOK_PS], { encoding: 'utf8', timeout: 120_000, windowsHide: true, maxBuffer: 32 * 1024 * 1024, env: { ...process.env, JIRALLM_SINCE: new Date(since).toISOString() } }, (err, stdout, stderr) => (err ? reject(Object.assign(err, { stderr: stderr || 'Outlook (classic) is not available' })) : resolve(stdout)));
    });
    const data = JSON.parse(out.trim() || '{}');
    const list = (v) => (Array.isArray(v) ? v : v ? [v] : []);
    return { mails: list(data.mails), meetings: list(data.meetings) };
}
/** Bulk mail by sender name: counted, not listed. */
const AUTOMATED = /jira|confluence|atlassian|github|slack|no-?reply|notification|noreply|azure devops|microsoft (teams|365|viva)|octopus|sentry|aws|newsletter|digest|cloudsmith|calendar|yammer|viva engage|datadog|gitkraken|\[bot\]/i;
/**
 * The tool a notification comes from. GitHub and Jira send mail under the name of the person who
 * acted ("Anne Erdtsieck-Wijnen" for her PR comment), so the subject tells them apart, not the sender.
 */
export function mailTool(m) {
    const subject = m.subject.replace(/^((re|fw|fwd|aw|antw):\s*)+/i, '');
    if (/^\[[\w.-]+\/[\w.-]+\]/.test(subject) || /github/i.test(m.from))
        return 'GitHub';
    if (/^\[JIRA\]/i.test(subject) || /\(Jira\)|jira/i.test(m.from))
        return 'Jira';
    if (/^\[Confluence\]/i.test(subject) || /confluence/i.test(m.from))
        return 'Confluence';
    if (AUTOMATED.test(m.from))
        return m.from;
    return undefined;
}
export function mailSections(mails) {
    const automated = (m) => mailTool(m) !== undefined;
    // Mail from people; the same subject again (a reminder sent weekly, a thread) once, with a count.
    const bySubject = new Map();
    for (const m of [...mails].filter((x) => !automated(x)).sort((a, b) => Date.parse(b.received) - Date.parse(a.received))) {
        const key = `${m.from}:${m.subject.replace(/^((re|fw|fwd|aw|antw):\s*)+/i, '').replace(/\d+/g, '#').toLowerCase()}`;
        const known = bySubject.get(key);
        if (!known)
            bySubject.set(key, { ...m, times: 1 });
        else {
            known.times++;
            known.unread ||= m.unread;
        }
    }
    const people = [...bySubject.values()];
    const bulk = mails.filter(automated);
    const preview = (m) => oneLine(m.preview.replace(/^(?:\s*(?:Hi|Hoi|Hallo|Dear|Beste)\b[^\n]*\n)?/i, ''), 120);
    const row = (m) => [
        `${when(Date.parse(m.received))} · ${m.from}${m.times > 1 ? ` (×${m.times})` : ''}`,
        [m.unread ? 'unread' : '', m.important ? '**important**' : '', m.flagged ? 'flagged' : '', m.toMe ? '' : 'cc/list'].filter(Boolean).join(', '),
        `**${oneLine(m.subject, 90) || '(no subject)'}**`,
        preview(m),
    ]
        .filter(Boolean)
        .join(' · ');
    // Unread and addressed to the user first; read ones after.
    const rank = (m) => (m.unread ? 0 : 2) + (m.toMe ? 0 : 1);
    const counts = new Map();
    for (const m of bulk) {
        const tool = mailTool(m) ?? m.from;
        const c = counts.get(tool) ?? { n: 0, unread: 0, senders: new Map() };
        c.n++;
        if (m.unread)
            c.unread++;
        if (m.from !== tool)
            c.senders.set(m.from, (c.senders.get(m.from) ?? 0) + 1);
        counts.set(tool, c);
    }
    const top = (senders) => senders.size ? ` — ${[...senders].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([s, n]) => `${s} ${n}`).join(', ')}${senders.size > 4 ? ', …' : ''}` : '';
    return [
        { title: 'Mail from people', lines: people.sort((a, b) => rank(a) - rank(b) || Date.parse(b.received) - Date.parse(a.received)).slice(0, 60).map(row) },
        {
            title: 'Mail: notifications and bulk (counted; mentions and review requests are listed above)',
            lines: [...counts].sort((a, b) => b[1].n - a[1].n).map(([tool, c]) => `${tool}: ${c.n}${c.unread ? ` (${c.unread} unread)` : ''}${top(c.senders)}`),
        },
    ];
}
export function meetingLines(meetings) {
    const hm = (iso) => {
        const d = new Date(iso);
        return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
    };
    return meetings.map((m) => `${m.allDay ? 'all day' : `${hm(m.start)}–${hm(m.end)}`} · ${oneLine(m.subject, 90)}${m.location ? ` · ${oneLine(m.location, 40)}` : ''}`);
}
// ---------------------------------------------------------------------------------------------
// Local: closed sessions, the watch log
// ---------------------------------------------------------------------------------------------
function closedSessionsSection(outputDir, sessionsDir, since) {
    const news = closedSessionNews(outputDir, sessionsDir, Date.now(), stampOf(since));
    return {
        title: 'Claude sessions you left with news waiting',
        lines: news.map((n) => `${n.title} (\`jirallm resume ${n.id}\`): ${n.lines.slice(0, 3).join('; ')}${n.lines.length > 3 ? ` (+${n.lines.length - 3} more)` : ''}`),
    };
}
/** The watch's CHANGES.md since: important lines (reviews, failed CI, merges, comments, replies) listed, the rest counted. */
export function watchLogSection(outputDir, since) {
    let text;
    try {
        text = readFileSync(path.join(outputDir, 'CHANGES.md'), 'utf8');
    }
    catch {
        return { title: 'Logged by the watch', lines: [] };
    }
    const stamp = stampOf(since);
    const latest = new Map();
    let current = '';
    let other = 0;
    for (const line of text.split(/\r?\n/)) {
        const head = /^## (\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})/.exec(line);
        if (head)
            current = head[1];
        else if (current >= stamp && line.startsWith('- ')) {
            const body = line.slice(2);
            if (!IMPORTANT.test(body)) {
                other++;
                continue;
            }
            latest.set(body.split(':')[0], `${current.slice(5, 16)} ${body}`);
        }
    }
    const lines = [...latest.values()].sort().reverse().slice(0, 40);
    if (other)
        lines.push(`… and ${other} status, sprint and field changes (\`jirallm changes --max 100\`)`);
    return { title: 'Logged by the watch (reviews, CI, merges, comments, replies)', lines };
}
// ---------------------------------------------------------------------------------------------
// The brief
// ---------------------------------------------------------------------------------------------
export function renderBrief(since, now, sections, failures) {
    const out = [`# Catch-up since ${when(since)}`, '', `Made ${when(now)} by \`jirallm catchup\` (read only). Empty sections are left out.`, ''];
    if (failures.length)
        out.push('Could not read:', ...failures.map((f) => `- ${f}`), '');
    for (const s of sections) {
        if (!s.lines.length)
            continue;
        out.push(`## ${s.title} (${s.lines.length})`, '', ...s.lines.map((l) => `- ${l}`), '');
    }
    return out.join('\n');
}
export async function runCatchup(opts = {}, deps = {}) {
    const now = deps.now ?? Date.now();
    const sessionsDir = deps.sessionsDir ?? path.join(os.tmpdir(), 'jirallm-sessions');
    const outputDir = path.resolve(opts.outputDir ?? './jira-export');
    const since = resolveSince(opts.since, sessionsDir, now);
    const repoDir = path.resolve(opts.repo ?? (existsSync('./zorgdeclaraties/.git') ? './zorgdeclaraties' : '.'));
    const failures = [];
    const guard = async (name, job, fallback) => {
        try {
            return await job();
        }
        catch (err) {
            failures.push(`${name}: ${errText(err)}`);
            return fallback;
        }
    };
    process.stderr.write(`Catching up since ${when(since)}: Jira, GitHub, Slack${opts.mail === false ? '' : ', Outlook'}…\n`);
    const mentionSource = async (name, job) => guard(name, job, []);
    const mentionsJob = Promise.all([
        opts.jira === false ? [] : mentionSource('Jira mentions', async () => jiraForMe(await catchupProfile(), since)),
        opts.jira === false ? [] : mentionSource('Confluence mentions', async () => confluenceForMe(await catchupProfile(), since)),
        opts.github === false ? [] : mentionSource('GitHub mentions', () => githubForMe(since)),
    ]).then((lists) => lists.flat().filter((i) => i.kind !== 'assigned').sort((a, b) => b.at - a.at));
    const [jira, github, worktrees, slack, outlook] = await Promise.all([
        opts.jira === false ? [] : guard('Jira', () => jiraSections(since), []),
        opts.github === false ? [] : guard('GitHub', () => githubSections(repoDir, since), []),
        guard('worktrees', () => worktreeSection(repoDir, since), { title: '', lines: [] }),
        opts.slack === false
            ? undefined
            : guard('Slack', async () => ((await hasSlackToken()) ? slackSection(since) : Promise.reject(new Error('no token (`jirallm slack:auth`)'))), undefined),
        opts.mail === false ? undefined : guard('Outlook', () => readOutlook(since), undefined),
    ]);
    const mentions = await mentionsJob;
    const byTitle = (list, prefix) => list.filter((s) => s.title.startsWith(prefix));
    const sections = [
        // What needs you
        { title: 'Mentions of you (Jira comments, Confluence, GitHub)', lines: mentions.map((i) => `${when(i.at)} · [${forMeLine(i)}](${i.url})`) },
        ...byTitle(github, 'GitHub: your review'),
        ...byTitle(jira, 'Jira: assigned to you since'),
        ...(slack ? [slack] : []),
        ...(outlook ? mailSections(outlook.mails).slice(0, 1) : []),
        // Your work as you left it
        ...byTitle(github, 'GitHub: your open'),
        ...byTitle(jira, 'Jira: your open'),
        worktrees,
        closedSessionsSection(outputDir, sessionsDir, since),
        // Today
        ...(outlook ? [{ title: 'Today in your calendar', lines: meetingLines(outlook.meetings) }] : []),
        // Around you
        ...byTitle(github, 'GitHub: your PRs merged'),
        ...byTitle(jira, 'Jira: tickets you watch'),
        watchLogSection(outputDir, since),
        ...(outlook ? mailSections(outlook.mails).slice(1) : []),
    ];
    const brief = renderBrief(since, now, sections, failures);
    if (!opts.print) {
        const dir = path.join(outputDir, 'catchup');
        mkdirSync(dir, { recursive: true });
        const d = new Date(now);
        const file = path.join(dir, `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.md`);
        writeFileSync(file, brief);
        process.stderr.write(`Written to ${path.relative(process.cwd(), file) || file}\n`);
    }
    return brief;
}
//# sourceMappingURL=catchup.js.map