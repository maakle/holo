# Connector setup

Per-connector setup guides for developers running Holo locally or configuring a deployment. Each guide covers OAuth app creation, redirect URLs, scopes, and the env vars that wire them into Holo.

| Connector | Auth | Guide |
|---|---|---|
| Slack | OAuth (bot + user) | [slack.md](./slack.md) |
| GitHub | GitHub App (one App per Holo deployment) | [github-app.md](./github-app.md) |
| Notion | API key | _todo_ |
| Grain | OAuth | _todo_ |
| Pylon | API key | _todo_ |
| HubSpot | OAuth | _todo_ |
| Linear | API key (personal API key) | _todo_ |
| Mintlify Docs | API key (none for public sites) | _todo_ |
| Zendesk Help Center | API key (none for public help centers) | _todo_ |
| Google Drive | OAuth | [googledrive.md](./googledrive.md) |
| Google Chat | Service account (DWD) | [google-chat.md](./google-chat.md) |
| Airtable | API key (personal access token) | [airtable.md](./airtable.md) |

## Conventions

- Redirect URLs always use `${BETTER_AUTH_URL}` as the base (the dashboard's public URL — see `.env.example`).
- OAuth-redirect connectors live under `/api/connectors/<provider>/callback`.
- API-key connectors have their own `/connect/<provider>` flow.
- Tokens are encrypted at rest with `HOLO_TOKEN_ENCRYPTION_KEY` before being written to `connector_accounts`.
- Allowlist enforcement (`connector_allowlists`) is mandatory — see [`CONTRIBUTING.md`](../../CONTRIBUTING.md) § "Adding a connector".
- **Provider must be in `SYNC_PROVIDERS`.** Every dashboard route under `apps/web/src/app/api/connectors/[provider]/` (sync now, runs, sync-status, stop, disconnect) validates against the `SYNC_PROVIDERS` list in [`apps/web/src/lib/sync-queue.ts`](../../apps/web/src/lib/sync-queue.ts) and the mirror in [`packages/cli/src/commands/sync-run.ts`](../../packages/cli/src/commands/sync-run.ts). A connector that ingests fine in the worker but is missing from this list will surface `Use one of: …` instead of its sync history. See [`CONTRIBUTING.md`](../../CONTRIBUTING.md) § "Adding a connector" for the full registration checklist.
