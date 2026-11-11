---
description: Test a Jira ticket and produce its test report (cases from the acceptance criteria)
argument-hint: <ISSUE-KEY> [--env <url>]
---

Test ticket $ARGUMENTS with the jirallm skill. Load the skill, read its `references/test.md`, and follow it:

1. Export the ticket and run `jirallm qa init` with the template that fits (default, api or matrix); fill in steps, preconditions and expected results.
2. Run each case and record it with `jirallm qa result` (evidence attached), or import Playwright results with `jirallm qa import`.
3. Show the report and ask before `jirallm qa publish` (run it with `--dry-run` first).
