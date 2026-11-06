---
name: jirallm
description: Read and update Jira and Confluence, and read Slack and SharePoint, from the shell with jirallm. Use when a task mentions a Jira key (e.g. ZOD-1234), a sprint, a board column, or asks to assign, transition, comment or log work; when implementing a ticket, or reviewing or re-reviewing a pull request (also one named only by its number), checking it against the ticket and, if Slack is set up, the discussions where decisions not written in Jira were made; to read a pasted Slack message, SharePoint page or SharePoint Office document (slide deck, Word, Excel) link, or to change text in a PowerPoint deck on SharePoint, or find something on the company intranet; to find, read or write a Confluence page (spec, test report); to write up a ticket's business or technical context, documentation or a how-to-test for testers or the team; to test a ticket; before opening a pull request for a ticket branch; after a PR is raised, to follow its CI pipeline (failed checks and their logs) and code reviews (review threads, comments) until it is green and approved; or to check what changed in tickets or whether the local ticket context is current.
model: sonnet
---

# jirallm for agents

Output switches to JSON when stdout is piped. Prefer the compact forms below: they cost far fewer tokens.

## Read (safe, no side effects)

| Need | Command |
|---|---|
| Full ticket as markdown (description, AC, comments, attachments, linked Confluence pages) | `jirallm PROJ-1 --no-status-changes --output-dir ./jira-export` then read `jira-export/proj-1/task.md` |
| Ticket plus its parent chain / linked issues | add `--include-parent` / `--include-linked` |
| Quick look, no files | `jirallm fetch PROJ-1` |
| Exact field values the markdown lacks or renders wrong (custom fields, link metadata, IDs) | `jirallm fetch PROJ-1 --raw --fields <jira field ids>` (e.g. `issuelinks,customfield_10050`); avoid bare `--raw`, it returns every field |
| One Confluence page by URL (e.g. a test report) | `jirallm page <url>` → `jira-export/confluence/<id>-<slug>/page.md` |
| Find Confluence pages (plain words or CQL) | `jirallm page:search "<words>" [--space KEY] --format tsv`, then `jirallm page <url>` on a hit |
| A Slack message link (`https://<ws>.slack.com/archives/<channel>/p<id>`) or image/file link (`…/files/<user>/<F…>/<name>`, resolved to the message that shares it), with its thread | `jirallm slack <url>` prints Markdown, plus a section with channel messages posted after the thread started (people often answer in the channel instead of the thread; they can be unrelated, `--no-channel` drops them); `--output-dir ./jira-export` also saves images and extracts frames from videos (`<file>-frames/`, read them to see a screen recording). `--title` prints one line (`<first line> · #channel`; the plugin hook names a session after the Slack link in its first prompt). No token → ask the user to run `jirallm slack:auth` |
| A SharePoint page link (`https://<tenant>.sharepoint.com/sites/<site>/SitePages/<page>.aspx`), e.g. an intranet page | `jirallm sharepoint <url>` prints Markdown; `--output-dir ./jira-export` writes `jira-export/sharepoint/<site>-<page>/page.md` with its images. No session → ask the user to run `jirallm sharepoint:auth` |
| A SharePoint Office document link (PowerPoint/Word/Excel: `https://<tenant>.sharepoint.com/:p:/s/<site>/<token>`, `:w:`, `:x:`, or a path ending in .pptx/.docx/.xlsx), e.g. a slide deck | `jirallm sharepoint <url> --output-dir ./jira-export` writes `jira-export/sharepoint/<site>-<file>/document.md` (slide text and speaker notes, Word headings and tables, Excel sheets) and the original file. The local Office app opens it with the user's own sign-in, so no cookie is needed. Windows + Microsoft 365 only; don't download Office files with the SharePoint cookie |
| Change text in a PowerPoint deck on SharePoint (a team slide, speaker notes, a typo) | Confirm with the user first (it saves straight to the shared deck). Read it with `jirallm sharepoint <url>` (shape names show as `<!-- TextBox 18 -->`), then `jirallm sharepoint:edit <url> --slide <n> --shape "<name>" --text @file` (one line per paragraph), `--notes @file`, or `--find <old> --replace <new>`; several at once with `--edits edits.json`. Run with `--dry-run` first. Formatting per paragraph is kept; nothing changes if a target is not found. Trust only "SharePoint has every change": a COM save alone stays in the Office cache. "not on SharePoint yet" means it did not upload (tell the user). `--find` covers slide text, not notes. Don't script PowerPoint COM by hand |
| Find SharePoint / intranet pages (company policies, how-tos, who to ask) | `jirallm sharepoint:search '<words>'` (KQL; `--site <url>`, `--documents`): one TSV row per hit, open one with `jirallm sharepoint <url>`; prints "SharePoint not set up" when there is no session |
| Slack discussions of a ticket or PR (decisions not written in Jira) | `jirallm slack:search "PROJ-1 OR PROJ-0 OR pull/123" --after <ticket created>`: one TSV row per thread with its permalink; open the relevant ones with `jirallm slack <url>` |
| Child pages of a Confluence page (find where a new page goes) | `jirallm page:children <id or url> --format tsv` |
| List issues (compact) | `jirallm search --org <org> '<JQL>' --fields key,summary,status,assignee --format tsv --all` |
| Active sprint, by status | JQL `project = PROJ AND sprint in openSprints() AND status = "To Do"` |
| A board **column** (columns are not statuses) | `jirallm boards --org <org>` → `jirallm board:issues --help` |
| Valid transitions of an issue | `jirallm transition PROJ-1 --list` |
| Who am I / find a user | `jirallm me --org <org>`, `jirallm users <query> --org <org>` |
| Versions (releases) of a project, e.g. for a fix version | `jirallm versions --org <org> -P <project>` (the names `edit --fix-versions` expects) |
| Environment check | `jirallm doctor` |

