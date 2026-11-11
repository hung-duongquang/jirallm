---
description: Implement a Jira ticket with jirallm, from export to a green, reviewed PR
argument-hint: <ISSUE-KEY>
---

Implement ticket $ARGUMENTS with the jirallm skill. Load the skill, read its `references/implement.md`, and follow those steps in order:

1. Export the ticket (`--include-parent` for a sub-task) and read `task.md`; check `jirallm state $ARGUMENTS` for an existing worktree, PR or notes before starting anything new.
2. Slack context (if set up), then list the acceptance criteria and any decision that changes them; ask the user which wins on a conflict.
3. Start or reuse the worktree, implement against the acceptance criteria, and run the project's checks.
4. Before opening the PR: `jirallm pr-context`, check the diff criterion by criterion, and say which criteria are not covered.
5. After pushing: follow CI and reviews with `jirallm pr-status --wait` in the background.

Jira writes, pushes and GitHub comments need the user's go-ahead. Save decisions that are not in Jira or git with `jirallm note $ARGUMENTS "<text>"`.
