# Week-1 backlog

Concrete issues to seed the GitHub Project. Each is sized to fit in a day or two. Copy them into GitHub Issues; tag with `v0.1` and the relevant `area:` label.

The goal of v0.1 is the **substrate** — Slack ingested end-to-end, hybrid search working, MCP serving retrieval tools to Claude Desktop. Skills (v0.5) and the closed loop (v0.6) are scaffolded as empty packages with READMEs only, so the architectural seams are visible but no implementation work happens on them yet.

---

## Infrastructure

### 1. Initialize monorepo
**Area:** `area:infra` · **Estimate:** 0.5d
- pnpm workspaces, Turborepo, Node 20+, pnpm 9+
- Root `package.json`, `pnpm-workspace.yaml`, `turbo.json`
- Shared `tsconfig.base.json`, ESLint config, Prettier config in `packages/config`
- `.gitignore`, `.editorconfig`, `.nvmrc`
- **Done when:** `pnpm install` works and `pnpm typecheck` runs across an empty workspace.

### 2. Bootstrap `apps/api` (NestJS)
**Area:** `area:infra` · **Estimate:** 0.5d
- NestJS 11 with SWC compilation
- `/health` endpoint
- `@nestjs/swagger` + `nestjs-zod` wired up, OpenAPI served at `/openapi.json`
- Pino logger
- **Done when:** `curl localhost:3001/health` returns 200 and OpenAPI is generated.

### 3. Bootstrap `apps/web` (Next.js)
**Area:** `area:infra` · **Estimate:** 0.5d
- Next.js 15 App Router, Tailwind, shadcn (Button, Card, Input)
- Marketing landing page placeholder (uses Memex name + Bush quote)
- `/health` route that calls the API
- **Done when:** `pnpm dev` shows a styled landing page that calls the API.

### 4. Bootstrap `apps/worker`
**Area:** `area:infra` · **Estimate:** 0.5d
- NestJS standalone application (no HTTP)
- BullMQ wired to Redis
- Example processor that logs "hello from worker"
- Same Dockerfile as `apps/api` with a different `CMD`
- **Done when:** enqueueing a job from the API runs in the worker.

### 5. Bootstrap `apps/mcp` (Hono)
**Area:** `area:infra` · **Estimate:** 0.5d
- Hono on Node, Streamable HTTP transport using `@modelcontextprotocol/sdk` ≥ 1.18
- One `ping` tool annotated `readOnlyHint: true`
- Origin and DNS-rebinding middleware
- **Done when:** Claude Desktop connects to `http://localhost:8090/mcp` and can call `ping`.

### 6. `packages/db` with Drizzle
**Area:** `area:infra` · **Estimate:** 1d
- `drizzle-kit` configured
- Initial schema: `workspaces`, `users`, `members`, `sessions`, `api_keys`
- pgvector via `CREATE EXTENSION IF NOT EXISTS vector;`
- pg_trgm same way
- `pnpm db:generate`, `pnpm db:migrate`, `pnpm db:studio` scripts
- **Done when:** migrations apply cleanly and Drizzle Studio shows the schema.

### 7. Stub `packages/skills` and `packages/plans`
**Area:** `area:infra` · **Estimate:** 0.5d
- Empty TypeScript packages with `package.json` and a README explaining what will live there in v0.5 and v0.6
- Exports an empty type module so imports from elsewhere don't break later
- This makes the architectural boundaries visible from day one
- **Done when:** both packages exist, README content is non-trivial, and they're listed in `pnpm-workspace.yaml`.

### 8. `docker-compose.yml` for development
**Area:** `area:infra` · **Estimate:** 0.5d
- Postgres 16 with `pgvector/pgvector:pg16` image
- Redis 7 with `maxmemory-policy=noeviction`
- All four apps with hot reload
- `.env.example` with every required variable documented
- **Done when:** `docker compose up` boots a working dev environment.

### 9. CI pipeline
**Area:** `area:infra` · **Estimate:** 0.5d
- GitHub Actions: lint, typecheck, test, build on every PR
- Turbo Remote Cache (free tier for OSS)
- **Done when:** opening a PR triggers all checks.

---

## Auth

### 10. Better Auth integration
**Area:** `area:auth` · **Estimate:** 1d
- `packages/auth` with Better Auth instance
- `organization`, `apiKey`, and `oauthProvider` plugins enabled
- Drizzle adapter wired
- Email + GitHub OAuth providers
- **Done when:** users can sign up and a session cookie is set.

