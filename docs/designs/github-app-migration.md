---
status: PLANNING
---
# GitHub App migration

Branch: `feat/github-app-connector` · Started: 2026-05-04

Decision rationale: [0005-github-app-over-oauth.md](../decisions/0005-github-app-over-oauth.md)

## Goal

Replace the GitHub OAuth-App auth model with a GitHub-App + installation-tokens model, for durability, rate-limit headroom, and webhooks. Ship as a parallel flow first — both auth modes coexist — then deprecate OAuth.

## Non-goals

- Migrating Slack / Notion / Grain to App-style auth.
- Replacing the connector port interface; we still satisfy `Connector<TConfig, TResource>`.
- Building a marketplace listing for the App. We register a private GitHub App in our org; customers install via a direct URL.

## Architecture changes

### Auth flow

**OAuth (today):**
```
user → /api/connectors/github/initiate
     → github.com/login/oauth/authorize
     → /api/connectors/github/callback (code → user-to-server token)
     → connector_credentials.access_token (encrypted, long-lived)
```

**App (target):**
```
admin → /api/connectors/github/initiate?mode=app
      → github.com/apps/holo/installations/new
      → /api/connectors/github/install-callback (installation_id, setup_action=install|update)
      → github_installations.installation_id (no token stored)

worker, on demand:
  installation_id + private_key → JWT → POST /app/installations/{id}/access_tokens
                                      → 1-hour token used for that single sync
```

The worker mints tokens just-in-time. We never persist them.

### Schema

Add a new table rather than overloading `connector_credentials`. App installations have different semantics (org-scoped, no user, no refresh token) and live differently from API-key / OAuth credentials.

```sql
create table github_installations (
  id                    uuid primary key default gen_random_uuid(),
  organization_id       uuid not null references organization(id),
  installation_id       bigint not null,            -- GitHub's installation_id
  account_login         text not null,              -- 'midlane-dev'
  account_type          text not null,              -- 'Organization' | 'User'
  account_id            bigint not null,
  repository_selection  text not null,              -- 'all' | 'selected'
  installed_by_user_id  uuid references "user"(id), -- soft FK, may go null
  installed_at          timestamptz not null default now(),
  suspended_at          timestamptz,                -- non-null = suspended by GitHub
  unique (organization_id, installation_id)
);
```

`sources` rows for App-installed connectors set `metadata.auth_mode = 'app'` and `metadata.installation_id = N`. OAuth-connected sources keep `metadata.auth_mode = 'oauth'` (or the field is absent — treat absence as oauth).

### Token loading

`packages/connectors/src/github/auth.ts` (new):

```ts
export async function loadGithubToken(args: {
  db: DB;
  organizationId: string;
}): Promise<{ token: string; mode: 'oauth' | 'app' }>;
```

- App path: read installation row, mint a JWT with the App private key (`GITHUB_APP_PRIVATE_KEY`, RS256 signed), POST it to `/app/installations/{id}/access_tokens`, return the resulting `token`. Cache for ~50 min in-process.
- OAuth path: existing `connectorCredentials.accessToken` decrypt.
- The runners stop calling `loadConnectorToken` directly — they call `loadGithubToken` instead.

### Webhook intake

New endpoint: `POST /api/webhooks/github` in `apps/web` (or move to `apps/gateway` if we want to decouple webhook traffic from user-facing routes — TBD).

Verifies the `X-Hub-Signature-256` HMAC against `GITHUB_APP_WEBHOOK_SECRET`, dispatches by `X-GitHub-Event`:

| Event | Action |
|---|---|
| `installation` (`created` / `deleted` / `suspend` / `unsuspend`) | Upsert / mark `suspended_at` on `github_installations` |
| `installation_repositories` | Re-sync the repo allowlist for that installation |
| `pull_request`, `pull_request_review`, `pull_request_review_comment` | Enqueue a partial prose-sync for that one PR |
| `issues`, `issue_comment` | Enqueue a partial prose-sync for that one issue |
| `push` to default branch | Enqueue a code-sync diff from the cursor SHA |

Initial implementation can swallow the partial-sync ones and just bump a "last webhook seen" cursor — full event-driven sync is a v2 of this. The point of v1 is making the install/uninstall lifecycle work.

## Implementation steps

Each step is independently mergeable behind a feature flag (`HOLO_GITHUB_APP_ENABLED`) so OAuth keeps working throughout.

### Phase 1 — App registration + auth (no UI yet)

1. Register the GitHub App in the holo dev account. Permissions: `Contents: Read`, `Issues: Read`, `Pull requests: Read`, `Metadata: Read`, `Members: Read`. Webhook URL: `https://<our-host>/api/webhooks/github`. Subscribe to: `installation`, `installation_repositories`, `pull_request`, `issues`, `issue_comment`, `pull_request_review`, `push`.
2. Save private key + webhook secret as deploy secrets (`GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_APP_WEBHOOK_SECRET`). Add to `.env.example`.
3. Create `packages/connectors/src/github/auth.ts` with `mintInstallationToken(installationId)`. Use `jsonwebtoken` for the JWT and our existing `fetch` wrapper for the POST. Cache tokens in-memory keyed by `installationId` with a 50-minute TTL.
4. Migration: `0027_github_installations.sql` adding the table above.
5. Unit tests for JWT minting, token-cache TTL, error handling on suspended installations.

