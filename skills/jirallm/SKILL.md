---
name: jirallm
description: Read and update Jira and Confluence, and read Slack and SharePoint, from the shell with jirallm. Use when a task mentions a Jira key (e.g. ZOD-1234), a sprint, a board column, or asks to assign, transition, comment or log work; when implementing a ticket, or reviewing or re-reviewing a pull request (also one named only by its number), checking it against the ticket and, if Slack is set up, the discussions where decisions not written in Jira were made; to read a pasted Slack message, SharePoint page or SharePoint Office document (slide deck, Word, Excel) link, or to change text in a PowerPoint deck on SharePoint, or find something on the company intranet; to find, read or write a Confluence page (spec, test report); to write up a ticket's business or technical context, documentation or a how-to-test for testers or the team; to test a ticket; before opening a pull request for a ticket branch; after a PR is raised, to follow its CI pipeline (failed checks and their logs) and code reviews (review threads, comments) until it is green and approved; or to check what changed in tickets or whether the local ticket context is current.
model: sonnet
---

# jirallm for agents

Output switches to JSON when stdout is piped. Prefer the compact forms below: they cost far fewer tokens.

## Workflows: read the file before starting that kind of task

The steps for each workflow live next to this file, so they only cost context when needed:
- Writing a ticket context / how-to-test / design note and publishing it to Confluence → read `references/documents.md`
- Implementing a ticket, opening a PR for it, then following its CI and code review → read `references/implement.md`
- Reviewing or re-reviewing someone else's PR (also one named only by its number) → read `references/review.md`
- Where a ticket stands, and keeping per-ticket facts (`state`, `note`) → read `references/notes.md`
- Testing a ticket and writing or publishing its test report → read `references/test.md`
- Ticket, PR and Slack changes (`watch`, `changes`, the monitor), keeping jira-export lean (`prune`) → read `references/staying-current.md`
- SharePoint pages and Office documents, editing a PowerPoint deck, intranet search → read `references/sharepoint.md`

## Read (safe, no side effects)

| Need | Command |
|---|---|
| Full ticket as markdown (description, AC, comments, attachments, linked Confluence pages) | `jirallm PROJ-1 --no-status-changes --output-dir ./jira-export` then read `jira-export/proj-1/task.md` |
| Ticket plus its parent chain / linked issues and sub-tasks | add `--include-parent` / `--include-linked` (sub-tasks are listed under `subtasks:` in the frontmatter and exported with `--include-linked`; a story's FE part is often a sub-task, not a link) |
| Quick look, no files | `jirallm fetch PROJ-1` |
| Where a ticket stands locally (status, my PRs, worktree, notes), no network | `jirallm state PROJ-1 [PROJ-2]`; keep facts with `jirallm note PROJ-1 "<text>"` |
| Before re-reviewing a PR: what I already raised and what changed since | `jirallm review-history <pr> --repo <repo>` |
| Exact field values the markdown lacks or renders wrong (custom fields, link metadata, IDs) | `jirallm fetch PROJ-1 --raw --fields <jira field ids>` (e.g. `issuelinks,customfield_10050`); avoid bare `--raw`, it returns every field |
| One Confluence page by URL (e.g. a test report) | `jirallm page <url>` → `jira-export/confluence/<id>-<slug>/page.md` |
| Find Confluence pages (plain words or CQL) | `jirallm page:search "<words>" [--space KEY] --format tsv`, then `jirallm page <url>` on a hit |
| A Slack message link (`https://<ws>.slack.com/archives/<channel>/p<id>`) or image/file link (`…/files/<user>/<F…>/<name>`, resolved to the message that shares it), with its thread | `jirallm slack <url>` prints Markdown, plus a section with channel messages posted after the thread started (people often answer in the channel instead of the thread; they can be unrelated, `--no-channel` drops them); `--output-dir ./jira-export` also saves images and extracts frames from videos (`<file>-frames/`, read them to see a screen recording). `--title` prints one line (`<first line> · #channel`; the plugin hook names a session after the Slack link in its first prompt). No token → ask the user to run `jirallm slack:auth` |
| SharePoint pages, Office documents (read; change a deck), intranet search | read `references/sharepoint.md` first |
| Slack discussions of a ticket or PR (decisions not written in Jira) | `jirallm slack:search "PROJ-1 OR PROJ-0 OR pull/123" --after <ticket created>`: one TSV row per thread with its permalink; open the relevant ones with `jirallm slack <url>` |
| Text for the user to paste in Slack (it has no tables) | `jirallm slack:copy <file>` (or the user runs `! jirallm slack:copy` after copying a reply): tables become one bullet per row, markdown becomes Slack formatting, and the result goes on the clipboard as rich text |
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

With the Claude Code plugin installed, these commands (and `gh pr review/merge/comment`, GitHub API writes) also raise a permission prompt for the user; `--dry-run` runs pass without one. Still tell the user what you are about to write.

## Slack (optional)

Teams that discuss tickets in Slack often decide things there that never reach Jira. The Slack steps below are optional: when `slack:search` prints "Slack not set up", skip every Slack step for the rest of the task without mentioning it.

## Gotchas

- A board's "Ready to Dev" (or similar) is a column mapped to statuses, so a JQL on that name returns nothing. Use `board:issues`.
- `openSprints()` can cover several boards' sprints; narrow with `sprint = "<name>"` or a board query.
- Exports overwrite `task.md` and keep the previous copy as `.task.previous.md`, so diff the two to see what changed.

