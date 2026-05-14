---
status: Draft
---
# 0009 — Virtual filesystem over the context layer

Started: 2026-05-14 · Supersedes the flat MCP retrieval surface in [ARCHITECTURE.md](../ARCHITECTURE.md#mcp-server-separate-process) · Builds on [ADR-0002](../decisions/0002-postgres-only-hybrid-search.md), [ADR-0004](../decisions/0004-multi-agent-shared-context-wedge.md)

## Goal

Expose the existing Holo context layer to agents and humans as a **virtual filesystem** — a tree of paths the agent navigates with `ls`, `find`, `grep`, `cat`, and `search`, and that humans can browse in a file-explorer UI in the dashboard.

This is **not** a storage refactor. Postgres + pgvector + tsvector + pg_trgm + RRF (ADR-0002) all stand. The change is the **interface** layered on top: a path-shaped surface in front of the existing hybrid retrieval, plus a UI that renders that same surface for humans.

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

### 2. Reshape the MCP tool surface

Replace the flat list of source-specific getters with five filesystem-shaped tools. All of them resolve to SQL against the same tables:

| Tool | Backed by | Replaces |
|---|---|---|
| `ls(path, limit?, after?)` | `WHERE path LIKE $1 \|\| '%'` grouped by next path segment | `list_recent` |
| `find(path?, filter)` | metadata + path SQL, no embedding | (new) |
| `grep(pattern, path?, limit?)` | `tsvector` match, optional path prefix filter | (new) |
| `search(query, path?, limit?)` | existing RRF hybrid (`retrieval-core/search.ts`), optional path prefix scope | `search` |
| `cat(path, range?)` | `SELECT content FROM chunks WHERE file_id = ? ORDER BY chunk_index` | `fetch_document`, `get_*` getters |

Source-specific getters (`get_slack_thread`, `get_pr`, `get_notion_page`, `get_linear_issue`, `get_meeting`) are **deprecated, not deleted** — they keep working for ≥2 minor versions and resolve through the new layer. Path is the long-term identifier; legacy IDs become a thin lookup.

`who_knows_about` stays — expertise/people search is a different access pattern.

Every tool takes the resolved `organization_id` and `userSubjects[]` from the MCP session; ACL filter `acl_subjects && $user_subjects` appended to every query (unchanged from today). This is non-negotiable per [ARCHITECTURE.md ACLs](../ARCHITECTURE.md#acls-are-non-negotiable).

### 3. File-explorer UI in `apps/web`

A page in the dashboard rendering the same tree the agent sees. Server endpoints:

- `GET /api/files?path=/&limit=200&after=…` — directory listing (powers tree pane)
- `GET /api/files/content?path=/slack/.../thread-123.md` — rendered content (powers detail pane)

Permission model mirrors the MCP path: filter by the **signed-in user's** ACL subjects, not just the org's. A user browsing the explorer sees exactly what they could see through the agent, which is exactly what they can see in the source system. (Defense-in-depth: Postgres RLS at the connection level.)

Useful features that fall out of the tree shape, in priority order:
1. Sync-status badges on folders (last synced, errored, stale).
2. "Open in source" deep link from any file.
3. Drag-into-chat: drops the path string into the conversation; agent already knows how to `cat` it.
4. Search box scoped to current subtree — wraps the same `grep`/`search` tools.

### 4. Migration plan (incremental, no rewrites)

1. **Path computation.** Add `path` column; backfill from existing rows using each chunker's path function. One BullMQ job per source. Idempotent.
2. **Reverse-index lookups.** Source-specific MCP getters (`get_slack_thread(thread_id)`, etc.) start resolving through `path`. No behavior change for existing agents.
3. **New tools.** Ship `ls`, `find`, `grep`, `cat` alongside existing tools. `search` gains an optional `path` scope arg.
4. **UI.** File explorer reads via the same SQL. Independent shipping.
5. **Deprecation.** Mark legacy getters deprecated in MCP tool descriptions. Remove after two minor versions if usage telemetry permits.

Each step is independently shippable and reversible.

## Today vs. proposed (at a glance)

| Dimension | Today | RFC 0009 |
|---|---|---|
| **Agent interface** | Flat menu of ~10 source-specific MCP tools (`search`, `get_slack_thread`, `get_pr`, `get_notion_page`, `get_linear_issue`, `get_meeting`, `fetch_document`, `list_recent`, `who_knows_about`) | Five generic filesystem tools (`ls`, `find`, `grep`, `cat`, `search`) + `who_knows_about` |
| **How agent finds things** | Source-specific ID lookup or single-shot `search` returning top-k | Iterative: `ls` → `grep` → `cat`. Agent picks the right tool per query shape |
| **Identifier** | Per-source IDs (`thread_ts`, `pr_number`, `notion_page_id`) | Stable virtual path (`/slack/#engineering/2026-05-14/thread-123.md`) |
| **Storage** | Postgres + pgvector + tsvector + pg_trgm with RRF | **Unchanged.** ADR-0002 stands |
| **Schema delta** | — | One new column: `files.path` |
| **Hybrid search (RRF)** | Backs the single `search` tool | Backs the `search` tool. `grep` skips embeddings |
| **ACL model** | `acl_subjects && $user_subjects` on every query | **Unchanged.** Applied to every FS tool the same way |
| **New connector cost** | Add a new `get_<source>` MCP tool + chunker | Add a chunker + path convention. **No new MCP tool** |
| **Scaling ceiling** | ~30 MCP tools (Anthropic/Docker guidance) — already at ~10 | Five forever, regardless of connector count |
| **User-facing UI** | Connections + observability. No view of synced data | + File-explorer page over the same SQL substrate |

## Advantages

| Advantage | Why it matters for Holo |
|---|---|
| **Tool surface stays small forever** | Five generic tools regardless of connector count. Today's ~10 → unbounded growth as connectors land is capped. Agents stay below the ~30-tool confusion ceiling. |
| **Iterative retrieval, not single-shot** | Agent can `ls` → `grep` → `cat` and refine. The pattern that beat single-retriever RAG in Anthropic's own Claude Code evals. |
| **Cheaper named-thing queries** | `grep "OAuthScope"` skips the embedding call entirely. Lower latency, lower token cost, exact match. Mintlify reported sharp cost drops from this. |
| **Right tool per query shape** | Keyword → `grep`. Concept ("complaints about pricing") → `search`. Structural ("Sarah's messages last week") → `find`. Agent picks; we don't have to. |
| **Same interface across sources** | Slack, Notion, GitHub, Drive all look like paths. One mental model for the agent — and for the human. |
| **File-explorer UI for free** | Same SQL substrate powers the dashboard tree. Answers "what has Holo synced?" — an enterprise procurement unblock. |
| **Per-user ACL fidelity in UI** | The tree shows exactly what the signed-in user (not just the org) can see. Mirrors source-system permissions. |
| **No storage migration** | ADR-0002 stands. pgvector + tsvector + RRF unchanged. One new column on existing tables. |
| **Trust + transparency** | Customers see what's synced. Support can debug wrong answers by clicking into the file the agent referenced. |
| **Bash is the most-pretrained interface** | LLMs are best at the interface they've seen most. We adopt the one with the most training-data coverage. |
| **Drag-into-chat falls out** | Path string is the handle; agent already knows `cat`. |
| **Lower new-connector cost** | Add a chunker + path convention. No new MCP tool. |
| **Engine-swap optionality** | When pgvector hits its ceiling, swap `search`'s backing engine without changing the agent-facing contract. |
| **Positioning credibility (ADR-0004)** | A shared context layer is more credible when the interface is the one Claude Code / Cursor / Devin already speak. Differentiates from Onyx/Dust/PipesHub's flat APIs. |

## Cons and risks

| Con | Severity | Mitigation |
|---|---|---|
| **`grep` can burn tokens on broad queries** | Medium — real at scale, per Milvus counter-argument | Paginate, cap results, snippet+path before full `cat`, route fuzzy queries to `search` |
| **Path stability across renames** | Medium — Slack channel renames, Notion page moves break paths | Keep stable source IDs alongside paths; `redirects` table for moved files |
| **ACL fidelity in UI is a breach risk** | High if wrong | RLS at DB connection level, per-connector integration tests, audit logging on every list/read |
| **Deprecation overhead** | Low | Legacy getters stay for ≥2 minor versions; usage telemetry gates removal |
| **Path-scheme drift across connectors** | Medium — if every chunker picks its own shape, pattern transfer is lost | Conventions locked in this RFC, not per-chunker |
| **Backfill is a one-time job** | Low | BullMQ job per source, idempotent (paths are deterministic) |
| **`tsvector` is not true BM25** | Low — already accepted in ADR-0002 | ParadeDB `pg_search` swap path documented |
| **Agent might over-`grep` instead of `search`** | Medium — efficiency regression on fuzzy queries | Tool descriptions guide selection; track per-tool query counts as a telemetry signal |
| **Tool-count temptation** | Medium — pressure to add `mv`, `cp`, `chmod` because Unix has them | Holo is read-only over synced data; writes belong with skills (v0.5). Hard line in this RFC |
| **Binary attachments (images, video)** | Low | Path entries point at `blob_url`; `cat` returns metadata + signed URL, no chunk content |
| **Two views of the same data drift** | Medium — file-explorer UI and agent FS must stay in sync | Same SQL functions back both; integration tests assert parity |
| **Open design questions still unresolved** | Low — listed below | Markdown-always for `cat`? Fixed-allowlist `find` filters? Decide before code |
| **No telemetry on which tools agents actually pick** | Low — currently | Add per-tool call counters at MCP boundary on day one of migration |

**Net call:** advantages compound (tool ceiling + UI + cheaper queries + positioning all share one design). Cons are mostly bounded engineering work, not architectural one-way doors. The highest-stakes risk is ACL fidelity in the file explorer — that's the one place where "ship it and iterate" doesn't apply.

## Open questions

- Do we expose `cat` content as markdown always, or preserve source-native rendering for some types (e.g. CSV → table)? Default: markdown, with source-native available via `cat --raw`.
- Should `find` accept arbitrary metadata filters or a fixed allowlist? Allowlist for v1 to keep query shapes auditable.
- Does the file explorer need write affordances (favorite, hide, tag)? Out of scope for v1.
- How do we handle binary attachments inside threads (Slack image, Drive video)? Path entries pointing at `blob_url`, no chunk content; `cat` returns metadata + signed URL.

## Out of scope

- Skill artifacts ([ARCHITECTURE.md](../ARCHITECTURE.md#the-skills-layer)) as files. Skills are MCP-served via `list_skills`/`get_skill`, not filesystem entries. Keep that boundary.
- Write operations into source systems. Read-only surface.
- Replacing the dashboard's Connections / observability views. The file explorer is a peer page, not a replacement.

## See also

- [ADR-0002 — Postgres-only hybrid search](../decisions/0002-postgres-only-hybrid-search.md) — backing index unchanged
- [ADR-0004 — Multi-agent shared-context wedge](../decisions/0004-multi-agent-shared-context-wedge.md) — positioning context
- [ARCHITECTURE.md § MCP server](../ARCHITECTURE.md#mcp-server-separate-process) — current flat tool surface this supersedes
- Mintlify: "How we built a virtual filesystem for our Assistant" — `ChromaFs` reference architecture
- arXiv 2601.11672 — "Files Are All You Need: Unix Philosophy and Agentic AI"
- arXiv 2512.05470 — "Everything is Context: Agentic File System Abstraction"
- Anthropic (Boris Cherny, Latent Space, May 2025) — Claude Code's agentic-search vs early RAG prototypes
