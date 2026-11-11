# jirallm: implement

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
