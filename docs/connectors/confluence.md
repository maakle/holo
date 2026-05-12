# Confluence (Cloud)

Holo ingests Confluence Cloud spaces, pages (and blog posts), and top-level inline + footer comments via Atlassian basic auth (email + API token) — the same credential shape as Jira.

> Only Atlassian-hosted Confluence **Cloud** is supported. Confluence Server / Data Center are out of scope.

## What gets indexed

- **Spaces** — one chunk per global space with key, name, type, and description.
- **Pages & blog posts** — one chunk per page with title, space, ancestor breadcrumb, and the body (ADF flattened to plain text).
- **Comments** — one chunk per top-level inline or footer comment.

Per-page and per-comment chunks carry ACL subjects `confluence:space:<spaceId>` plus `confluence:org`, so retrieval can scope to space visibility. Page-level restrictions are not enforced in v1 — if the indexing account can view a page, every Holo user who can see the space sees the chunk.

## Recommended setup

Holo authenticates as a single Atlassian user (the API token holder). The token owner sees every page and space Holo will index. We recommend:

1. **Create or reuse a workspace-scope service account user** (e.g. `holo@yourcompany.com`) with view access to every space you want indexed. This keeps ingestion stable across employee turnover and makes the audit trail clear. The same account can power both the Jira and Confluence connectors.
2. From that account, open `https://id.atlassian.com/manage-profile/security/api-tokens`, click **Create API token**, label it `Holo`, and copy the value (Atlassian never shows it again).
3. Note the **site URL** — the host you see in your browser when you visit Confluence (e.g. `https://yourcompany.atlassian.net`). Confluence itself lives under `/wiki` on that host; Holo adds the suffix automatically.

## Connect

In Holo, open `/connections` → **Confluence** → **Connect**, then paste:

| Field      | Example                                  |
| ---------- | ---------------------------------------- |
| Site URL   | `https://yourcompany.atlassian.net`      |
| Email      | `holo@yourcompany.com`                   |
| API token  | (the value from step 2 above)            |

Holo validates the credentials by calling `/wiki/rest/api/user/current` and captures your `cloudId` via `/wiki/_edge/tenant_info` before saving.

## Rotation

To rotate the API token: revoke the old token in `https://id.atlassian.com/manage-profile/security/api-tokens`, create a new one, then **Reconnect** in Holo (manage sheet → Reconnect) and paste the new token. The site URL and email stay the same.

## Sync cadence

Default: every **4 hours** (matches Jira — pages can churn during active projects, and we keep retrieval fresh enough for chat-style flows). Tunable in `packages/connectors/src/sync-intervals.ts`.

## Limitations (v1)

- No OAuth 2.0 (3LO). Basic auth only.
- Page-level restrictions are not enforced — only space-level. Don't connect with an account that can view spaces or pages you don't want indexed.
- Attachments, page properties, labels, and likes are not indexed yet.
- Macros, panels, tables, and media inside page bodies are rendered as placeholders (`[table]`, `[image: alt]`) — text inside them is dropped.
- One Confluence workspace per Holo organization.
