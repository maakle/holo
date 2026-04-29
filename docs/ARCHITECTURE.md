# Architecture

This document captures the architectural decisions for Holo. The decisions here are settled — they were made after deep research into how comparable open-source projects (Dust, Onyx, Langfuse v3, Twenty, Trigger.dev, Cal.com) actually structure themselves and what they regret. Don't relitigate them in issues without strong new evidence.

## The product in three layers

Holo is structured as three architectural layers stacked on top of each other:

1. **Context layer** — connectors ingest from every tool, normalize, embed, store with ACLs preserved. Agents and humans can query it. Foundation for everything above.
2. **Skills** — synthesizer extracts procedures from the context layer (how refunds get handled, how PRs get reviewed) and stores them as Postgres rows in the Anthropic Skill format (frontmatter + procedure + example tools). Agents discover and invoke them via the MCP `list_skills` and `get_skill` tools — skills are served dynamically from the database, not as filesystem artifacts.
3. **Loop** — Plans/Intents subsystem holds declarations of what should be happening (sprint goals, PRDs, OKRs). Drift detector continuously compares actual artifacts against intent and surfaces gaps.

Layers ship in order. v0.1–v0.4 build the context layer. v0.5 adds skills. v0.6+ adds the loop. The repo structure anticipates all three from day one so we never have to refactor the foundation.

## Goals and constraints

- **Self-hostable.** `docker compose up` must work. No managed-only services on the critical path.
- **Architecture quality > maximum contributor pool size.** This codebase needs to scale to 50+ bounded modules without collapsing.
- **MCP-first.** Agents are the primary consumer. REST is secondary.
- **Medium-length jobs.** Connector syncs and agent runs are minutes, not seconds and not hours.
- **Continuous sync.** Multiple times per day, durably.
- **Tokenization optimized for agent consumption.** Not just "stuff into a vector DB."
- **Procedural extraction is a first-class output**, not an afterthought built on top later.

## Stack at a glance

| Layer | Choice |
|---|---|
| Web | Next.js 15 App Router |
| API | NestJS 11 |
| Workers | NestJS standalone + BullMQ |
| MCP | Hono on Node |
| ORM | Drizzle |
| DB | Postgres 16 + pgvector ≥ 0.8 + pg_trgm |
| Cache/Queue | Redis 7 |
| Auth | Better Auth (organization + apiKey + oauthProvider) |
| Embeddings | `text-embedding-3-large` @ 1024 dims default; BGE-M3 self-host |
| LLM provider | Anthropic Claude default (skill synthesis, contextual chunking, redaction). Pluggable per workspace config — switch to OpenAI / Mistral / local model without code changes. |
| Reranker | bge-reranker-v2-m3 (opt-in) |
| Skill format | Anthropic Skill format (frontmatter + procedure + example tools), stored as Postgres rows and served dynamically over MCP — not filesystem artifacts |
| Monorepo | pnpm workspaces + Turborepo |

## Why these choices

### NestJS for the API, Next.js for the dashboard

The Next.js-monolith pattern (Cal.com, Dub, Documenso, Langfuse) is beautiful at small scale and degrades past ~30 modules. Cal.com themselves are migrating *toward* a Repository + Service convention to recover what NestJS gives for free.

For our domain — connectors, retrieval, skills, plans, evals, auth, billing, webhooks — DI and the module system pay off concretely. Each connector module declares its dependencies explicitly (`OAuthClient`, `Normalizer`, `QueueProducer`, `SyncStateRepo`, `AclExtractor`). Guards (`ApiKeyGuard`, `WorkspaceScopeGuard`), interceptors (rate limiting, audit logging, OTel spans), and pipes (Zod validation) compose across all modules. Request-scoped DI carries `workspaceId` and `traceId` automatically.

