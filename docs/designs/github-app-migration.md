---
status: PLANNING
---
# GitHub App migration

Branch: `feat/github-app-connector` · Started: 2026-05-04

Decision rationale: [0005-github-app-over-oauth.md](../decisions/0005-github-app-over-oauth.md)

## Goal

Replace the GitHub OAuth-App auth model with a GitHub App + installation-tokens model, for durability, rate-limit headroom, and webhooks. **Hard cutover** — no parallel flow, no feature flag. We don't have customer connections to migrate; existing dev OAuth installs are wiped clean.

## Non-goals

- Migrating Slack / Notion / Grain to App-style auth.
- Replacing the connector port interface; we still satisfy `Connector<TConfig, TResource>`.
- Building a marketplace listing for the App. We register a private GitHub App in our org; customers install via a direct URL.

## Decisions locked in this iteration

- **Webhook endpoint lives in `apps/web`**, not `apps/gateway`. Gateway is the MCP-first agent-facing surface ([ARCHITECTURE.md](../ARCHITECTURE.md)); inbound third-party HTTP (OAuth callbacks, webhooks) belongs alongside Next.js's other public routes.
- **Hard delete OAuth.** No deprecation phase. Wipe existing OAuth credentials + sources for GitHub, drop the OAuth-flow code, ship the App flow as the only path.
- **Permissions:** `Contents: Read`, `Issues: Read`, `Pull requests: Read`, `Metadata: Read`, `Members: Read`. Locked at App registration; adding any later requires every installation to re-authorize.

## Architecture changes

### Auth flow (target)

```
admin → /api/connectors/github/initiate
      → github.com/apps/holo/installations/new?state=<jwt>
      → /api/connectors/github/install-callback (installation_id, setup_action=install|update)
      → github_installations.installation_id (no token stored)

worker, on demand:
  installation_id + private_key → JWT → POST /app/installations/{id}/access_tokens
                                      → 1-hour token used for that single sync
                                      → cached in-process for ~50 min
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

`sources` rows for GitHub will carry `metadata.installation_id = N`. The `connector_credentials` table no longer holds GitHub rows after cutover.

### Token loading

`packages/connectors/src/github/auth.ts` (new):

```ts
export async function loadGithubInstallationToken(args: {
  organizationId: string;
  db: DB;
}): Promise<string>;
```

- Look up `github_installations` row for the org.
- Mint a JWT signed with `GITHUB_APP_PRIVATE_KEY` (RS256, ≤10 min expiry per GitHub spec).
- POST it to `/app/installations/{id}/access_tokens`.
- Cache result in-process keyed by `installation_id` with a 50-min TTL.
- Throw a `HOLO_GITHUB_INSTALLATION_SUSPENDED` if the row's `suspended_at IS NOT NULL`.

The worker's `loadConnectorToken(... 'github')` is replaced by this call.

### Webhook intake

New endpoint: `POST /api/webhooks/github` in `apps/web`.

Verifies the `X-Hub-Signature-256` HMAC against `GITHUB_APP_WEBHOOK_SECRET` (read raw body before JSON parsing), dispatches by `X-GitHub-Event`:

| Event | Action |
|---|---|
| `installation` (`created` / `deleted` / `suspend` / `unsuspend`) | Upsert / mark `suspended_at` on `github_installations` |
| `installation_repositories` (`added` / `removed`) | Re-sync the repo allowlist for that installation |
| `pull_request`, `pull_request_review`, `pull_request_review_comment` | v1: enqueue a generic incremental prose-sync. v2: fast-path single-PR re-index. |
| `issues`, `issue_comment` | v1: enqueue a generic incremental prose-sync. v2: fast-path single-issue. |
| `push` (default branch only) | Enqueue an incremental code-sync diff from the cursor SHA |

v1 of this migration just makes the install/uninstall lifecycle work end-to-end. The per-resource fast paths are deferred — we keep the existing 6h scheduler so even if webhooks lag, nothing falls through.

## Implementation phases

Five phases. Each is independently mergeable.

### Phase 1 — App registration + auth helper + schema

1. Register the GitHub App in the holo dev account. Set permissions, webhook URL `https://<dev-host>/api/webhooks/github`, subscribe to events listed above.
2. Save `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_APP_WEBHOOK_SECRET`, `GITHUB_APP_SLUG` as env vars. Update `packages/env/src/index.ts` and `.env.example`.
3. Migration `0027_github_installations.sql` adding the table.
4. `packages/connectors/src/github/auth.ts` with `loadGithubInstallationToken`. JWT via `jsonwebtoken`. Token cache in-memory, keyed on installation_id. Test seam for the cache.
5. Unit tests: JWT signature shape, installation lookup, suspended-installation error, cache TTL behavior.

### Phase 2 — Install flow + UI