Search tips: `--fields` takes friendly names (`key,summary,status,assignee,sprint,parent`) or raw ids (`customfield_10050`). `--format tsv` prints a header line and one line per issue; nested values collapse to their key or name. With `--all`, a "more results" note on stderr means the `--max` cap was hit.

jirallm or the Atlassian MCP server: use jirallm for ticket context (files on disk with images, attachments and linked pages, cheap to re-read), `start` and `qa`. If the Atlassian MCP tools are connected, they suit one-off questions, Rovo search across Jira and Confluence, and rarely used fields or link types. Don't fetch the same ticket through both.

## Write (changes Jira: confirm with the user first unless they asked for it)

| Action | Command |
|---|---|
| Start work: export + branch/worktree + assign me + In Progress | `jirallm start PROJ-1 --repo <repo> --worktree-root <dir> [--type bugfix] [--dry-run]` |
| Assign | `jirallm assign PROJ-1 me` (`none` unassigns) |
| Transition | `jirallm transition PROJ-1 --to "Code Review"` (positional status is an error) |
| Comment | `jirallm comment PROJ-1 --help` (markdown is converted) |
| Log work | `jirallm worklog PROJ-1 "1h 30m"` |
| Set fix / affects versions | `jirallm edit PROJ-1 --fix-versions <name> [--fix-versions <name>]` (replaces the whole set; `''` clears it; names from `versions`) |
| Publish a markdown file as a Confluence page (create, then update) | `jirallm page:publish <file.md> --space KEY --parent <id> --link PROJ-1 --dry-run` |

## Documents for the team

Write-ups for a ticket (business and technical context, how to test, a design note) start as local markdown next to the ticket, not in a chat-only or private doc tool, unless the user asks for that tool. Every other `.md` in `jira-export/<key>/` shows as its own tab in `jirallm ui` (mermaid blocks render there), so the user can read it without publishing. Publish to Confluence (steps 2–3) only when the user asks:
1. Write the markdown to `jira-export/<key>/context.md` (`# Title` first; images next to it, linked relatively, become attachments; mermaid is fine locally, but turn diagrams into images before publishing, since Confluence does not render mermaid).
2. Find the parent page: the user's choice, or `page:search` / `page:children` under the space's feature or sprint pages. Ask when unsure.
3. `jirallm page:publish jira-export/<key>/context.md --space KEY --parent <id> --link <key> --dry-run`, show the plan, and publish after the user confirms (a **write**). Later runs update the same page (the id is kept in `.context.md.confluence.json`); a page with the same title is never overwritten without `--page`.

## Slack (optional)

Teams that discuss tickets in Slack often decide things there that never reach Jira. The Slack steps below are optional: when `slack:search` prints "Slack not set up", skip every Slack step for the rest of the task without mentioning it.

