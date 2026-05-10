# Google Chat connector setup

Holo's Google Chat connector reads spaces, threads, and messages via a Google
service account with **domain-wide delegation** — one workspace-wide install,
no per-user OAuth, no token churn when employees leave. The bulk of the setup
(creating the service account, granting DWD scopes, pasting the JSON key) is
covered by the in-app wizard. This doc focuses on the one extra step the
wizard cannot automate: configuring a **Chat app** on the Cloud project.

> Even with the Chat API enabled, Google requires every project that calls
> `chat.googleapis.com` to have a configured Chat app. Without it, the first
> sync 404s with `Google Chat app not found`. Holo never uses the Chat app's
> bot/trigger features — we only need it to exist so the API will respond.

## Configure the Chat app (minimum for read-only ingestion)

After the Chat API is enabled, open the Chat API page in Cloud Console and
go to the **Configuration** tab:

<https://console.cloud.google.com/apis/api/chat.googleapis.com/hangouts-chat>

Fill it in as follows. Anything not listed here can stay at its default.

### Workspace Add-on toggle (top of page)

- **"Build this Chat app as a Workspace Add-on"**: **uncheck**.
  Holo doesn't need a Marketplace listing; the simpler in-domain app is
  enough. Once unchecked you cannot re-enable it, but you don't need to.

### Application info

| Field | Value |
|---|---|
| **Application name** | `Holo` |
| **Avatar URL** | `https://raw.githubusercontent.com/maakle/holo/main/apps/web/public/logo.png` (the Holo logo — 250×250 PNG, publicly hosted on GitHub. Google requires an HTTPS URL to a square image; this one is verified to load. Swap in your own brand if you prefer.) |
| **Description** | `Read-only ingestion for Holo` (max 40 characters) |

### Interactive features

**Toggle OFF.** Holo never receives messages from Chat — we only read
history via the REST API. Disabling this hides the entire **Functionality**,
**Connection settings**, and **Triggers** sections, so you don't need to
fill in any HTTP endpoint URLs.

If your Workspace policy requires interactive features to be enabled:

- **Functionality**: leave both checkboxes unchecked.
- **Connection settings**: pick **HTTP endpoint URL**.
- **Triggers**: select **"Use a single HTTP endpoint URL for all triggers"**
  and enter `https://example.invalid` (or any URL — Holo never receives
  trigger calls).

### App status

Set to **LIVE — available to users in your domain**. This is the only
required publish step; without it, the first sync 404s.

Click **Save**.

## Then return to the Holo wizard

The rest of the flow — service account creation, domain-wide delegation,
JSON key paste, impersonation email — is handled by the connection wizard
in the dashboard. See the wizard's "Service account" step for the exact
scopes to add to DWD.

## Scopes

The wizard lists these in a copy-paste block. For reference, the full set
is exported from `@holo/sync-providers` as `GOOGLE_CHAT_SCOPES`:

- `https://www.googleapis.com/auth/chat.spaces.readonly` — list spaces the
  impersonated user is in.
- `https://www.googleapis.com/auth/chat.messages.readonly` — read message
  history in those spaces.
- `openid`, `email` — identity probe used by `testConnection` (Chat itself
  has no `/me` endpoint).

`chat.spaces.readonly` and `chat.messages.readonly` are the smallest scopes
that let Holo enumerate and read content. We do **not** request any write
or admin scopes — Holo cannot post messages or modify spaces.

## What's indexed

For each space the impersonated user is a member of (DMs are skipped by
default — opt them in via the connector allowlist if you want them):

- Top-level threads and their replies, exported as plain text with
  `createTime`-based watermarking.
- Per-space `createTime` cursor stored in the worker — reruns pick up only
  new messages.

## Sync cadence

Default interval is set in `packages/connectors/src/sync-intervals.ts` under
`google-chat`. Watermark is per-space `createTime` (RFC 3339).

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| First sync 403, "API has not been used in project … or it is disabled" | Chat API not enabled on the project. Enable it: <https://console.cloud.google.com/apis/library/chat.googleapis.com> |
| First sync 404, "Google Chat app not found" | The project has no configured Chat app, or it's not LIVE. Re-do the Configuration tab steps above. |
| `testConnection` succeeds but no spaces sync | The impersonated user isn't a member of any spaces (DMs are skipped by default). Add them to the spaces you want indexed, or use a different impersonation email. |
| Auth errors mentioning "unauthorized_client" | Domain-wide delegation isn't set up, or the scopes in Admin Console → Security → API Controls → Domain-wide Delegation don't match the wizard's list. |
