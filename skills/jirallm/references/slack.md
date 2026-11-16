# jirallm: slack

## Slack

| Need | Command |
|---|---|
| A Slack message link (`https://<ws>.slack.com/archives/<channel>/p<id>`) or image/file link (`…/files/<user>/<F…>/<name>`, resolved to the message that shares it), with its thread | `jirallm slack <url>` prints Markdown, plus a section with channel messages posted after the thread started (people often answer in the channel instead of the thread; they can be unrelated, `--no-channel` drops them); `--output-dir ./jira-export` also saves images and extracts frames from videos (`<file>-frames/`, read them to see a screen recording). `--title` prints one line (`<first line> · #channel`; the plugin hook names a session after the Slack link in its first prompt). Reading a thread that is already exported (one `watch` follows) also updates the export: the replies you read do not come back to this session as a change, so when the user says a thread has news, just read it. No token → ask the user to run `jirallm slack:auth` |
| Slack discussions of a ticket or PR (decisions not written in Jira) | `jirallm slack:search "PROJ-1 OR PROJ-0 OR pull/123" --after <ticket created>`: one TSV row per thread with its permalink; open the relevant ones with `jirallm slack <url>` |
| Text for the user to paste in Slack (it has no tables) | `jirallm slack:copy <file>` (or the user runs `! jirallm slack:copy` after copying a reply): tables become one bullet per row, markdown becomes Slack formatting, and the result goes on the clipboard as rich text |