### 11. Sign-up / sign-in / workspace creation flows
**Area:** `area:web` · **Estimate:** 1d
- `/sign-in`, `/sign-up`, `/workspaces/new` pages
- Shadcn forms with Zod validation
- Workspace creation creates an org via Better Auth
- Redirect to `/workspaces/[id]/dashboard`
- **Done when:** new user → workspace creation → empty dashboard, end-to-end.

### 12. Member invite flow
**Area:** `area:web`, `area:auth` · **Estimate:** 0.5d
- "Invite member" UI in workspace settings
- Email-based invite (stub mailer for v0.1)
- Acceptance creates a member with `member` role
- **Done when:** an invited user can join.

### 13. API key generation
**Area:** `area:web`, `area:auth` · **Estimate:** 0.5d
- "API Keys" page in settings
- Create / list / revoke
- Show key once; thereafter prefix + last-used
- **Done when:** keys can be issued and revoked, revoked key returns 401.

### 14. `ApiKeyGuard` and `SessionGuard`
**Area:** `area:api`, `area:auth` · **Estimate:** 0.5d
- `SessionGuard` for cookie auth
- `ApiKeyGuard` for `Authorization: Bearer <key>`
- Both populate `request.workspaceId` and `request.user`
- **Done when:** every endpoint can require either or both, tests cover the matrix.

### 15. Audit log
**Area:** `area:api` · **Estimate:** 0.5d
- `audit_log` table with `(workspace_id, user_id, actor_type, action, resource_type, resource_id, ts, ip, user_agent, params_hash)`
- Interceptor writes a row on every authenticated mutation
- Read endpoints log under `read.*` when accessed via API key
- **Done when:** any mutation produces an audit row.

---

## Slack connector

### 16. `Connector<>` interface
**Area:** `area:connectors` · **Estimate:** 0.5d
- Define interface in `packages/connectors/src/types.ts`
- Helper types: `Connection`, `RawCredentials`, `SyncCheckpoint`, `Cursor`, `Emitter`, `WebhookVerification`, `NormalizedEvent`, `ConnectionHealth`
- ADR: `docs/decisions/0001-connector-port-interface.md`
- **Done when:** interface compiles and is exported.

### 17. Token encryption
**Area:** `area:connectors`, `area:auth` · **Estimate:** 1d
- Envelope encryption: master key wraps per-row data encryption key
- libsodium `crypto_secretbox`
- `connections` stores `ciphertext`, `nonce`, `wrapped_dek`
- Key rotation runbook stub
- **Done when:** credentials persist encrypted and round-trip cleanly.

### 18. Slack OAuth install flow
**Area:** `area:connectors` · **Estimate:** 1d
- "Add Slack" button in dashboard
- OAuth redirect with `state` CSRF protection
- Callback exchanges code, stores encrypted, creates `Connection`
- Settings show connected status, can disconnect
- **Done when:** clicking → Slack OAuth → "Slack connected".

### 19. Slack `fullSync`
**Area:** `area:connectors` · **Estimate:** 1.5d
- Iterate channels (public + private the user has access to)
- Paginate `conversations.history`
- Group messages by `thread_ts`, fetch `conversations.replies`
- Emit `SlackThread` resource per thread
- Checkpoint after every channel
- **Done when:** running `fullSync` against a test workspace produces threads in `documents`.

### 20. Slack `incrementalSync`
**Area:** `area:connectors` · **Estimate:** 1d
- Cursor `(channel_id, oldest_ts)` per channel
- Hourly via BullMQ repeatable job
- Update cursor after successful processing
- **Done when:** new messages appear in `documents` within an hour.

### 21. Slack mention/channel resolution
**Area:** `area:connectors` · **Estimate:** 0.5d
- Cache `users.list` and `conversations.list` for 1h
- Replace `<@U…>` and `<#C…>` with names *before* embedding
- **Done when:** stored thread text contains "Mathias mentioned in #general", not raw IDs.

### 22. Slack webhook receiver
**Area:** `area:connectors` · **Estimate:** 1d
- HMAC verification with `x-slack-signature` and `x-slack-request-timestamp`
- Idempotency on `(provider, event_id)` with `INSERT … ON CONFLICT DO NOTHING`
- Enqueue `slack.event` job on insert
- Return 200 within 1s
- Handle URL verification challenge
- **Done when:** posting in Slack triggers an enqueued job within seconds.

### 23. Thread-as-document chunking
**Area:** `area:retrieval`, `area:connectors` · **Estimate:** 1d
- Thread becomes one or more `documents`
- ≤1k tokens: one chunk
- Longer: rolling-window chunking with thread metadata in each chunk
- Chunk includes channel name, participant list, time range
- **Done when:** any thread can be retrieved as chunks with provenance.

