---
description: Review or re-review someone else's PR against its Jira ticket and Slack decisions
argument-hint: <PR number> [repo path]
---

Review PR $ARGUMENTS with the jirallm skill. Load the skill, read its `references/review.md`, and follow it:

1. Find the ticket key (PR title or branch), export the ticket, and read `task.md` plus `jirallm state <KEY>` (notes hold points already settled).
2. If I reviewed this PR before, run `jirallm review-history <pr> --repo <repo>` first and review only what changed since, plus the open threads. Never raise a resolved or settled point again.
3. Slack (if set up): `slack:search` with the key, parent key and `pull/<pr>`, and read the relevant threads in full (`--since <my last review>` on a re-review; never cut the output).
4. Check the diff against every acceptance criterion and the Slack decisions. Report findings by severity, each with file:line, and name the thread when a finding rests on it.

Posting the review on GitHub is a write: show the draft and ask first. Afterwards save settled points with `jirallm note <KEY> "PR #<pr>: …"`.
