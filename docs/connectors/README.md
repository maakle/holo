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

## Conventions

- Redirect URLs always use `${BETTER_AUTH_URL}` as the base (the dashboard's public URL — see `.env.example`).
- OAuth-redirect connectors live under `/api/connectors/<provider>/callback`.
- API-key connectors have their own `/connect/<provider>` flow.
- Tokens are encrypted at rest with `HOLO_TOKEN_ENCRYPTION_KEY` before being written to `connector_accounts`.
- Allowlist enforcement (`connector_allowlists`) is mandatory — see [`CONTRIBUTING.md`](../../CONTRIBUTING.md) § "Adding a connector".
