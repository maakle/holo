---
status: Draft
---
# 0009 — Virtual filesystem over the context layer

Started: 2026-05-14 · Supersedes the flat MCP retrieval surface in [ARCHITECTURE.md](../ARCHITECTURE.md#mcp-server-separate-process) · Builds on [ADR-0002](../decisions/0002-postgres-only-hybrid-search.md), [ADR-0004](../decisions/0004-multi-agent-shared-context-wedge.md)

## Goal

Expose the existing Holo context layer to agents and humans as a **virtual filesystem** — a tree of paths the agent navigates with a real bash shell (`ls`, `find`, `grep`, `cat`, pipes, the works), and that humans can browse in a file-explorer UI in the dashboard.

The agent-side implementation is **[just-bash](https://github.com/vercel-labs/just-bash)** (Vercel Labs, Apache-2.0) + a custom `HoloFs` implementing its `IFileSystem` interface against Postgres. This is the same architecture Mintlify ships in production (`ChromaFs`).

This is **not** a storage refactor. Postgres + pgvector + tsvector + pg_trgm + RRF (ADR-0002) all stand. The change is the **interface** layered on top: a single `bash` MCP tool (plus `search` for weak models) in front of the existing hybrid retrieval, plus a UI that renders the same paths for humans.

## Non-goals

- Replacing pgvector / hybrid search / RRF. The vector column stays. ADR-0002 stands.
- Moving to a real filesystem or S3-as-truth. The DB is still the source of truth.
- Removing semantic retrieval. `search` remains an agent tool — just one tool of several, not the only entry point.
- Changing the connector port (ADR-0001) or chunker contracts. Chunkers already produce atomic documents; we add a `path` to them.

## Why now

### The shape problem

The current MCP tool surface ([ARCHITECTURE.md](../ARCHITECTURE.md#mcp-server-separate-process)) is a flat menu: `search`, `fetch_document`, `list_recent`, `get_slack_thread`, `get_pr`, `get_notion_page`, `get_linear_issue`, `get_meeting`, `who_knows_about`. Each new source adds a new getter. We're already at ~10 retrieval tools and Anthropic/Docker both warn agents confuse past ~30. Skills (v0.5) need their own slots. The flat surface doesn't scale.

### The agentic-search shift

The agents Holo's customers actually run — Claude Code, Cursor, Devin, Claude Desktop with MCP — have largely moved away from "single retriever returns top-k" toward iterative shell-like exploration. Anthropic publicly stated (Latent Space, May 2025) that early Claude Code RAG prototypes were beaten by agentic search "by a lot." Mintlify reported the same pattern, putting a virtual FS (`ChromaFs`) in front of their existing Chroma index and getting a 460× startup win plus better answer quality. Recent academic work (arXiv 2601.11672, 2512.05470) frames this as Unix philosophy applied to agent design.

We don't have to abandon hybrid retrieval to capture this. We need to **expose** it through a file-shaped interface.

### The off-the-shelf primitive landed

[Vercel Labs released just-bash](https://github.com/vercel-labs/just-bash) (Apache-2.0) — an in-memory bash interpreter for TypeScript with a pluggable `IFileSystem` interface. It implements ~70 Unix commands (`ls`, `grep`, `find`, `cat`, `awk`, `sed`, `jq`, pipes, redirections) and an AST plugin system for command-level telemetry and allowlisting. Mintlify's `ChromaFs` is a 6-method `IFileSystem` over Chroma; everything else is just-bash. Holo's equivalent is `HoloFs` over Postgres.

Before just-bash, "ship a virtual FS to agents" meant writing a shell parser. Now it's writing six methods.

### Holo-specific pressure

ADR-0004 reframed Holo as the shared context layer multiple custom agents point at. Those agents arrive with their own retrieval strategies. A file-shaped surface lets each agent use the strategy that fits its query — keyword grep for named things, path traversal for known structure, semantic search only when needed — without us prescribing which tool to call when.

The file-explorer UI is a strategic side effect: enterprise procurement keeps stalling on "what exactly has Holo synced?". Today the answer is "trust us." A browsable tree answers it directly.

## Proposal

### 1. Add a deterministic `path` to every artifact

One new column on the existing artifact/document table. Computed by the chunker per source. Deterministic so re-syncs are idempotent.

```
files                                    -- one row per atomic document (already exists, add `path`)
  id, organization_id, path, source, source_id,
  title, mime, size, updated_at, version_hash,
  acl_subjects text[],            -- existing
  blob_url                          -- S3 pointer for large originals
```

Path conventions per source (live in each chunker in `packages/chunker/src/`):

```
/slack/{workspace}/#{channel}/{yyyy-mm-dd}/thread-{ts}.md
/github/{owner}/{repo}/pulls/{number}.md
/github/{owner}/{repo}/issues/{number}.md
/github/{owner}/{repo}/code/{path}
/notion/{workspace}/{breadcrumb...}/{page-title}.md
/gdrive/{drive}/{folder...}/{file}.{ext}.md
/linear/{team}/{number}-{slug}.md
/grain/{yyyy-mm-dd}/{title}-{id}.md
/pylon/tickets/{number}.md
/hubspot/{object-type}/{record-id}.md
```

Existing chunkers already produce the atomic-document framing this needs — Slack thread (not message), GitHub PR (not file), Notion page (not block), meeting transcript (with per-speaker chunks under one parent). Path is the canonical identifier we've been missing.

Indexes: `(organization_id, path)` btree, GIN on `acl_subjects` (already exists), GIN on `tsv`, HNSW on `embedding` — all on rows we already have.

### 2. `HoloFs` — one `IFileSystem` over Postgres

The central engineering artifact. A new package `packages/holofs` implements [just-bash](https://github.com/vercel-labs/just-bash)'s `IFileSystem` interface against the `files` and `chunks` tables. Roughly six methods: `readdir`, `stat`, `readFile`, plus the write methods which all throw `EROFS` (Mintlify's pattern — the surface is read-only over synced data).

```ts
// packages/holofs/src/index.ts (sketch)
export class HoloFs implements IFileSystem {
  constructor(private deps: { db: DB; organizationId: string; userSubjects: string[] }) {}

  async readdir(path: string) {
    // SELECT distinct next-segment FROM files WHERE org = $1
    //   AND acl_subjects && $userSubjects AND path LIKE $path || '%'
  }
  async stat(path: string)    { /* row lookup + ACL filter */ }
  async readFile(path: string) {
    // SELECT content FROM chunks WHERE file_id = ... ORDER BY chunk_index
    // ACL re-check at the chunk level too (defense in depth)
  }
  // writeFile / mkdir / unlink → throw EROFS
}
```

**ACL enforcement lives here, in one place.** Every `readdir` / `stat` / `readFile` re-applies `acl_subjects && $userSubjects`. One implementation, one audit boundary. The same `HoloFs` powers both the MCP `bash` tool and the dashboard file-explorer API — they cannot disagree on what a user can see.

### 3. Reshape the MCP tool surface

Replace the flat list of source-specific getters with **two** tools, plus a deprecated legacy shim layer:

| Tool | Backed by | Replaces |
|---|---|---|
| `bash(script)` | just-bash + `HoloFs`; returns `{stdout, stderr, exitCode}` | `list_recent`, `fetch_document`, all `get_*` getters |
| `search(query, path?, limit?)` | existing RRF hybrid (`retrieval-core/search.ts`), optional path prefix scope | `search` |

The agent gets ~70 Unix commands for free via just-bash: `ls`, `cat`, `grep`, `find`, `head`, `tail`, `wc`, `tree`, `sort`, `uniq`, `awk`, `sed`, `jq`, plus pipes, redirections, globs. A query like "find the 20 most recent Slack threads in #engineering mentioning Acme" becomes one bash invocation, not five tool round-trips.

**`search` stays as a separate MCP tool** for two reasons:
1. Weak models (Haiku-class, open-source 7B–13B) generate sloppy bash. They can still call `search` directly and get a useful answer.
2. Hybrid RRF is a SQL primitive, not a Unix one. Wrapping it as a virtual `/search/{query}` path is possible but semantically forced; a dedicated tool is cleaner.

Source-specific getters (`get_slack_thread`, `get_pr`, `get_notion_page`, `get_linear_issue`, `get_meeting`, `fetch_document`, `list_recent`) are **deprecated, not deleted** — they keep working for ≥2 minor versions and internally resolve through `HoloFs` (e.g. `get_slack_thread(thread_id)` looks up the path then `readFile`s it). Path is the long-term identifier; legacy IDs become a thin lookup.

`who_knows_about` stays — expertise/people search is a different access pattern.

ACL filtering is enforced inside `HoloFs` (see §2). Both `bash` and `search` receive `organizationId` and `userSubjects[]` from the resolved MCP session. This is non-negotiable per [ARCHITECTURE.md ACLs](../ARCHITECTURE.md#acls-are-non-negotiable).

**Sandboxing.** just-bash runs entirely in-memory in the Node process — no real shell, no subprocess escape. Its AST plugin system lets us:
- Allowlist commands (refuse `curl`, `python`, anything not in our supported set).
- Cap execution time and output bytes per invocation.
- Capture per-command telemetry (`grep` vs `find` vs `cat` call counts) without parsing scripts ourselves.

### 4. File-explorer UI in `apps/web`

A page in the dashboard rendering the same tree the agent sees. Server endpoints call into `HoloFs` directly — the UI and the agent literally share an implementation, so they cannot disagree on what a user can see:

- `GET /api/files?path=/&limit=200&after=…` → `holoFs.readdir(path)`
- `GET /api/files/content?path=/slack/.../thread-123.md` → `holoFs.readFile(path)`

Permission model mirrors the MCP path: filter by the **signed-in user's** ACL subjects, not just the org's. A user browsing the explorer sees exactly what they could see through the agent, which is exactly what they can see in the source system. (Defense-in-depth: Postgres RLS at the connection level.)

Useful features that fall out of the tree shape, in priority order:
1. Sync-status badges on folders (last synced, errored, stale).
2. "Open in source" deep link from any file.
3. Drag-into-chat: drops the path string into the conversation; agent already knows how to `cat` it.
4. Search box scoped to current subtree — fires `bash("grep -r ... $subtree")` (or `search` with a path scope).

### 5. Migration plan (incremental, no rewrites)

1. **Path computation.** Add `path` column to `files`; backfill from existing rows using each chunker's path function. One BullMQ job per source. Idempotent.
2. **`HoloFs` package.** Build `packages/holofs` against just-bash's `IFileSystem` interface. Unit-test ACL enforcement exhaustively against a synthetic multi-tenant fixture before any tool ships.
3. **Reverse-index lookups.** Source-specific MCP getters (`get_slack_thread(thread_id)`, etc.) start resolving via `HoloFs.readFile(path)` internally. No behavior change for existing agents.
4. **`bash` MCP tool.** Ship the `bash` tool wrapping just-bash + `HoloFs`. Start with a conservative command allowlist and execution cap; expand on telemetry. `search` gains optional `path` scope.
5. **UI.** File explorer in `apps/web` reads via `HoloFs` directly. Independent shipping.
6. **Deprecation.** Mark legacy getters deprecated in MCP tool descriptions. Remove after two minor versions if usage telemetry permits.

Each step is independently shippable and reversible. Steps 2–4 are where ACL hardening must land before any external customer points an agent at the new tool.

## Today vs. proposed (at a glance)

| Dimension | Today | RFC 0009 |
|---|---|---|
| **Agent interface** | Flat menu of ~10 source-specific MCP tools | **2** MCP tools: `bash` (just-bash + `HoloFs`) + `search` |
| **Commands available to the agent** | ~10 tool slots | ~70 Unix commands inside `bash` (`ls`, `grep`, `find`, `cat`, `awk`, `sed`, `jq`, `head`, `wc`, …) plus pipes and composition |
| **How agent finds things** | Source-specific ID lookup or single-shot `search` returning top-k | Iterative shell: `grep -rl Acme /slack \| head -20`. Agent picks the right command per query shape |
| **Identifier** | Per-source IDs (`thread_ts`, `pr_number`, `notion_page_id`) | Stable virtual path (`/slack/#engineering/2026-05-14/thread-123.md`) |
| **Storage** | Postgres + pgvector + tsvector + pg_trgm with RRF | **Unchanged.** ADR-0002 stands |
| **Schema delta** | — | One new column: `files.path` |
| **Hybrid search (RRF)** | Backs the single `search` tool | Backs the `search` tool. `grep` skips embeddings entirely |
| **ACL enforcement points** | Every retrieval handler appends its own `WHERE` clause | **One** — inside `HoloFs.readdir`/`stat`/`readFile`. Agent and UI share it |
| **Sandbox** | N/A (no shell) | just-bash in-memory, AST-plugin command allowlist, exec-time + output caps |
| **New connector cost** | Add a `get_<source>` MCP tool + chunker | Add a chunker + path convention. **No new MCP tool** |
| **Scaling ceiling** | ~30 MCP tools (Anthropic/Docker guidance) — already at ~10 | 2 forever, regardless of connector count |
| **User-facing UI** | Connections + observability. No view of synced data | + File-explorer page reading via the same `HoloFs` |

## Advantages

| Advantage | Why it matters for Holo |
|---|---|
| **Tool surface collapses to 2** | `bash` + `search`. Regardless of connector count. Today's ~10 → unbounded growth as connectors land is capped. Agents stay well below the ~30-tool confusion ceiling. |
| **70+ Unix commands for free** | just-bash ships `ls`, `grep`, `find`, `cat`, `awk`, `sed`, `jq`, `head`, `wc`, `sort`, `uniq`, pipes, redirections, globs. We implement zero of these. |
| **Iterative retrieval, not single-shot** | `grep -r ... \| head -20` composes in one bash call. The pattern that beat single-retriever RAG in Anthropic's own Claude Code evals. |
| **Cheaper named-thing queries** | `grep "OAuthScope"` skips the embedding call entirely. Lower latency, lower token cost, exact match. Mintlify reported sharp cost drops from this. |
| **Right tool per query shape** | Keyword → `grep`. Concept → `search`. Structural → `find`. Agent picks; we don't have to. |
| **One enforcement point for ACLs** | All access goes through `HoloFs`. One audit boundary. UI and agent literally share the implementation; they cannot diverge. |
| **Same interface across sources** | Slack, Notion, GitHub, Drive all look like paths. One mental model for agent and human. |
| **File-explorer UI calls into `HoloFs` directly** | Not a parallel re-implementation. Answers "what has Holo synced?" — enterprise procurement unblock. |
| **Per-user ACL fidelity in UI** | Tree shows exactly what the signed-in user (not just the org) can see. |
| **No storage migration** | ADR-0002 stands. pgvector + tsvector + RRF unchanged. One new column. |
| **Trust + transparency** | Customers see what's synced. Support can debug wrong answers by clicking into the file the agent referenced. |
| **Bash is the most-pretrained interface** | LLMs are best at the interface they've seen most. We adopt the one with the most training-data coverage. |
| **Telemetry on day one** | just-bash AST plugins give per-command counters without parsing scripts ourselves. Closes one of the gaps flagged in the v0.0 telemetry-blindness risk. |
| **Read-only by construction** | `HoloFs` write methods throw `EROFS`. Mintlify's pattern. The surface cannot mutate synced data. |
| **Drag-into-chat falls out** | Path string is the handle; agent already knows `cat`. |
| **Lower new-connector cost** | Add a chunker + path convention. No new MCP tool. |
| **Engine-swap optionality** | When pgvector hits its ceiling, swap `search`'s backing engine without touching `bash` / `HoloFs` / the agent contract. |
| **Apache-2.0 dependency** | just-bash license is compatible with Holo's AGPL-3.0 (Community) + commercial (Enterprise) split. |
| **Positioning credibility (ADR-0004)** | "Bash for your synced context, with the ACLs you already have" is a sharper pitch than "MCP server with retrieval tools." Differentiates from Onyx/Dust/PipesHub's flat APIs. |

## Cons and risks

| Con | Severity | Mitigation |
|---|---|---|
| **`bash` is a large single tool surface** — agent can issue arbitrary scripts | High | just-bash AST plugin allowlists commands; reject unknown binaries; cap execution time + output bytes per invocation. Mintlify ships this pattern in production. |
| **ACL fidelity inside `HoloFs` is a breach risk** | High | One implementation, exhaustively tested. ACL check on every `readdir`/`stat`/`readFile`, re-checked at the chunk level. RLS at DB connection level as defense in depth. Audit logging on every read. |
| **Weak models may generate sloppy bash** | Medium | `search` stays as a separate MCP tool so weak/cheap models have a one-shot path. |
| **Agent might over-use `grep` and burn tokens** | Medium — Milvus counter-argument is real at scale | Output caps inside just-bash, paginate, `grep -l` (file list) before `grep -n` (lines), tool descriptions steer fuzzy queries to `search`. |
| **just-bash is young** | Medium — Vercel Labs project, not 1.0 | Apache-2.0; we can vendor and patch if needed. Pin a specific version. Reassess at v0.x → v1.0 transition. |
| **Path stability across renames** | Medium — Slack channel renames, Notion page moves break paths | Keep stable source IDs alongside paths; `redirects` table for moved files. |
| **Path-scheme drift across connectors** | Medium | Conventions locked in this RFC, not per-chunker. |
| **Telemetry on free-form bash is harder to roll up than fixed-arg tools** | Low | AST plugin gives per-command counters, which is the rollup we actually want. |
| **Pipe to a missing binary fails confusingly** | Low | Allowlist + clear error messages; document the supported command set in tool description. |
| **Deprecation overhead for legacy getters** | Low | Stay ≥2 minor versions; usage telemetry gates removal. |
| **Backfill is a one-time job** | Low | BullMQ job per source, idempotent (paths are deterministic). |
| **`tsvector` is not true BM25** | Low — already accepted in ADR-0002 | ParadeDB `pg_search` swap path documented. |
| **Tool-count temptation inside bash** (people add write commands later) | Medium | `HoloFs` write methods throw `EROFS`. Hard line — writes belong with skills (v0.5), not retrieval. |
| **Binary attachments (images, video)** | Low | Path entries point at `blob_url`; `cat` returns metadata + signed URL. |
| **Open design questions still unresolved** | Low — listed below | Decide before code. |

**Net call:** the just-bash + `HoloFs` shape is *more* defensible than the original five-tool plan, not less — fewer enforcement points (one), more agent capability (70+ commands), production-proven by Mintlify. The high-severity risks (large bash surface, ACL fidelity) both reduce to "test `HoloFs` exhaustively before exposing `bash` externally," which is bounded engineering work, not an architectural one-way door.

## Open questions

- **just-bash command allowlist for v1.** Minimum useful set is probably `ls`, `cat`, `grep`, `find`, `head`, `tail`, `wc`, `sort`, `uniq`, `tree`, plus pipes. Do we ship `awk` / `sed` / `jq` in v1 or wait for demand?
- **Execution caps.** Wall-clock per `bash` call, max output bytes, max files touched. Need concrete numbers before launch — propose 5s wall-clock, 256 KB output, soft cap 1000 files traversed (configurable per workspace).
- **`cat` rendering.** Markdown always, or preserve source-native for some types (CSV → table, JSON pretty-printed)? Default: markdown for chunks, `cat --raw` for the source blob.
- **Binary attachments.** Path entries point at `blob_url`; `cat` returns metadata + signed URL. Do we let `bash` follow those URLs? Default no — agent calls a separate `fetch_blob` tool if needed.
- **`search` as a virtual path?** Could expose RRF as `/search/{query}` so it works inside bash pipes. Cleaner conceptually but adds a path schema overload. Default: keep `search` as a separate MCP tool for now; revisit once we have usage data.
- **Vendor or depend on just-bash?** Apache-2.0 allows either. Default: npm dependency, pinned. Vendor only if we need to patch upstream.

## Out of scope

- Skill artifacts ([ARCHITECTURE.md](../ARCHITECTURE.md#the-skills-layer)) as files. Skills are MCP-served via `list_skills`/`get_skill`, not filesystem entries. Keep that boundary.
- Write operations into source systems. Read-only surface.
- Replacing the dashboard's Connections / observability views. The file explorer is a peer page, not a replacement.

## See also

- [ADR-0002 — Postgres-only hybrid search](../decisions/0002-postgres-only-hybrid-search.md) — backing index unchanged
- [ADR-0004 — Multi-agent shared-context wedge](../decisions/0004-multi-agent-shared-context-wedge.md) — positioning context
- [ARCHITECTURE.md § MCP server](../ARCHITECTURE.md#mcp-server-separate-process) — current flat tool surface this supersedes
- [vercel-labs/just-bash](https://github.com/vercel-labs/just-bash) — Apache-2.0; provides the `IFileSystem` interface `HoloFs` implements
- [vercel-labs/bash-tool](https://github.com/vercel-labs/bash-tool) — companion package wrapping just-bash as an AI SDK tool
- Mintlify: "How we built a virtual filesystem for our Assistant" — `ChromaFs` is the same `just-bash + IFileSystem` pattern this RFC adopts
- Malte Ubl on X — confirms Mintlify assistant runs on just-bash + custom FS
- arXiv 2601.11672 — "Files Are All You Need: Unix Philosophy and Agentic AI"
- arXiv 2512.05470 — "Everything is Context: Agentic File System Abstraction"
- Anthropic (Boris Cherny, Latent Space, May 2025) — Claude Code's agentic-search vs early RAG prototypes