## Implementing a ticket

After exporting the ticket (or `start`), and before writing code:
1. (Slack, optional) `jirallm slack:search "<key> OR <parent key>" --after <ticket created, YYYY-MM-DD>` and open the threads that look relevant with `jirallm slack <url>`.
2. Tell the user when a thread decided something the acceptance criteria don't say, or contradicts them, and ask which one wins before building on it.
3. Implement against the acceptance criteria plus those decisions; name the thread in the PR description when the code follows it.

## Before opening a PR

Run `jirallm pr-context --repo <worktree>` (key taken from the branch name) before `gh pr create`. It re-exports the ticket and prints what changed in Jira since work started (first branch commit): requirement and description edits as line diffs, new comments, status and assignee changes, plus the branch commits and diffstat. Then:
- tell the user about requirement changes or comments that the branch does not cover yet, before opening the PR;
- check the diff against the acceptance criteria in the re-exported `task.md`;
- write the PR description from it (what was built per acceptance criterion, anything left out and why).

## After opening a PR (CI and code review)

`jirallm pr-status [<pr>] --repo <worktree>` (needs `gh`; the PR defaults to the worktree's branch) prints one compact view: checks (failed, pending, passed), and for each failed GitHub Actions job the relevant log lines (errors and failed tests, ANSI and echoed script lines stripped), the latest review per reviewer, unresolved review threads whose last comment is not mine (path:line, first and last comment, link), and conversation comments since the last commit. Use it instead of `gh pr checks` plus raw `gh run view --log-failed`, which costs far more tokens.
- Right after `gh pr create` or a push, run `jirallm pr-status --repo <worktree> --wait` in the background (Claude Code: `run_in_background`). It polls every 60 s until no check is pending (`--timeout 90` min), prints the result and exits 1 when a check failed, so you are notified when CI settles.
- A failed check: read the digest, reproduce locally, fix and push (ask before pushing unless the user asked for it); only open the full log (`gh run view --job <id> --log-failed`) when the digest is not enough. Report infra failures (missing secrets, cache, runner) to the user instead of changing code for them.
- Review threads awaiting me: fix or answer each one, then tell the user what you changed. Replying on GitHub and resolving threads are **writes**: confirm first.
- `jirallm watch --prs <repo>` tracks all my open PRs between sessions: new CI failures, CI back to green, new reviews, threads awaiting me, new comments and merged/closed PRs are added to `CHANGES.md` (state in `jira-export/.prs.json`), so they show up at session start with `jirallm changes --unseen`. It is cheap enough to run every minute (one `gh pr list` plus a GitHub notifications poll that is a free 304 when nothing happened); a PR is only read in full when its checks changed or it got a notification. Recommended schedule: `jirallm watch --install 1 --jira-every 5 --prs <repo>` (PRs every minute, Jira/Confluence every 5 minutes; changes reach Claude through the hooks). Add `--notify` only if the user wants a Windows toast for each change.

## Reviewing someone else's PR for a ticket

Before reviewing the code:
1. Export the ticket (`--include-parent` when it is a sub-task) and find its PR (`gh pr list --search "<key>" --state all`), or, given only a PR number, take the key from its title or branch (`gh pr view <pr> --json title,headRefName`).
2. (Slack, optional) `jirallm slack:search "<key> OR <parent key> OR pull/<pr>" --after <ticket created, YYYY-MM-DD>` and open the threads that look relevant with `jirallm slack <url>`.
3. Review the diff against the acceptance criteria plus what was decided in any such threads; name the thread when a finding rests on it, and don't flag behaviour a thread explicitly agreed to.

Re-review (the author pushed fixes): with Slack set up, repeat step 2 with `--after <date of my last review>` and re-read the threads found before (`jirallm slack <url>` shows new replies), since answers to review points are often given in Slack rather than on the PR.

## Testing a ticket (tester workflow)

1. `jirallm PROJ-1 --no-status-changes`, then `jirallm qa init PROJ-1 --env <url> [--template api|matrix] [--api <endpoint>]`: writes `jira-export/proj-1/test-report.md` with one test case (TC-01…) per acceptance-criteria scenario. Edit it to add steps, expected results and preconditions. Keep the table shape. Pick the layout by ticket: `default`; `api` for backend tickets driven by API calls or messages (a shared base message, a read-back section, and a Test Data column so each case lists only what it changes); `matrix` when the outcome depends on a combination such as insurer result × action (columns Situation, Action, Expected Result, Side effects, and an Also-check list for invariants).
2. After running each case: `jirallm qa result PROJ-1 TC-03 pass|fail|blocked --note "<observed>" --evidence shot.png resp.json`. Evidence is copied next to the report and the Results line is recounted.
   Automated instead: run the Playwright tests with the JSON reporter, then `jirallm qa import PROJ-1 <results.json> [--grep <describe or title>] [--layer "API (Playwright)"]`. Each test becomes a case (re-runs update the same case, matched on title) with its `test.step` titles as steps, its verdict, the failure message as note, and its image attachments as evidence. Untouched placeholder cases are dropped. A test that covers acceptance-criteria cases names them with an annotation `{ type: "qa-case", description: "GP-1, GP-5" }` (case ids or the scenario label a title starts with): its result then goes on those cases, whose written steps are kept.
3. `jirallm qa publish PROJ-1 --space <KEY> [--parent <pageId>] --dry-run`, then run it without `--dry-run` (a **write**). It creates the page, or updates it on later runs, uploads the evidence and links the page from the issue.

People who prefer a screen use the same files through `jirallm ui`: pick a ticket, then **Test report** (edit cases, Pass/Fail/Blocked with pasted screenshots, Preview, Publish). A report title must be unique in the space; an existing page is never overwritten.

Every write command accepts `--dry-run`: use it when unsure. `start` runs git before touching Jira, so a failed worktree leaves the issue unchanged.

## Gotchas

- A board's "Ready to Dev" (or similar) is a column mapped to statuses, so a JQL on that name returns nothing. Use `board:issues`.
- `openSprints()` can cover several boards' sprints; narrow with `sprint = "<name>"` or a board query.
- Exports overwrite `task.md` and keep the previous copy as `.task.previous.md`, so diff the two to see what changed.

## Staying current

`jirallm watch` re-exports exported tickets and Confluence pages that changed since their local copy, plus open tickets assigned to me that are not exported yet and exported Slack threads with new replies (when Slack is set up; every 5 minutes at most, threads quiet for 14 days are skipped), and appends one line per change to `jira-export/CHANGES.md` (e.g. `ZOD-1: status: To Do → In Progress; Comments changed`). `jirallm changes` prints them compactly (one line per ticket, latest state); `--dry-run` on `watch` only lists what would be re-exported. A session-start hook running `jirallm changes --unseen` puts new changes in context automatically, and a prompt hook does the same on each user message when `watch` logged something since. `--install 15` runs it every 15 minutes in the background (`--uninstall` removes it).

Keeping `jira-export` lean: `watch` re-checks every exported ticket and page, so finished tickets are dead weight there and in searches. `jirallm prune --dry-run` lists the exports of tickets in the Done status category (Resolved, Rejected, …) and the Confluence pages only they link to, with sizes; `jirallm prune --yes` removes them. The user's own files in those folders (context.md, test reports, notes) are always kept. Pages exported on their own and Slack/SharePoint exports are not touched, and anything removed comes back with `jirallm <KEY>`. Use `--done-for <days>` to keep recently finished tickets and `--keep <keys>` for ones still being discussed. Suggest it when the folder grows large or many exported tickets are finished, and ask before running it with `--yes`.

To hear about changes mid-session without waiting for the user's next message (CI failed or went green, a review or thread awaiting me, a ticket or Slack thread moved), start `jirallm changes --follow --output-dir <workspace>/jira-export` under Claude Code's **Monitor** tool (`timeout_ms` 1800000, re-arm on expiry; description e.g. "jirallm changes"). It does no polling of its own: it prints what the scheduled `watch` appended to `CHANGES.md` (checked every 30 s), and marks it seen, so nothing is repeated on re-arm or at the next session start. Start it when you are waiting on CI or reviews, or when the user asks to follow changes; one monitor per session. On an event: CI failure on my PR → `jirallm pr-status --repo <worktree>` and fix it (ask before pushing); review/thread awaiting me → read and propose fixes or answers; Jira/Slack changes → mention briefly when they touch the current work. Not useful without the scheduled `watch` (check with `schtasks /Query /TN "jirallm watch"`).