Twenty CRM is the closest analog and validates the structure. **Copy Twenty's module layout. Refuse to copy its TypeORM choice** — that's where their self-host pain lives (issues #19863, #14705, #12936 — TypeORM migrations missing `IF NOT EXISTS` guards).

Next.js for the frontend (not Vite SPA) because we want marketing + docs + dashboard at one URL with server components.

### Drizzle, not Prisma

Pgvector is our primary index. Prisma 7 still doesn't natively support it — vectors must be `Unsupported("vector")` with `$queryRaw` and the `pgvector-node` helpers. Issues #18442 and #26546 remain open.

Drizzle declares `vector('embedding', { dimensions: 1024 })` as a built-in column type with `cosineDistance`, `l2Distance`, `innerProduct` composing naturally. Hybrid SQL+vector queries — `WHERE workspace_id = $1 AND source IN ('slack','linear') AND acl_subjects && $user_subjects ORDER BY embedding <=> $2 LIMIT 50` — are one composable Drizzle query. With Prisma you fall to `$queryRaw` and lose composition on every retrieval call.

Industry signal: PlanetScale hired the Drizzle core team in early 2026; Prisma's March 2026 chained-query API imitates Drizzle's syntax. Better Auth ships a Drizzle adapter as the default for new projects.

Discipline: `drizzle-kit generate` + `migrate` only, ban `push` in CI, defensive DDL with `IF NOT EXISTS` everywhere.

### Better Auth, not NextAuth or Lucia

MCP's authorization spec mandates OAuth 2.1 with PKCE, Protected Resource Metadata (RFC 9728), Authorization Server Metadata (RFC 8414), and Dynamic Client Registration (RFC 7591). For Claude Desktop, ChatGPT, Cursor, and custom agents to connect without humans pre-registering them, **DCR is required**.

Better Auth 1.5's OAuth 2.1 Provider plugin is the only TypeScript auth library with first-class MCP framing — built-in DCR, JWT/JWKS, PKCE, consent UI, scope narrowing. The `organization` plugin gives workspaces/members/invites/RBAC. The `apiKey` plugin handles per-key permissions, rate-limit, refill, hashed storage.

NextAuth would require ~500 lines of org/member tables + API key handling + integrating `node-oidc-provider` for the MCP OAuth provider — multi-week work. Lucia is deprecated as of March 2025.

**Risk:** Better Auth is young (28k stars, but young). Mitigate by isolating it behind an `AuthService` interface so the swap-cost is bounded.

### BullMQ for v1, with a `step()` helper, Inngest for v2

Trigger.dev v4 is disqualified — its supervisor architecture requires Docker socket access, which Railway doesn't provide. Their official Railway template is a two-platform hack. Hard no for v1.

Temporal is what Dust runs at scale (10M+ activities/day) — premature for v1.

BullMQ + a `step()` helper backed by a Postgres `workflow_runs` table gives ~70% of Inngest's durability value with zero extra infrastructure. The `step()` API is shaped like Inngest's so the v2 migration is mechanical.

Decompose minute-long jobs into BullMQ Flows from day one. A 5-minute monolithic handler is a footgun (lock-extension races, no replay-from-step). "Weekly briefing across 4 connectors" → fetch_slack → fetch_linear → fetch_github → fetch_notion → synthesize → render, each as its own job.

Set Redis `maxmemory-policy=noeviction`. Default `allkeys-lru` will silently drop jobs.

### Hand-written connectors behind a `Connector<>` port

Dust's connectors are TypeScript Temporal workflows behind a `BaseConnectorManager` interface — they rolled their own. Onyx ships 40+ in-tree connectors on the same pattern. Our top connectors all have excellent first-party SDKs (`@slack/web-api`, `octokit`, `@notionhq/client`, `googleapis`, `@linear/sdk`, plus per-vendor SDKs/APIs for Granola, Fathom, Fireflies).

```ts
export interface Connector<TConfig = unknown, TResource = unknown> {
  readonly id: string;
  buildAuthorizeUrl(ctx: AuthContext): string;
  exchangeCode(code: string, ctx: AuthContext): Promise<RawCredentials>;
  refresh(creds: RawCredentials): Promise<RawCredentials>;
  fullSync(conn: Connection<TConfig>, emit: Emitter<TResource>): AsyncIterable<SyncCheckpoint>;
  incrementalSync(conn: Connection<TConfig>, since: Cursor, emit: Emitter<TResource>): AsyncIterable<SyncCheckpoint>;
  verifyWebhook(req: RawHttpRequest): WebhookVerification;
  normalizeWebhook(req: RawHttpRequest): NormalizedEvent[];
  testConnection(conn: Connection<TConfig>): Promise<ConnectionHealth>;
}
```

For long-tail providers (BambooHR, Workday, Salesforce), implement a `NangoConnectorAdapter` that satisfies this interface — Nango's catalog without committing the core stack to it.

**Encrypt OAuth tokens with envelope encryption from day one.** Master key (env or KMS) wraps a per-row data encryption key. Plan for key rotation.

**Webhook handling:** read raw bytes for HMAC, constant-time verify, `INSERT … ON CONFLICT DO NOTHING` on `(provider, event_id)`, enqueue if inserted, return 200 within ~1s. Webhooks update cursors opportunistically but never replace periodic pulls.

**Ship order:** Slack → GitHub (as a GitHub App) → Notion → Google Workspace → Linear → Granola/Fathom (transcripts).

### Meeting transcripts as a first-class connector category

Hu's RFS specifically calls out call recordings. Procedural knowledge often originates on calls and never makes it to a written artifact. The transcript connector category treats each meeting as a document with:

- **Speakers as ACL subjects** (a meeting is visible to its participants and any explicit shares)
- **Per-speaker chunks** so retrieval can cite "Alice said X" rather than just "the meeting said X"
- **Decision extraction** as a downstream synthesis step (decisions made on calls become first-class records linked back to the speakers and the moment they were made)

Granola, Fathom, Fireflies, Read.ai, Otter all expose APIs. Granola first because the founder uses it.

### Hybrid search with RRF, in Postgres, for v1

Default to `tsvector` + `pg_trgm` + pgvector ≥ 0.8 fused with **Reciprocal Rank Fusion** (sum of `1/(k + rank_i)`, k=60, single SQL CTE). Tiger Data benchmarks pgvector + BM25 at 138M docs sub-second. Onyx Lite mode runs Postgres-only.

Provide an "advanced" mode that swaps the postgres image for `paradedb/paradedb` to enable real BM25 via `pg_search`.

### Contextual retrieval (Anthropic's pattern)

Prepend an LLM-generated 50–100-token situating blurb to each chunk before embedding. Anthropic reported 35% reduction in retrieval failures from contextual embeddings alone, 49% combined with contextual BM25, 67% with reranking.

### Per-source chunkers

- **Slack**: thread is the atomic document, not the message.
- **GitHub PRs**: three logical chunks per PR — title+description+linked-issue, per-file diff hunks, review threads.
- **Notion**: hybrid block-level + page-level. Prepend breadcrumb.
- **Google Docs**: heading-aware recursive chunking, ~512–1000 tokens, ~10–15% overlap.
- **Linear**: issue body + each comment as separate chunks with shared `parent_id`.
- **Meeting transcripts**: per-speaker turn chunks with timestamp, plus a meeting-level summary chunk for navigational queries.

### Embeddings: 1024 dims, pluggable

Default: `text-embedding-3-large` truncated via Matryoshka to 1024 dims (cloud) / BGE-M3 at 1024 (self-host). 1024 is the HNSW sweet spot. Always pluggable. Provide a re-embedding background job.

### MCP server: separate process

Onyx's `mcp_server` runs as a sibling service. We do the same. Independent scaling, isolated DNS-rebinding/Origin middleware, read-only DB role for the MCP process.

**Streamable HTTP only.** Stdio can't multiplex users.

**MCP tool surface:**

*Retrieval tools (v0.1–v0.3):*
- `search`, `fetch_document`, `list_recent` (generic)
- `get_slack_thread`, `get_pr`, `get_notion_page`, `get_linear_issue`, `get_meeting` (domain-specific)
- `who_knows_about` (expertise/people search)

*Skill tools (v0.5):*
- `list_skills` — enumerate available procedural skills with descriptions and metadata
- `get_skill` — fetch a full skill (Anthropic Skill format content from the `skills` row) for an agent to read
- `execute_skill` — invoke a skill with parameters; the skill's procedure runs as a workflow with audit trail

*Loop tools (v0.6+):*
- `list_plans`, `get_plan` — read declared intents (sprint goals, OKRs, PRDs)
- `get_drift` — get current drift report between intent and reality

Anthropic and Docker both warn agents handle ~30 tools well, get confused past ~50. Skill execution is one tool; the skills themselves are dispatched dynamically inside it.

Annotate retrieval tools with `readOnlyHint: true, idempotentHint: true, openWorldHint: false` so clients can auto-approve. `execute_skill` is *not* read-only and requires explicit user approval.

### ACLs are non-negotiable

Each connector emits documents with normalized `acl_subjects text[]` (user IDs + group IDs). At query time, resolve the user's full transitive group membership from the source (cached 5–15 min). Append `WHERE acl_subjects && $user_subject_ids` to every retrieval query (GIN index on `acl_subjects`).

**The agent literally cannot retrieve anything the user can't already see in the source.** This applies to skills too — `list_skills` returns only skills whose source artifacts the requesting user can see.

Re-sync ACLs incrementally — hourly polling fine for v1. **Treat ACL sync as a separate observable subsystem with its own queue, dashboards, and integration tests.** Postgres RLS as defense-in-depth.

Multi-tenant via shared-schema with `workspace_id` everywhere. Schema-per-tenant (Twenty's pattern) caps at low thousands of tenants and is the wrong default.

## The skills layer

Skills are the differentiator. Querying alone is what Glean and Dust do. Holo goes further — extracts procedures, makes them executable.

### Skill data model

A skill is **not just a procedure template** — it is a *trigger-conditional system prompt + tool allowlist combo*. This refinement comes from observing a working MVP at the founder's company (Kombo) where the same agent has different identities ("external support agent" vs "internal context agent") depending on whether it was triggered from a Slack channel or a Pylon ticket. The `Skill` row carries the trigger spec, the system-prompt content, and the explicit tool allowlist that gates what MCP tools the agent is permitted to call when this skill is active.

```ts
type Skill = {
  id: string;
  workspaceId: string;
  name: string;                    // e.g., 'handle_customer_refund'
  description: string;             // for agent discovery
  version: number;
  status: 'draft' | 'active' | 'deprecated';

  // Trigger: when does this skill activate?
  trigger: SkillTrigger;           // see SkillTrigger below

  // Tool allowlist: what MCP tools can the agent call when this skill is active?
  // This is holo's answer to "Pylon MCP can send both internal AND external messages
  // and we can't restrict it." Per-skill tool gating is enforced at the MCP proxy layer.
  toolAllowlist: string[];         // e.g., ['search', 'get_thread', 'get_pr'] — must be a subset of available MCP tools
  toolDenylist?: string[];         // optional explicit denials (e.g., ['pylon.send_external'])

  // System prompt + procedure body in Anthropic Skill format
  // The "system prompt" framing is the skill's identity ("you are an internal support
  // researcher; never write replies that would be sent to a customer").
  // The "procedure" framing is the skill's playbook ("when asked about X, search Y, then Z").
  content: string;                 // frontmatter + system-prompt + procedure + example tools

  // What it was synthesized from (only set if synthesized; null for hand-authored skills)
  sourceArtifactIds: string[] | null;
  sourceFingerprint: string | null;
  lastSynthesizedAt: Date | null;
  nextRefreshAt: Date | null;
  staleness: 'fresh' | 'stale' | 'invalidated' | 'hand-authored';

  // Execution
  executable: boolean;             // can this skill be run, or is it read-only?
  permissionsRequired: string[];   // RBAC scopes the calling user must have
};

type SkillTrigger =
  | { kind: 'mcp_invoke' }                                          // explicit `execute_skill(id)` call
  | { kind: 'slack_channel'; channelIds: string[] }                 // bot mentioned in these channels
  | { kind: 'pylon_event'; eventTypes: string[] }                   // Pylon webhook events
  | { kind: 'github_event'; eventTypes: string[] }                  // GitHub webhook events
  | { kind: 'cli'; commandPattern: string };                        // holo CLI invocation
```

**Why this matters in practice:** the founder's existing custom agents already use this pattern informally — different system prompts and tool subsets depending on the trigger. holo formalizes it as a first-class concept. Without `trigger` and `toolAllowlist`, agents either get a single global identity (too crude) or implementers re-invent trigger-conditional dispatch in their own code (the bug-prone path the CTO's MVP works around with file-system conventions).

### Skill synthesis

A `SkillSynthesizer` worker:

1. Takes a topic (declared by user: "how do we handle refunds") or auto-discovers candidates from clustering retrieval queries that hit similar artifacts.
2. Runs a multi-pass retrieval over the context layer to gather every artifact relevant to the topic.
3. Uses an LLM with a templated prompt to extract the procedure: trigger conditions, steps, decision points, exceptions, tool calls.
4. Writes a `skills` row whose `content` field matches Anthropic's Skill format. The MCP `get_skill` tool serves this content dynamically — there's no filesystem `.md` file.
5. Records `sourceFingerprint` so changes to source artifacts trigger re-synthesis.
6. Marks the skill `draft` until a workspace admin reviews and promotes to `active`.

### Skill execution

Skills are not raw code. They're structured procedures. When `execute_skill` is invoked:

1. Holo loads the skill content.
2. The skill is run inside an agent loop where the agent reads the procedure and executes its steps using its own tools (or tools Holo provides via `toolBindings`).
3. Every execution is recorded as a `skill_run` with full step trace.
4. Skill executions write to the same `workflow_runs` infrastructure as connector syncs.

This is deliberately *not* a deterministic workflow engine. The skill is a *playbook*, the agent is the executor. The skill format is human-readable and LLM-readable.

### Why this layer matters

This is what makes Holo Blomfield's "Company Brain" rather than just "another RAG over company data." Glean and Dust are search products. Onyx is a search product. Holo is a search product *plus* a skill synthesis layer that turns the search results into operable knowledge.

The context layer is necessary. The skills are what make it useful for automation.

## The closed loop (v0.6+)

The endpoint of the architecture. Users declare intent — sprint goals, OKRs, PRDs, runbooks — as first-class `Plan` records. A `DriftDetector` worker continuously compares plans against reality:

- Sprint says "ship feature X by Friday." Drift detector scans linked Linear issues, GitHub PRs, Slack threads. Notes that the dependent issue has been blocked for three days with no updates.
- OKR says "reduce p99 latency to <200ms." Drift detector reads metrics, compares against target, flags trajectory.
- PRD says "design must use the new component library." Drift detector reads PRs, flags components built outside the system.

Drift becomes a first-class signal exposed to humans and agents. Hu's "engineering is building the wrong thing" alert.

This layer is deferred to v0.6. The context layer and skills must be solid first. But the architecture leaves room: `Plan` and `Intent` tables, `DriftDetector` worker, `drift_reports` queue.

## Process topology

Five long-lived containers in v1, growing to seven once skills and the loop ship:

```
┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐
│   web   │  │   api   │  │ worker  │  │   mcp   │
│ Next.js │  │ NestJS  │  │ NestJS  │  │  Hono   │
└────┬────┘  └────┬────┘  └────┬────┘  └────┬────┘
     │            │            │            │
     └────────────┴────────────┴────────────┘
                       │
            ┌──────────┴──────────┐
            │                     │
       ┌────▼────┐          ┌─────▼────┐
       │postgres │          │  redis   │
       │+pgvector│          │noeviction│
       └─────────┘          └──────────┘
```

In v0.5, `worker` may split into `sync-worker` and `synthesis-worker` for independent scaling — skill synthesis is LLM-heavy and shouldn't compete with connector pulls for CPU.

## Repo layout

```
holo/
├── apps/
│   ├── web/              # Next.js 15 — UI + marketing + docs + dashboard
│   ├── api/              # NestJS 11 — REST + OpenAPI + domain modules
│   ├── worker/           # NestJS standalone — BullMQ processors
│   └── mcp/              # Hono — Streamable HTTP MCP server, OAuth 2.1
├── packages/
│   ├── core/             # Domain entities, use-cases (clean-architecture core)
│   ├── connectors/       # Connector<> interface + adapters
│   ├── jobs/             # JobsModule, queue constants, step() helper
│   ├── db/               # Drizzle schema + migrations (single source of truth)
│   ├── auth/             # Better Auth instance config
│   ├── retrieval-core/   # Hybrid search, reranking, ACL — shared by api and mcp
│   ├── skills/           # Skill data model, synthesizer, executor
│   ├── plans/            # Plans/Intents data model, drift detector (v0.6)
│   ├── llm/              # LLM provider abstraction, prompt registry
│   ├── contracts/        # Zod schemas; OpenAPI generation source
│   ├── api-client/       # Generated typed client from OpenAPI
│   ├── ui/               # shadcn components
│   └── config/           # eslint/tsconfig/prettier
├── deploy/
│   ├── docker-compose.yml
│   ├── docker-compose.advanced.yml   # ParadeDB swap, MinIO, GPU reranker
│   ├── railway.json
│   └── coolify/
├── pnpm-workspace.yaml
├── turbo.json
└── package.json
```

`packages/skills` and `packages/plans` exist as folders from v0.1 with stub README files explaining what will live there. This keeps the architectural boundaries visible from day one.

## Scaling triggers

In order:

1. Split sync workers from agent workers when minute-long agent jobs block 5-minute connector syncs.
2. Split skill synthesis from connector sync (v0.5) — LLM-heavy work shouldn't share workers with I/O.
3. Split webhook ingest when bursts cause head-of-line blocking.
4. Move embedding generation to a beefier box / GPU when local models are the bottleneck.
5. Promote scheduler to its own service when multi-replica `api` makes leader-election necessary.
6. Add MinIO mandatorily when ingesting attachments. Do this *before* outgrowing Postgres for blobs.
7. Add ClickHouse only when building product analytics on run/event history (>10M event rows).

## What's deferred to v2+

| Decision | Trigger to revisit |
|---|---|
| Inngest self-hosted | Need `step.waitForEvent`, multi-day pauses, human-in-the-loop |
| ClickHouse | >10M event rows or analytical queries dominating |
| Dedicated vector engine (Qdrant/Vespa) | >50M chunks or multi-vector-per-doc |
| Graph database | Relational + `parent_id` chains genuinely insufficient |
| Reranking on by default | After v1 dogfooding shows the latency hit is acceptable |
| HRIS/CRM connectors | Customer-driven; first one ships via Nango adapter |
| Schema-per-tenant | Approaching low thousands of tenants |

## The four biggest risks

1. **Better Auth dependency risk.** Young, but on the critical path for auth, API keys, MCP OAuth.
   *Mitigation:* isolate behind `AuthService` interface, pin version, contribute upstream.

2. **Pgvector hits a wall before our search-engine escape hatch is ready.** Extremely large per-tenant indexes (>20M chunks) with low-selectivity ACL filters can degrade.
   *Mitigation:* keep `chunks` and `embeddings` as separate tables. Instrument retrieval p50/p95/p99 from day one. Evaluate ParadeDB before adding a separate engine.

3. **ACL-propagation correctness.** Slack, Drive, Notion, GitHub, Linear, meeting transcripts all model permissions differently. A single missed update can leak data.
   *Mitigation:* ACL sync as a separate observable subsystem. Audit row on every retrieval. Postgres RLS as defense-in-depth. "Permission preview" tooling for admins from week one.

4. **Skill quality and freshness.** Skills synthesized from outdated or contradictory artifacts produce worse-than-useless agent behavior. A wrong refund procedure is worse than no procedure.
   *Mitigation:* skills always start `draft` and require human promotion to `active`. `sourceFingerprint` triggers re-synthesis on source change. Skill execution writes audit trails. Skill versioning so a regression can be rolled back. LLM-as-judge evaluation of skill quality with golden datasets per domain. Workspace admins can mark skill executions as good/bad to feed back into synthesis prompts.

## Decisions log

When a non-trivial architectural decision is made, append it as a short ADR to `docs/decisions/`. Format: `0001-use-drizzle-not-prisma.md`. Keep them short — context, decision, consequences. The decisions in this document are the seed ADRs; new ones go in the folder.
