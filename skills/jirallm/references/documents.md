# jirallm: documents

## Documents for the team

Write-ups for a ticket (business and technical context, how to test, a design note) start as local markdown next to the ticket, not in a chat-only or private doc tool, unless the user asks for that tool. Every other `.md` in `jira-export/<key>/` shows as its own tab in `jirallm ui` (mermaid blocks render there), so the user can read it without publishing. Publish to Confluence (steps 2–3) only when the user asks:
1. Write the markdown to `jira-export/<key>/context.md` (`# Title` first; images next to it, linked relatively, become attachments; mermaid is fine locally, but turn diagrams into images before publishing, since Confluence does not render mermaid).
2. Find the parent page: the user's choice, or `page:search` / `page:children` under the space's feature or sprint pages. Ask when unsure.
3. `jirallm page:publish jira-export/<key>/context.md --space KEY --parent <id> --link <key> --dry-run`, show the plan, and publish after the user confirms (a **write**). Later runs update the same page (the id is kept in `.context.md.confluence.json`); a page with the same title is never overwritten without `--page`.
