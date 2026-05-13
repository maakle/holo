# Changelog

## Unreleased — Dual-edition relicense (CE: MIT · EE: commercial)

Branch: `claude/add-licensing-editions-TRMkp`.

### Changed (breaking)

- **License is now dual: MIT for the Community Edition, commercial for the Enterprise Edition.** The whole repo was previously AGPL-3.0-or-later. CE — everything **not** under a `**/ee/**` directory — is now [MIT](./LICENSE), the permissive license used by the closest OSS analog (Onyx). EE — everything under `**/ee/**` — is governed by [`LICENSE-EE`](./LICENSE-EE), a paid commercial license for production use. Full breakdown in [`LICENSING.md`](./LICENSING.md).
- **Contributor terms updated.** PRs to CE files are licensed under MIT. PRs to EE files grant the maintainer the additional relicensing rights spelled out in `LICENSE-EE` § 3. The CLA flow in `CONTRIBUTING.md` is unchanged.

### Added

- **`LICENSE-EE`** — Holo Enterprise Edition License v1.0. Permits read/fork/development/evaluation use; production use requires a paid Enterprise subscription.
- **`LICENSING.md`** — single source of truth for what's CE vs EE today, what's planned for EE, and the contribution rules per edition.
- **EE feature roadmap** documented in `README.md` and `LICENSING.md`: collaboration (shared chats and agents), SSO (Google OAuth, OIDC, SAML, SCIM), RBAC, analytics (per team/LLM/agent), query history (long-retention auditable trail), custom code (PII redaction, sensitive-query rejection, custom analyses), and whitelabeling (name, logo, banners, brand color, custom domain). Each ships under `**/ee/**` as it lands.

### Migration notes

- **No code moves in this commit.** Every file currently in the repo stays where it is and becomes MIT — the EE directories don't exist yet. As EE features land they'll be authored under `apps/<app>/src/.../ee/` and `packages/<pkg>/ee/` paths.
- Downstream forks that previously relied on AGPL copyleft propagation should review whether MIT changes their obligations (it does — MIT does not require derivatives to remain open source). If you forked the project specifically *because* of AGPL, open an issue and let us know.
- Audit log retention, exports, and SIEM hooks ("Query History" in EE marketing) build on the CE per-call audit log that already ships today. The CE audit log itself stays in CE.
- The skill marketplace contribution license changes from AGPL-3.0 to MIT in line with the rest of CE — see [`docs/ROADMAP.md`](./docs/ROADMAP.md) v0.3.

### Files touched

- `LICENSE` (replaced AGPL-3.0 with MIT)
- `LICENSE-EE` (new)
- `LICENSING.md` (new)
- `README.md`, `CONTRIBUTING.md`, `DESIGN.md`, `CHANGELOG.md`
- `apps/web/src/app/page.tsx` (Trust band + footer copyright + Licensing link)
- `docs/ROADMAP.md`, `docs/launch/show-hn-draft.md`, `docs/designs/holo-v01-yc-prep.md`, `docs/decisions/0001-connector-port-interface.md`

## v0.3 — Per-user OAuth ACL fan-out (unreleased)

Branch: `claude/holo-v0.3-per-user-oauth`. Companion slice: `claude/holo-v0.3-cli-as-tool` (CLI-as-tool registration; ships separately).

### Added

- **Real OAuth 2.1 + PKCE provider** (`@holo/oauth-provider`). Replaces the v0.2 single-tenant DCR/authorize/token stubs. New tables: `oauth_auth_codes` (60s TTL, one-shot, PKCE-bound), `oauth_access_tokens` (24h TTL, sha256-hashed at rest, revocable). PKCE S256-only, RFC 7636 verifier charset/length enforced. Authorization codes are atomically consumed via `SELECT … FOR UPDATE` inside a transaction.
- **Per-user Slack OAuth** at `/connect/slack-personal`. Each holo user does their own Slack user-token OAuth dance (`user_scope = channels:read,groups:read,im:read,mpim:read`); user tokens are stored in `slack_user_credentials` (encrypted via the existing `encryptedText` Drizzle custom type). On callback, an inline `runSlackSubjectsSync` populates the user's `user_subjects_cache` rows immediately.
- **`user_subjects_cache` table + `@holo/user-subjects` package.** Atomic per-source replace (`replaceSubjectsForUser`), MCP-time read (`getSubjectsForUser`). Stores subjects like `slack-channel:C123`. `audit_events` `user_subjects.refreshed` row written on every sync.
- **Slack-subjects worker cron** (`apps/worker/src/slack-subjects/`). Runs every 30 minutes; iterates `slack_user_credentials` and refreshes each user's cache. Per-user failures are isolated.
- **`apps/mcp/src/middleware/session.ts`** now resolves OAuth bearer tokens (via `validateAccessToken`) before falling back to v0.1 API tokens, then to the session cookie. The middleware sets `userId` and `organizationId` on the request context regardless of which path matched.
- **`apps/mcp/src/main.ts` `resolveContext`** fans out `userSubjects` to `['org:<O>', 'user:<U>', ...await getSubjectsForUser(db, userId)]`. The retrieval layer's existing `acl_subjects && userSubjects::text[]` filter does the rest. **Behavior change: users without Slack connected no longer see chunks gated on a Slack channel subject.** Org-level chunks (`acl_subjects = ['org:<O>']`) are unaffected.
- **`apps/mcp/src/rest/router.ts`** `/v1/search` extends the same fan-out for consistency.

### Changed (breaking)

- **DCR (`POST /api/oauth/register`) is now session-required.** v0.2 allowed anonymous DCR with the resulting client bound to the all-zeros org. v0.3 requires a logged-in holo user; the registered client is bound to that user's `organizationId`. Anonymous DCR returns 401.
- **All v0.2 access tokens minted via the stub flow (`access_token: 'holo_<auth_code>'`) are invalidated.** v0.2 explicitly marked the stub flow as "do NOT expose to untrusted networks." Re-authorize via the real OAuth flow.
- **`/api/oauth/authorize` rejects requests missing `code_challenge` or `code_challenge_method=S256`.** PKCE is no longer optional.
- **`/api/oauth/token` requires `code_verifier`, `redirect_uri`, and `client_id`** in the request body. The exchange validates PKCE, redirect URI, and client ID against the stored auth code.

### Out of scope (this slice)

- Per-user OAuth for Notion, GitHub, Grain, Pylon. Those connectors continue to emit only `org:` ACL subjects; users see all their org-level data regardless. Each is its own follow-up slice.
- Refresh tokens. Access tokens are 24h plain bearer; clients re-authorize when they expire.
- Token-level scope enforcement beyond presence. Scopes are stored on the token row; tools don't currently introspect them.
- Slack subjects TTL admin UI. The 30-minute cadence is hardcoded.
- An `mcp-remote`-style proxy for clients that don't natively speak OAuth.

### Migration notes

- Run `pnpm --filter @holo/db migrate` to apply `0018_per_user_oauth.sql` (4 new tables, no destructive changes to existing tables).
- Set `HOLO_TOKEN_ENCRYPTION_KEY` in the worker environment if not already set (the `slack_user_credentials.access_token_encrypted` column uses the existing encrypted-text type that's been in the schema since v0.0).
- Existing `oauth_clients` rows registered against the all-zeros stub org are left in place but cannot complete a new authorize/token flow (no real org's user can mint codes for them). Manually re-register if needed.
- Each holo user must visit `/connect/slack-personal` to get channel-level retrieval; until then they see only `org:`-level chunks.
