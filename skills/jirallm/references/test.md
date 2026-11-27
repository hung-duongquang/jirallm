# jirallm: test

## Testing a ticket (tester workflow)

1. `jirallm PROJ-1 --no-status-changes`, then `jirallm qa init PROJ-1 --env <url> [--template api|matrix] [--api <endpoint>]`: writes `jira-export/proj-1/test-report.md` with one test case (TC-01…) per acceptance-criteria scenario. Edit it to add steps, expected results and preconditions. Keep the table shape. Pick the layout by ticket: `default`; `api` for backend tickets driven by API calls or messages (a shared base message, a read-back section, and a Test Data column so each case lists only what it changes); `matrix` when the outcome depends on a combination such as insurer result × action (columns Situation, Action, Expected Result, Side effects, and an Also-check list for invariants).
2. After running each case: `jirallm qa result PROJ-1 TC-03 pass|fail|blocked --note "<observed>" --evidence shot.png resp.json`. Evidence is copied next to the report and the Results line is recounted.
   Automated instead: run the Playwright tests with the JSON reporter, then `jirallm qa import PROJ-1 <results.json> [--grep <describe or title>] [--layer "API (Playwright)"]`. Each test becomes a case (re-runs update the same case, matched on title) with its `test.step` titles as steps, its verdict, the failure message as note, and its image attachments as evidence. Untouched placeholder cases are dropped. A test that covers acceptance-criteria cases names them with an annotation `{ type: "qa-case", description: "GP-1, GP-5" }` (case ids or the scenario label a title starts with): its result then goes on those cases, whose written steps are kept.
3. `jirallm qa publish PROJ-1 --space <KEY> [--parent <pageId>] --dry-run`, then run it without `--dry-run` (a **write**). It creates the page, or updates it on later runs, uploads the evidence and links the page from the issue.

People who prefer a screen use the same files through `jirallm ui`: pick a ticket, then **Test report** (edit cases, Pass/Fail/Blocked with pasted screenshots, Preview, Publish). A report title must be unique in the space; an existing page is never overwritten.

Every write command accepts `--dry-run`: use it when unsure. `start` runs git before touching Jira, so a failed worktree leaves the issue unchanged.