1. Update `/api/connectors/github/initiate`: return `authorizeUrl: 'https://github.com/apps/<slug>/installations/new?state=<jwt>'`. State JWT carries `user_id`, `organization_id`, `csrf_nonce` (same shape as today's OAuth state).
2. New route `/api/connectors/github/install-callback`. Verify state, fetch installation metadata via `GET /app/installations/{id}` (using a JWT from our private key, since we don't have an installation token yet for that install), upsert `github_installations`, upsert `sources` row with `metadata.installation_id`, redirect to `/connections`.
3. Delete the old `/api/connectors/github/callback`, `/api/connectors/github/repos` route's auth-via-`connector_credentials` (replace with installation-token auth), and the GitHub-specific OAuth code in `packages/connectors/src/github/index.ts` (`buildAuthorizeUrl` / `exchangeCode` / `refresh`).
4. UI: `connector-row.tsx` GitHub button labels stay "Connect" / "Manage" but the underlying flow is App. Manage sheet's "Reconnect" becomes "Manage installation" linking to `https://github.com/installations/<id>`.

### Phase 3 — Worker uses installation tokens

1. `apps/worker/src/queues/runners.ts`: `loadConnectorToken(... 'github')` is replaced by a call to `loadGithubInstallationToken` (which reads `github_installations`, mints/caches the token via the App private key).
2. Clone URL: `https://x-access-token:${token}@github.com/...` works unchanged — the username is informational, GitHub accepts any username with a valid installation token.
3. **Deferred:** `packages/connectors/src/github/api-client.ts` retry-on-401 by minting a fresh token. The 50-min cache means the token is fresh enough for typical sync durations; a sync that exceeds the cache window will fail once with a 401 and BullMQ will retry the whole job, which mints a fresh token. Acceptable for now; revisit if we see real-world 401-mid-sync flapping.
4. **Done in this phase:** repo-source fallback. With App auth the admin already curates repos at install time on GitHub's side, so requiring a separate `connector_allowlists` entry creates redundant friction. The runner now defaults to "everything the installation can see" when the allowlist is empty for github; the picker stays a true subset filter for explicit narrowing.

### Phase 4 — Webhook intake

1. `apps/web/src/app/api/webhooks/github/route.ts`. Read raw body, HMAC-SHA256 verify, parse JSON.
2. Handle `installation.*` and `installation_repositories.*` lifecycle events — upsert / soft-delete `github_installations` rows, update sources / allowlist.
3. Stub PR/issue/push handlers — log + enqueue a generic incremental sync. Fast-path is v2.
4. Tests: HMAC tampering, suspended installation, install/uninstall round-trip.

### Phase 5 — Disconnect path

1. `DELETE /api/connectors/github/connection`: mint App JWT, call `DELETE /app/installations/{id}` to uninstall on GitHub's side, then delete the `github_installations` row, `sources` row (cascade clears artifacts → chunks), and `connector_allowlists` rows for github.
2. Confirmation dialog in the manage sheet says "uninstalls the holo App from <org>" so the admin understands GitHub-side effect.

## Pre-flight cleanup (before Phase 1 lands in dev)

Run-once SQL on dev DB to wipe existing OAuth GitHub state cleanly:

```sql
delete from connector_credentials where provider = 'github';
delete from connector_allowlists where provider = 'github';
delete from sources where provider = 'github';
-- chunks + artifacts cascade via FK
```

Plus `redis-cli del bull:github-code-sync:* bull:github-prose-sync:*` to drop any in-flight jobs.

## Open questions (still)

- **Installation JWT signing library.** `jsonwebtoken` is the obvious pick (already in the ecosystem), but `@octokit/auth-app` does the whole flow (JWT + installation token exchange + caching) for us. Net 50 LOC vs. ~150 LOC. **Lean: use `@octokit/auth-app`.** Decide in Phase 1.
- **Self-host docs.** Every self-hoster registers their own App. Need a `docs/connectors/github-app-setup.md` with a manifest JSON for one-click registration. Track separately, not blocking the code refactor.

## Effort estimate

| Phase | Effort |
|---|---|
| 1 — App reg + auth helper + schema | 1.5 days |
| 2 — Install flow + UI cleanup | 1 day |
| 3 — Worker token integration | 0.5 day |
| 4 — Webhook intake (lifecycle only) | 1 day |
| 5 — Disconnect | 0.5 day |
| **Total** | **~4.5 days** |

Down from 5.5 because no deprecation phase.

## Test plan

- Unit: token minting (signature, expiry), token cache TTL, HMAC verification (correct + tampered + wrong-secret), suspended-installation error path.
- Integration: install on a sacrificial org → sync → uninstall, asserting (a) chunks landed, (b) installation row written, (c) cleanup deletes everything.
- Manual: smoke test on a real account, verify the install UI on GitHub's side, verify the audit log shows "holo App" not a person.