---

## Search and MCP

### 24. Embedding pipeline
**Area:** `area:retrieval` · **Estimate:** 1d
- `EmbeddingProvider` interface in `packages/llm`
- OpenAI `text-embedding-3-large` truncated via Matryoshka to 1024 dims
- Batch size ~100 chunks per request
- Worker job: chunks without embedding → embed → store
- Re-embed job stub for future model swaps
- **Done when:** new chunks get embedded within minutes.

### 25. Hybrid search with RRF
**Area:** `area:retrieval` · **Estimate:** 1.5d
- Single SQL CTE in Drizzle: vector candidates by cosine, BM25-ish by `ts_rank_cd`, fused with RRF (k=60)
- `packages/retrieval-core` exports `search({ workspaceId, query, filters, limit })`
- Filters: source, date range, document type
- Returns chunks with parent document, snippet, scores
- ADR: `docs/decisions/0002-postgres-only-hybrid-search.md`
- **Done when:** searching for a known phrase from a Slack thread returns it in the top 3.

### 26. `POST /v1/search` endpoint
**Area:** `area:api` · **Estimate:** 0.5d
- Zod schema for request and response in `packages/contracts`
- Calls `retrieval-core.search`
- API-key auth required
- **Done when:** documented in OpenAPI and a curl example works.

### 27. MCP `search` tool
**Area:** `area:mcp` · **Estimate:** 1d
- Tool registered in `apps/mcp` using `@modelcontextprotocol/sdk`
- Input schema: `{ query, filters?, limit?, contextChunks? }`
- Output schema with chunks + provenance
- Annotated `readOnlyHint: true, idempotentHint: true, openWorldHint: false`
- **Done when:** Claude Desktop calls `search` and gets useful results.

### 28. MCP `fetch_document` tool
**Area:** `area:mcp` · **Estimate:** 0.5d
- Input: `documentId`
- Output: full document with all chunks reassembled
- For Slack: entire thread reconstructed
- **Done when:** Claude Desktop can `fetch_document` and read the original.

### 29. OAuth 2.1 + PKCE on MCP server
**Area:** `area:mcp`, `area:auth` · **Estimate:** 1d
- Static client registration for v0.1 (DCR is v0.3)
- Better Auth `oauthProvider` plugin issues tokens
- MCP server verifies bearer token on every request
- Token includes `workspace_id` and scope claims
- **Done when:** Claude Desktop completes OAuth before being allowed to call tools.

---

## Dashboard

### 30. Connections page
**Area:** `area:web` · **Estimate:** 1d
- List of connectors (Slack live; rest "coming soon")
- "Connect" button per connector
- For connected: last sync time, document count, sync status, "Disconnect"
- **Done when:** the connections page is the obvious starting point.

### 31. Sync progress UI
**Area:** `area:web` · **Estimate:** 1d
- Real-time progress per connection (server-sent events from API)
- Show current channel/document, total processed
- Error display with retry button
- **Done when:** running a Slack sync shows live progress.

### 32. Documents browser
**Area:** `area:web` · **Estimate:** 1d
- Paginated list of synced documents per connection
- Source filter, date filter, search bar
- Click a document → see full content + chunks + metadata
- **Done when:** users can verify what's synced without leaving the dashboard.

### 33. Search playground
**Area:** `area:web` · **Estimate:** 0.5d
- Query box + filters
- Results with snippets, highlighted matches, source links
- Useful for debugging retrieval quality
- **Done when:** the team can dogfood search quality without writing curl.

---

## Demo & launch prep for v0.1

### 34. End-to-end smoke test
**Area:** `area:infra` · **Estimate:** 0.5d
- Playwright test: create workspace → connect Slack (mocked OAuth) → wait for sync → search → verify result
- Runs in CI nightly
- **Done when:** the test passes reliably on main.

### 35. Quickstart docs
**Area:** `area:docs` · **Estimate:** 0.5d
- README quickstart matches reality
- "Connect Claude Desktop" section with screenshots
- Self-host instructions
- **Done when:** a stranger can clone the repo and reach a working state in <30 minutes.

### 36. Demo video
**Area:** `area:docs` · **Estimate:** 0.5d
- 2–3 minute screencast: clone → start → connect Slack → ask Claude a question
- Posted in README and on Discussions
- **Done when:** v0.1 has a public artifact.

---

## Total v0.1 size

~36 issues, sized at ~26 person-days. With one full-time engineer and good focus, fits the 4-week milestone. With two engineers, finishes in 2–3 weeks. Slip = cut UI polish (30–33) before cutting connector or retrieval correctness.
