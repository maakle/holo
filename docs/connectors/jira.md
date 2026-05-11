# Jira (Cloud)

Holo ingests Jira Cloud issues, top-level comments, and project metadata via Atlassian basic auth (email + API token).

> Only Atlassian-hosted Jira **Cloud** is supported. Jira Server / Data Center are out of scope.

## What gets indexed

- **Issues** — one chunk per issue with key, summary, status, type, priority, assignee, project, labels, and the description (ADF flattened to plain text).
- **Comments** — one chunk per top-level comment.
- **Projects** — one chunk per project with name, key, lead, type, and description.

Per-issue and per-comment chunks carry ACL subjects `jira:project:<projectId>` plus `jira:org`, so retrieval can scope to project visibility.

## Recommended setup

Holo authenticates as a single Atlassian user (the API token holder). The token owner sees every issue Holo will index. We recommend:

1. **Create or reuse a workspace-scope service account user** (e.g. `holo@yourcompany.com`) with read-only access to every project you want indexed. This keeps ingestion stable across employee turnover and makes the audit trail clear.
2. From that account, open `https://id.atlassian.com/manage-profile/security/api-tokens`, click **Create API token**, label it `Holo`, and copy the value (Atlassian never shows it again).
3. Note the **site URL** — the host you see in your browser when you visit Jira (e.g. `https://yourcompany.atlassian.net`).

## Connect

In Holo, open `/connections` → **Jira** → **Connect**, then paste:

| Field      | Example                                  |
| ---------- | ---------------------------------------- |
| Site URL   | `https://yourcompany.atlassian.net`      |
| Email      | `holo@yourcompany.com`                   |
| API token  | (the value from step 2 above)            |

Holo validates the credentials by calling `/rest/api/3/myself` and captures your `cloudId` via `/rest/api/3/serverInfo` before saving.

## Rotation

To rotate the API token: revoke the old token in `https://id.atlassian.com/manage-profile/security/api-tokens`, create a new one, then **Reconnect** in Holo (manage sheet → Reconnect) and paste the new token. The site URL and email stay the same.

## Sync cadence

Default: every **4 hours** (matches Linear — issues are high-churn and surfaced in chat-style retrieval). Tunable in `packages/connectors/src/sync-intervals.ts`.

## Limitations (v1)

- No OAuth 2.0 (3LO). Basic auth only.
- Worklogs, attachments, and sprint metadata are not indexed yet.
- Tables, panels, and media inside issue descriptions are rendered as placeholders (`[table]`, `[image: alt]`) — text inside them is dropped.
- One Jira workspace per Holo organization.
