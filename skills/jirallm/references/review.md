# jirallm: review

## Reviewing someone else's PR for a ticket

Before reviewing the code:
1. Export the ticket (`--include-parent` when it is a sub-task) and find its PR (`gh pr list --search "<key>" --state all`), or, given only a PR number, take the key from its title or branch (`gh pr view <pr> --json title,headRefName`).
2. (Slack, optional) `jirallm slack:search "<key> OR <parent key> OR pull/<pr>" --after <ticket created, YYYY-MM-DD>` and open the threads that look relevant with `jirallm slack <url>`.
3. Review the diff against the acceptance criteria plus what was decided in any such threads; name the thread when a finding rests on it, and don't flag behaviour a thread explicitly agreed to.

Re-review (the author pushed fixes):
1. `jirallm review-history <pr> --repo <repo>` first: my earlier reviews, every thread I took part in grouped as resolved (settled: never raise again), answered by the author (check the reply), or still waiting on the author, my conversation comments with replies, the commits and files changed since my last review, and the ticket's notes. It is saved as `jira-export/<key>/review-<pr>.md`. Review only the changes since my last review, plus whatever the open threads point at.
2. With Slack set up, repeat step 2 above with `--after <date of my last review>` (inclusive: same-day replies count) and re-read the threads found before with `jirallm slack <url> --since "<my last review, YYYY-MM-DD HH:MM>"`, since answers to review points are often given in Slack rather than on the PR, in replies that do not repeat the key and so never match a search. The search rows' `replies` / `last reply` columns show which threads moved. Never cut `jirallm slack` output with `head`/`Select-Object -First`: the newest replies are at the end (its header names the last reply, so check you saw it); use `--since` to shorten it.
3. When the user settles a point outside GitHub (accepted as is, non-blocking, agreed in Slack), keep it with `jirallm note <key> "PR #<pr>: <point> settled: <why>"` so the next re-review skips it.
