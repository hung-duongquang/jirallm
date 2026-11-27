/**
 * What is addressed to the user, found at the source instead of in mail (the mailbox may be out of
 * reach): Jira comments that mention them, Confluence content that mentions them, GitHub
 * notifications for a mention or an assignment, and Jira tickets newly assigned to them. Used by
 * `jirallm catchup` (since a time) and by `watch --for-me` (since its last round: a change line and a
 * toast; "Start in Claude" on an assignment runs `jirallm ticket:handle <KEY>`).
 */
import { execFile, spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { ConfluenceClient } from '../../lib/confluence.js';
import { JiraClient } from '../../lib/jiraClient.js';
import { defaultSite } from '../../lib/pagePublish.js';
const pad = (n) => String(n).padStart(2, '0');
const jqlTime = (ms) => {
    const d = new Date(ms);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const oneLine = (text, max = 120) => {
    const line = text.replace(/\s+/g, ' ').trim();
    return line.length > max ? `${line.slice(0, max - 1)}…` : line;
};
/** Plain text of an ADF document (mentions as @name) or of a wiki-markup string. */
export function adfText(node) {
    if (typeof node === 'string')
        return node.replace(/\[~accountid:[^\]]+\]/g, '@…');
    if (!node || typeof node !== 'object')
        return '';
    const n = node;
    if (n.type === 'text')
        return n.text ?? '';
    if (n.type === 'mention')
        return n.attrs?.text?.startsWith('@') ? n.attrs.text : `@${n.attrs?.text ?? '…'}`;
    if (n.type === 'hardBreak')
        return ' ';
    const inner = (n.content ?? []).map(adfText).join('');
    return /^(paragraph|heading|listItem|codeBlock|blockquote)$/.test(n.type ?? '') ? `${inner} ` : inner;
}
/** Comments created since that mention `me` (an ADF mention node or wiki [~accountid:…]), not by `me`. */
export function mentionsIn(issues, me, since, base) {
    const out = [];
    for (const issue of issues) {
        const comments = (issue.fields.comment?.comments ?? []);
        for (const c of comments) {
            if (Date.parse(c.created) < since || c.author?.accountId === me)
                continue;
            if (!JSON.stringify(c.body ?? '').includes(me))
                continue;
            out.push({
                id: `jira-comment:${c.id}`,
                kind: 'jira-mention',
                key: issue.key,
                from: c.author?.displayName ?? 'someone',
                title: String(issue.fields.summary ?? ''),
                text: oneLine(adfText(c.body)),
                url: `${base}/browse/${issue.key}?focusedCommentId=${c.id}`,
                at: Date.parse(c.created),
            });
        }
    }
    return out;
}
async function searchAll(client, jql, fields, max) {
    const all = [];
    let token;
    do {
        const page = await client.searchIssues(jql, { fields, limit: 100, nextPageToken: token });
        all.push(...page.issues);
        token = page.isLast ? undefined : page.nextPageToken;
    } while (token && all.length < max);
    return all.slice(0, max);
}
/** Jira: comments mentioning the user, and tickets assigned to them, since. */
export async function jiraForMe(profile, since) {
    const client = new JiraClient(profile.config, profile.apiToken);
    const base = profile.config.baseUrl.replace(/\/+$/, '');
    const me = (await client.getCurrentUser()).accountId;
    const at = jqlTime(since);
    // Jira search cannot find mentions: read the comments of everything updated since (one round of a
    // watch sees a few tickets; a catch-up after a holiday a few hundred).
    const [updated, assigned] = await Promise.all([
        searchAll(client, `updated >= "${at}" ORDER BY updated DESC`, ['summary', 'comment'], 400),
        searchAll(client, `assignee changed to currentUser() after "${at}" AND assignee = currentUser() ORDER BY updated DESC`, ['summary', 'status', 'updated'], 30),
    ]);
    return [
        ...mentionsIn(updated, me, since, base),
        ...assigned.map((i) => ({
            id: `assigned:${i.key}:${String(i.fields.updated ?? '')}`,
            kind: 'assigned',
            key: i.key,
            from: '',
            title: String(i.fields.summary ?? ''),
            text: i.fields.status?.name ?? '',
            url: `${base}/browse/${i.key}`,
            at: Date.parse(String(i.fields.updated ?? '')) || Date.now(),
        })),
    ];
}
/** Confluence pages, blog posts and comments that mention the user, modified since. */
export async function confluenceForMe(profile, since) {
    const client = new ConfluenceClient(defaultSite(profile), profile.config.userEmail, profile.apiToken);
    const day = new Date(since).toISOString().slice(0, 10);
    const { rows } = await client.search(`mention = currentUser() AND lastmodified >= "${day}" ORDER BY lastmodified DESC`, { limit: 25 });
    return rows
        .filter((r) => !r.lastModified || Date.parse(r.lastModified) >= since)
        .map((r) => ({
        id: `confluence:${r.id}:${r.lastModified}`,
        kind: 'confluence-mention',
        from: '',
        title: r.title,
        text: oneLine(r.excerpt.replace(/@@@(end)?hl@@@/g, '')),
        url: r.url,
        at: Date.parse(r.lastModified) || since,
    }));
}
/** API url of an issue or PR → its web page. */
export function webUrl(api, repo) {
    const m = /\/repos\/([^/]+\/[^/]+)\/(pulls|issues)\/(\d+)/.exec(api ?? '');
    return m ? `https://github.com/${m[1]}/${m[2] === 'pulls' ? 'pull' : 'issues'}/${m[3]}` : `https://github.com/${repo}`;
}
const GH_REASONS = { mention: 'mentioned you', team_mention: 'mentioned your team', assign: 'assigned you' };
/** GitHub notifications since for a mention or an assignment (review requests are listed elsewhere). */
export async function githubForMe(since) {
    const raw = await new Promise((resolve, reject) => execFile('gh', ['api', `notifications?all=true&participating=true&since=${new Date(since).toISOString()}&per_page=50`], { encoding: 'utf8', timeout: 30_000, windowsHide: true, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => (err ? reject(Object.assign(err, { stderr })) : resolve(stdout))));
    return JSON.parse(raw)
        .filter((n) => GH_REASONS[n.reason])
        .map((n) => {
        const num = /\/(\d+)$/.exec(n.subject.url ?? '')?.[1];
        return {
            id: `github:${n.id}:${n.updated_at}`,
            kind: 'github',
            key: /\b([A-Z][A-Z0-9]+-\d+)\b/.exec(n.subject.title)?.[1],
            from: n.repository.full_name,
            title: `${n.subject.type === 'PullRequest' ? 'PR' : n.subject.type} ${num ? `#${num}` : ''}`.trim(),
            text: `${GH_REASONS[n.reason]}: ${oneLine(n.subject.title, 100)}`,
            url: webUrl(n.subject.url, n.repository.full_name),
            at: Date.parse(n.updated_at),
        };
    });
}
/** One line for the change log / the catch-up brief. */
export function forMeLine(i) {
    switch (i.kind) {
        case 'jira-mention':
            return `${i.key}: ${i.from} mentioned you in a comment: "${i.text}"`;
        case 'assigned':
            return `${i.key}: assigned to you (${i.text}): "${oneLine(i.title, 90)}"`;
        case 'confluence-mention':
            return `Confluence "${oneLine(i.title, 80)}": mentions you${i.text ? `: "${i.text}"` : ''}`;
        case 'github':
            return `${i.title} (${i.from}): ${i.text}`;
    }
}
// ---------------------------------------------------------------------------------------------
// watch --for-me
// ---------------------------------------------------------------------------------------------
export const FOR_ME_STATE = '.watch.for-me.json';
/**
 * One watch round: what is new for the user since the last round (the first round only starts the
 * clock, so the backlog stays quiet). Items a running session started itself (a ticket it assigned to
 * the user with `jirallm start`) are left out by the caller.
 */
export async function forMeRound(outputDir, profile, opts = {}) {
    const now = opts.now ?? Date.now();
    const file = path.join(outputDir, FOR_ME_STATE);
    let state;
    try {
        state = JSON.parse(readFileSync(file, 'utf8'));
    }
    catch {
        // First round.
    }
    const save = (s) => {
        mkdirSync(outputDir, { recursive: true });
        writeFileSync(file, JSON.stringify({ since: s.since, told: s.told.slice(-300) }));
    };
    if (!state) {
        save({ since: now, told: [] });
        return { items: [], errors: [] };
    }
    // A minute of overlap: Jira's `updated` and search lag behind; `told` keeps items from coming twice.
    const since = state.since - 60_000;
    const sources = opts.sources ?? [(s) => jiraForMe(profile, s), (s) => confluenceForMe(profile, s), (s) => githubForMe(s)];
    const errors = [];
    const found = (await Promise.all(sources.map((src) => src(since).catch((err) => {
        errors.push(String(err?.stderr || (err instanceof Error ? err.message : err)).trim().split('\n').at(-1) ?? 'failed');
        return [];
    })))).flat();
    const told = new Set(state.told);
    const items = found.filter((i) => !told.has(i.id)).sort((a, b) => a.at - b.at);
    save({ since: errors.length ? state.since : now, told: [...state.told, ...items.map((i) => i.id)] });
    return { items, errors };
}
// ---------------------------------------------------------------------------------------------
// jirallm ticket:handle
// ---------------------------------------------------------------------------------------------
export const TICKET_KEY = /^[A-Z][A-Z0-9]{0,9}-\d{1,7}$/;
export function ticketPrompt(key) {
    return [
        `${key} was just assigned to me.`,
        `Export it with jirallm (with its parent and links), read it with its attachments and the Slack discussions about it, then tell me in short what is asked, what is unclear and how you would approach it.`,
        `Don't start work yet: no branch, worktree, Jira change or reply until I say so.`,
    ].join('\n');
}
/** `jirallm ticket:handle <KEY>`: a new Claude session on a ticket just assigned to the user, in the workspace. */
export async function runTicketHandle(key, opts = {}) {
    if (!TICKET_KEY.test(key))
        throw new Error(`Not a Jira key: ${key}`);
    const outputDir = path.resolve(opts.outputDir ?? './jira-export');
    process.on('SIGINT', () => { });
    const child = spawn('claude', [ticketPrompt(key)], { cwd: path.dirname(outputDir), stdio: 'inherit' });
    await new Promise((resolve) => {
        child.on('exit', (code) => {
            process.exitCode = code ?? 0;
            resolve();
        });
        child.on('error', (err) => {
            console.error(`Could not start claude: ${err.message}`);
            process.exitCode = 1;
            resolve();
        });
    });
}
//# sourceMappingURL=forMe.js.map