### Phase 2 — Install flow

1. Update `/api/connectors/github/initiate` to accept `?mode=app` and return `authorizeUrl: 'https://github.com/apps/<slug>/installations/new?state=<jwt>'`. Existing `mode=oauth` (default) unchanged.
2. New route: `/api/connectors/github/install-callback`. GitHub redirects here with `installation_id`, `setup_action`, and our `state`. Verify state, fetch installation metadata via `GET /app/installations/{id}`, upsert `github_installations`, upsert `sources` row with `metadata.auth_mode='app'`. Trigger initial sync.
3. UI: in `connector-row.tsx`, when GitHub is unconnected and `HOLO_GITHUB_APP_ENABLED`, render two buttons — `Install GitHub App` (primary) and `Connect via OAuth` (secondary, will be removed later). Default the App path.
4. Manage sheet: detect `auth_mode` from `sources.metadata`. App-mode rows show "Manage installation" linking to `https://github.com/installations/<id>` instead of "Reconnect".

### Phase 3 — Worker uses installation tokens

1. Update `apps/worker/src/queues/runners.ts`: `loadConnectorToken(... 'github')` becomes `loadGithubToken({db, organizationId})`. Worker doesn't need to know which mode — the helper picks based on the source's metadata.
2. Update the clone URL builder to use `https://x-access-token:${token}@github.com/...` regardless of mode (the username is informational; it works for both OAuth and App tokens).
3. End-to-end test: create a test installation against a fixture org, run a sync, verify chunks land. Tear down installation in test cleanup.

### Phase 4 — Webhook intake

1. New route in `apps/web/src/app/api/webhooks/github/route.ts`. Raw-body HMAC verification (use `req.text()` not `req.json()`).
2. Handle `installation.created` / `installation.deleted` / `installation.suspend` / `installation.unsuspend` — upsert / soft-delete.
3. Handle `installation_repositories.added` / `removed` — update allowlist for that installation.
4. Stub PR/issue/push handlers — log and enqueue a generic incremental sync for now. Per-resource fast-path is v2.

### Phase 5 — Disconnect path

1. New `DELETE /api/connectors/github/connection?mode=app` calls `DELETE /app/installations/{id}` via the App JWT, then deletes the `github_installations` row and `sources` (with cascade to chunks). Existing OAuth-mode disconnect unchanged.
2. Confirmation dialog mentions "this will uninstall the holo App from <org>" so the admin understands the effect on GitHub's side.

### Phase 6 — Deprecation

Conditional on Phase 1–5 being stable in production for ≥1 week of real-customer traffic.

1. Default new connections to App-only. OAuth button moves behind a "legacy" disclosure.
2. Notify existing OAuth-connected orgs in-product: "Re-install via GitHub App for better reliability."
3. Drop OAuth flow, callbacks, and the now-unused user-to-server token paths in `connector_credentials`. Delete the `gho_*`-token regex from redactors (no longer needed).

## Open questions

1. **Where does the webhook endpoint live?** `apps/web` is simplest (Next.js route handler) but couples webhook traffic to the user-facing dyno. `apps/gateway` is purpose-built for inbound. **Lean: gateway**, decided in Phase 4.
2. **Self-host docs.** The single biggest doc rewrite — every self-hoster registers their own App. Need a `docs/connectors/github-app-setup.md` with a manifest JSON and step-by-step. Out of scope for the code refactor; track separately.
3. **Migration UX for existing OAuth connections.** Quietly "they'll see a banner" vs. forcing a re-install. **Lean: banner + soft re-prompt** for one cycle, then forced.
4. **Permission bump strategy.** Adding a new permission to the App later requires every installation to re-authorize. Decide the *full* permissions list now and don't change it for the next year unless absolutely required.

## Effort estimate

| Phase | Effort | Notes |
|---|---|---|
| 1 — Auth helper + schema | 1.5 days | JWT signing, token caching, migration, tests |
| 2 — Install flow | 1 day | Two new routes, UI branch |
| 3 — Worker token integration | 0.5 day | Mostly a refactor of existing token loader |
| 4 — Webhook intake | 1.5 days | HMAC verify, dispatch, lifecycle events. Per-PR fast path deferred. |
| 5 — Disconnect | 0.5 day | New endpoint, confirm dialog text |
| 6 — Deprecation | 0.5 day | Mostly UI/copy + cleanup |
| **Total** | **~5.5 days** | One engineer, focused. |

## Test plan

- Unit: token minting (JWT signature shape, expiry handling), token cache TTL, HMAC verification (correct + tampered + wrong-secret cases).
- Integration: full install → sync → uninstall cycle against a sacrificial test org, asserting (a) chunks landed, (b) installation row written, (c) cleanup deletes everything.
- Manual: smoke test on a real account, verify the install UI on GitHub's side, verify the audit log shows "holo App" not a person.
