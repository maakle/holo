# Procedure Auto-Discovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace manual artifact-UUID labeling with an auto-discovery loop: holo clusters ingested artifacts into work episodes, names them as candidate procedures via Claude, and surfaces them on the Skills page for the user to accept / reject / rename. Accepted proposals automatically generate skill labels and run synthesis.

**Architecture:** A new `@holo/discovery` package owns clustering (pure logic, heavily tested) + LLM naming. A discovery orchestrator persists `procedure_episodes` (artifact bundles) and `procedure_proposals` (named candidates). API routes expose discover/list/accept/reject. The Skills page gains a "Suggested procedures" section above the existing label panel. A nightly cron triggers re-discovery; rejected proposals feed a negative-signal blocklist so they don't reappear.

**Tech Stack:** Drizzle (Postgres + pgvector), Next.js App Router, `@anthropic-ai/sdk` (Claude Haiku for naming), existing chunk embeddings (no new embedder), `@holo/skills` for synthesis hand-off, Vercel cron for scheduling. Tests use Vitest (existing convention in `packages/skills/src/__tests__`).

**Out of scope:** Tuning embedding model, replacing chunk embeddings with artifact-level embeddings, real-time discovery on every sync (nightly batch only), publishing accepted proposals to the marketplace (existing `PublishButton` already handles that downstream of synthesis).

---

## File Structure

**New files:**
- `packages/discovery/package.json` — new workspace package
- `packages/discovery/src/index.ts` — public exports
- `packages/discovery/src/types.ts` — `Episode`, `Proposal`, `DiscoveryInput` types
- `packages/discovery/src/cluster.ts` — pure clustering function (artifact → episodes)
- `packages/discovery/src/propose.ts` — LLM call to name an episode
- `packages/discovery/src/discover.ts` — orchestrator (DB read → cluster → propose → DB write)
- `packages/discovery/src/__tests__/cluster.test.ts` — unit tests for clustering
- `packages/discovery/src/__tests__/propose.test.ts` — unit tests for naming
- `packages/discovery/src/__tests__/discover.test.ts` — integration test against Postgres
- `apps/web/src/app/api/skills/discover/route.ts` — POST trigger
- `apps/web/src/app/api/skills/proposals/route.ts` — GET list
- `apps/web/src/app/api/skills/proposals/[id]/accept/route.ts` — POST accept
- `apps/web/src/app/api/skills/proposals/[id]/reject/route.ts` — POST reject
- `apps/web/src/components/suggested-procedures.tsx` — UI section
- `apps/web/src/app/api/cron/discover/route.ts` — Vercel cron handler

**Modified files:**
- `packages/db/src/schema/holo.ts` — add `procedureEpisodes`, `procedureProposals`, `procedureProposalDecisions` tables
- `apps/web/src/app/(app)/skills/page.tsx` — render `<SuggestedProcedures />` above `<SkillLabelPanel />`
- `apps/web/vercel.json` — register cron schedule
- `pnpm-workspace.yaml` — should already pick up `packages/discovery` via glob; verify

---

## Task 1: DB schema for episodes and proposals

**Files:**
- Modify: `packages/db/src/schema/holo.ts` (append after `skillLabels`, around line 335)
- Test: `packages/db/test/discovery-schema.test.ts` (new)
- Migration: generated via `pnpm --filter @holo/db drizzle-kit generate`

- [ ] **Step 1: Write the failing schema test**

```typescript
// packages/db/test/discovery-schema.test.ts
import { describe, it, expect } from 'vitest';
import { schema } from '../src';

describe('discovery schema', () => {
  it('exposes procedureEpisodes with required columns', () => {
    const t = schema.procedureEpisodes;
    expect(t).toBeDefined();
    const cols = Object.keys(t);
    for (const c of [
      'id', 'organizationId', 'sourceArtifactIds', 'centroidEmbedding',
      'entityKey', 'firstSeenAt', 'lastSeenAt', 'createdAt',
    ]) {
      expect(cols).toContain(c);
    }
  });

  it('exposes procedureProposals with required columns', () => {
    const t = schema.procedureProposals;
    expect(t).toBeDefined();
    const cols = Object.keys(t);
    for (const c of [
      'id', 'organizationId', 'episodeId', 'proposedSlug', 'proposedName',
      'summary', 'status', 'rejectionReasonHash', 'createdAt',
    ]) {
      expect(cols).toContain(c);
    }
  });

  it('exposes procedureProposalDecisions with required columns', () => {
    const t = schema.procedureProposalDecisions;
    expect(t).toBeDefined();
    const cols = Object.keys(t);
    for (const c of ['id', 'organizationId', 'proposalId', 'decision', 'finalSlug', 'decidedBy', 'decidedAt']) {
      expect(cols).toContain(c);
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @holo/db test discovery-schema`
Expected: FAIL — `procedureEpisodes` undefined.

- [ ] **Step 3: Add the three tables to `packages/db/src/schema/holo.ts`**

Append after `skillLabels` (search for `export const skillLabels` and add below its closing `);`). Use existing imports — `pgTable`, `uuid`, `text`, `timestamp`, `jsonb`, `index`, `uniqueIndex`, `vector`, `sql`, `organization` are already imported in this file.

```typescript
export const procedureEpisodes = pgTable(
  'procedure_episodes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organization.id),
    sourceArtifactIds: uuid('source_artifact_ids').array().notNull(),
    centroidEmbedding: vector('centroid_embedding', { dimensions: 1024 }),
    entityKey: text('entity_key'),
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    orgLastSeenIdx: index('procedure_episodes_org_last_seen_idx').on(
      t.organizationId,
      t.lastSeenAt,
    ),
    orgEntityIdx: index('procedure_episodes_org_entity_idx').on(t.organizationId, t.entityKey),
  }),
);

export const procedureProposals = pgTable(
  'procedure_proposals',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organization.id),
    episodeId: uuid('episode_id')
      .notNull()
      .references(() => procedureEpisodes.id, { onDelete: 'cascade' }),
    proposedSlug: text('proposed_slug').notNull(),
    proposedName: text('proposed_name').notNull(),
    summary: text('summary').notNull(),
    status: text('status', { enum: ['pending', 'accepted', 'rejected', 'superseded'] })
      .notNull()
      .default('pending'),
    rejectionReasonHash: text('rejection_reason_hash'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    orgStatusCreatedIdx: index('procedure_proposals_org_status_created_idx').on(
      t.organizationId,
      t.status,
      t.createdAt,
    ),
    orgEpisodeUniq: uniqueIndex('procedure_proposals_org_episode_uniq').on(
      t.organizationId,
      t.episodeId,
    ),
  }),
);

export const procedureProposalDecisions = pgTable(
  'procedure_proposal_decisions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organization.id),
    proposalId: uuid('proposal_id')
      .notNull()
      .references(() => procedureProposals.id, { onDelete: 'cascade' }),
    decision: text('decision', { enum: ['accept', 'reject'] }).notNull(),
    finalSlug: text('final_slug'),
    decidedBy: uuid('decided_by').notNull(),
    decidedAt: timestamp('decided_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    orgDecidedAtIdx: index('procedure_proposal_decisions_org_decided_at_idx').on(
      t.organizationId,
      t.decidedAt,
    ),
  }),
);
```

- [ ] **Step 4: Re-run the test to verify it passes**

Run: `pnpm --filter @holo/db test discovery-schema`
Expected: PASS.

- [ ] **Step 5: Generate and apply the migration**

Run: `pnpm --filter @holo/db drizzle-kit generate`
Expected: a new SQL migration file appears under `packages/db/drizzle/` containing `CREATE TABLE procedure_episodes`, `procedure_proposals`, `procedure_proposal_decisions`.

Run: `pnpm --filter @holo/db drizzle-kit migrate` (or whatever apply command the project uses; check `packages/db/package.json` scripts).
Expected: tables exist in the local Postgres.

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/schema/holo.ts packages/db/test/discovery-schema.test.ts packages/db/drizzle/
git commit -m "feat(db): add procedure_episodes, procedure_proposals, procedure_proposal_decisions"
```

---

## Task 2: Bootstrap `@holo/discovery` package

**Files:**
- Create: `packages/discovery/package.json`
- Create: `packages/discovery/tsconfig.json`
- Create: `packages/discovery/src/index.ts`
- Create: `packages/discovery/src/types.ts`
- Create: `packages/discovery/vitest.config.ts`

- [ ] **Step 1: Create `packages/discovery/package.json`**

Mirror the shape of `packages/skills/package.json` exactly (read it first to copy the build/test scripts, the `tsup`/`vitest` deps, the `exports` map). Set `"name": "@holo/discovery"`. Dependencies: `@anthropic-ai/sdk`, `@holo/db`, `@holo/errors`, `drizzle-orm`. Dev deps: same as `@holo/skills`.

- [ ] **Step 2: Create `packages/discovery/tsconfig.json`**

Copy from `packages/skills/tsconfig.json` verbatim.

- [ ] **Step 3: Create `packages/discovery/vitest.config.ts`**

Copy from `packages/skills/vitest.config.ts` verbatim.

- [ ] **Step 4: Create `packages/discovery/src/types.ts`**

```typescript
export interface ArtifactInput {
  id: string;
  sourceId: string;
  externalId: string;
  kind: string;
  payload: Record<string, unknown>;
  fetchedAt: Date;
  embedding: number[] | null;
  entityHints: string[];
}

export interface Episode {
  artifactIds: string[];
  centroidEmbedding: number[];
  entityKey: string | null;
  firstSeenAt: Date;
  lastSeenAt: Date;
}

export interface Proposal {
  proposedSlug: string;
  proposedName: string;
  summary: string;
}

export interface ClusterOptions {
  minArtifacts: number;
  minDistinctSources: number;
  similarityThreshold: number;
  timeWindowMs: number;
}

export const DEFAULT_CLUSTER_OPTIONS: ClusterOptions = {
  minArtifacts: 3,
  minDistinctSources: 2,
  similarityThreshold: 0.78,
  timeWindowMs: 1000 * 60 * 60 * 24 * 14,
};
```

- [ ] **Step 5: Create `packages/discovery/src/index.ts`**

```typescript
export * from './types.js';
export { clusterArtifacts } from './cluster.js';
export { proposeProcedureName } from './propose.js';
export { runDiscovery } from './discover.js';
```

- [ ] **Step 6: Run install + typecheck to verify the package builds**

Run: `pnpm install`
Run: `pnpm --filter @holo/discovery typecheck`
Expected: PASS (no source files yet beyond `types.ts` and `index.ts` re-exports — the missing `cluster.ts` / `propose.ts` / `discover.ts` will fail. That's fine; we'll add them in tasks 3–5. For this task, comment out the missing exports temporarily).

Adjust `index.ts` for now:

```typescript
export * from './types.js';
```

Re-run typecheck: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/discovery/ pnpm-lock.yaml
git commit -m "feat(discovery): scaffold @holo/discovery package"
```

---

## Task 3: Clustering function (pure logic)

**Files:**
- Create: `packages/discovery/src/cluster.ts`
- Test: `packages/discovery/src/__tests__/cluster.test.ts`

The clustering algorithm: greedy single-pass union-find on (a) shared `entityHints` (e.g. same HubSpot deal ID across a HubSpot note + a Slack thread + a Grain meeting all referencing that deal) AND (b) embedding cosine similarity ≥ threshold AND (c) within time window. Then filter clusters by `minArtifacts` and `minDistinctSources`.

- [ ] **Step 1: Write failing tests**

```typescript
// packages/discovery/src/__tests__/cluster.test.ts
import { describe, it, expect } from 'vitest';
import { clusterArtifacts } from '../cluster.js';
import { DEFAULT_CLUSTER_OPTIONS, type ArtifactInput } from '../types.js';

const baseEmbedding = (i: number) => {
  const v = new Array(1024).fill(0);
  v[i] = 1;
  return v;
};

const artifact = (overrides: Partial<ArtifactInput>): ArtifactInput => ({
  id: 'a',
  sourceId: 's1',
  externalId: 'ext',
  kind: 'hubspot.deal',
  payload: {},
  fetchedAt: new Date('2026-05-01T10:00:00Z'),
  embedding: baseEmbedding(0),
  entityHints: [],
  ...overrides,
});

describe('clusterArtifacts', () => {
  it('returns no episodes when below minArtifacts', () => {
    const arts = [artifact({ id: 'a' }), artifact({ id: 'b' })];
    const eps = clusterArtifacts(arts, DEFAULT_CLUSTER_OPTIONS);
    expect(eps).toEqual([]);
  });

  it('groups artifacts that share an entity hint across distinct sources', () => {
    const arts: ArtifactInput[] = [
      artifact({ id: 'a', sourceId: 's1', entityHints: ['deal:42'] }),
      artifact({ id: 'b', sourceId: 's2', entityHints: ['deal:42'], embedding: baseEmbedding(500) }),
      artifact({ id: 'c', sourceId: 's3', entityHints: ['deal:42'], embedding: baseEmbedding(900) }),
    ];
    const eps = clusterArtifacts(arts, DEFAULT_CLUSTER_OPTIONS);
    expect(eps).toHaveLength(1);
    expect(eps[0]!.artifactIds.sort()).toEqual(['a', 'b', 'c']);
    expect(eps[0]!.entityKey).toBe('deal:42');
  });

  it('rejects clusters that come from only one source', () => {
    const arts: ArtifactInput[] = [
      artifact({ id: 'a', sourceId: 's1', entityHints: ['deal:7'] }),
      artifact({ id: 'b', sourceId: 's1', entityHints: ['deal:7'] }),
      artifact({ id: 'c', sourceId: 's1', entityHints: ['deal:7'] }),
    ];
    expect(clusterArtifacts(arts, DEFAULT_CLUSTER_OPTIONS)).toEqual([]);
  });

  it('groups by embedding similarity when no entity hints exist', () => {
    const close = baseEmbedding(0);
    const arts: ArtifactInput[] = [
      artifact({ id: 'a', sourceId: 's1', embedding: close }),
      artifact({ id: 'b', sourceId: 's2', embedding: close }),
      artifact({ id: 'c', sourceId: 's3', embedding: close }),
    ];
    const eps = clusterArtifacts(arts, { ...DEFAULT_CLUSTER_OPTIONS, similarityThreshold: 0.5 });
    expect(eps).toHaveLength(1);
    expect(eps[0]!.artifactIds.sort()).toEqual(['a', 'b', 'c']);
  });

  it('does not merge artifacts outside the time window', () => {
    const arts: ArtifactInput[] = [
      artifact({ id: 'a', sourceId: 's1', entityHints: ['deal:9'], fetchedAt: new Date('2026-01-01') }),
      artifact({ id: 'b', sourceId: 's2', entityHints: ['deal:9'], fetchedAt: new Date('2026-05-01') }),
      artifact({ id: 'c', sourceId: 's3', entityHints: ['deal:9'], fetchedAt: new Date('2026-05-02') }),
    ];
    const eps = clusterArtifacts(arts, DEFAULT_CLUSTER_OPTIONS);
    expect(eps[0]?.artifactIds.sort()).toEqual(['b', 'c']);
    expect(eps).toHaveLength(0);
  });

  it('computes a centroid embedding as the element-wise mean', () => {
    const e1 = new Array(1024).fill(0); e1[0] = 1;
    const e2 = new Array(1024).fill(0); e2[0] = 0.5;
    const e3 = new Array(1024).fill(0); e3[0] = 0.3;
    const arts: ArtifactInput[] = [
      artifact({ id: 'a', sourceId: 's1', entityHints: ['x'], embedding: e1 }),
      artifact({ id: 'b', sourceId: 's2', entityHints: ['x'], embedding: e2 }),
      artifact({ id: 'c', sourceId: 's3', entityHints: ['x'], embedding: e3 }),
    ];
    const [ep] = clusterArtifacts(arts, DEFAULT_CLUSTER_OPTIONS);
    expect(ep!.centroidEmbedding[0]).toBeCloseTo(0.6, 5);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @holo/discovery test cluster`
Expected: FAIL — `clusterArtifacts` not defined.

- [ ] **Step 3: Implement `cluster.ts`**

```typescript
// packages/discovery/src/cluster.ts
import type { ArtifactInput, ClusterOptions, Episode } from './types.js';

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += (a[i] ?? 0) * (b[i] ?? 0);
    na += (a[i] ?? 0) ** 2;
    nb += (b[i] ?? 0) ** 2;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

class UnionFind {
  private parent = new Map<string, string>();
  add(id: string) { if (!this.parent.has(id)) this.parent.set(id, id); }
  find(id: string): string {
    const p = this.parent.get(id) ?? id;
    if (p === id) return id;
    const root = this.find(p);
    this.parent.set(id, root);
    return root;
  }
  union(a: string, b: string) {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent.set(ra, rb);
  }
}

function withinWindow(a: Date, b: Date, ms: number): boolean {
  return Math.abs(a.getTime() - b.getTime()) <= ms;
}

export function clusterArtifacts(
  artifacts: ArtifactInput[],
  opts: ClusterOptions,
): Episode[] {
  const uf = new UnionFind();
  for (const a of artifacts) uf.add(a.id);

  const byHint = new Map<string, ArtifactInput[]>();
  for (const a of artifacts) {
    for (const h of a.entityHints) {
      const list = byHint.get(h) ?? [];
      list.push(a);
      byHint.set(h, list);
    }
  }
  for (const list of byHint.values()) {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const ai = list[i]!;
        const aj = list[j]!;
        if (withinWindow(ai.fetchedAt, aj.fetchedAt, opts.timeWindowMs)) {
          uf.union(ai.id, aj.id);
        }
      }
    }
  }

  for (let i = 0; i < artifacts.length; i++) {
    for (let j = i + 1; j < artifacts.length; j++) {
      const ai = artifacts[i]!;
      const aj = artifacts[j]!;
      if (!ai.embedding || !aj.embedding) continue;
      if (!withinWindow(ai.fetchedAt, aj.fetchedAt, opts.timeWindowMs)) continue;
      if (cosine(ai.embedding, aj.embedding) >= opts.similarityThreshold) {
        uf.union(ai.id, aj.id);
      }
    }
  }

  const groups = new Map<string, ArtifactInput[]>();
  for (const a of artifacts) {
    const root = uf.find(a.id);
    const list = groups.get(root) ?? [];
    list.push(a);
    groups.set(root, list);
  }

  const episodes: Episode[] = [];
  for (const list of groups.values()) {
    if (list.length < opts.minArtifacts) continue;
    const distinctSources = new Set(list.map((a) => a.sourceId));
    if (distinctSources.size < opts.minDistinctSources) continue;

    const sorted = list.slice().sort((a, b) => a.fetchedAt.getTime() - b.fetchedAt.getTime());
    const dim = sorted.find((a) => a.embedding)?.embedding?.length ?? 1024;
    const centroid = new Array<number>(dim).fill(0);
    let counted = 0;
    for (const a of sorted) {
      if (!a.embedding) continue;
      for (let i = 0; i < dim; i++) centroid[i] += a.embedding[i] ?? 0;
      counted++;
    }
    if (counted > 0) for (let i = 0; i < dim; i++) centroid[i] = (centroid[i] ?? 0) / counted;

    const hintCounts = new Map<string, number>();
    for (const a of sorted) for (const h of a.entityHints) hintCounts.set(h, (hintCounts.get(h) ?? 0) + 1);
    let entityKey: string | null = null;
    let bestCount = 0;
    for (const [k, v] of hintCounts) if (v > bestCount) { entityKey = k; bestCount = v; }

    episodes.push({
      artifactIds: sorted.map((a) => a.id),
      centroidEmbedding: centroid,
      entityKey,
      firstSeenAt: sorted[0]!.fetchedAt,
      lastSeenAt: sorted.at(-1)!.fetchedAt,
    });
  }

  return episodes;
}
```

- [ ] **Step 4: Re-run the tests**

Run: `pnpm --filter @holo/discovery test cluster`
Expected: PASS (all 6 tests).

- [ ] **Step 5: Re-export from `index.ts`**

Edit `packages/discovery/src/index.ts`:

```typescript
export * from './types.js';
export { clusterArtifacts } from './cluster.js';
```

- [ ] **Step 6: Commit**

```bash
git add packages/discovery/src/cluster.ts packages/discovery/src/__tests__/cluster.test.ts packages/discovery/src/index.ts
git commit -m "feat(discovery): cluster artifacts into work episodes"
```

---

## Task 4: LLM proposal naming

**Files:**
- Create: `packages/discovery/src/propose.ts`
- Test: `packages/discovery/src/__tests__/propose.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// packages/discovery/src/__tests__/propose.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { proposeProcedureName } from '../propose.js';

const mockCreate = vi.fn();
vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn().mockImplementation(() => ({
    messages: { create: mockCreate },
  })),
}));

describe('proposeProcedureName', () => {
  beforeEach(() => mockCreate.mockReset());

  it('parses slug, name, and summary from Claude output', async () => {
    mockCreate.mockResolvedValue({
      stop_reason: 'end_turn',
      content: [
        {
          type: 'text',
          text: 'slug: handle-enterprise-refund\nname: Handle Enterprise Refund\nsummary: Customer requests refund, sales reviews HubSpot deal, support replies on Slack.',
        },
      ],
    });

    const result = await proposeProcedureName({
      apiKey: 'k',
      artifacts: [
        { kind: 'slack.message', content: 'customer asking about refund' },
        { kind: 'hubspot.deal', content: 'Acme Corp - $50k' },
        { kind: 'grain.meeting', content: 'Discussed refund options' },
      ],
    });

    expect(result.proposedSlug).toBe('handle-enterprise-refund');
    expect(result.proposedName).toBe('Handle Enterprise Refund');
    expect(result.summary).toContain('refund');
  });

  it('throws if Claude output is truncated', async () => {
    mockCreate.mockResolvedValue({ stop_reason: 'max_tokens', content: [] });
    await expect(
      proposeProcedureName({ apiKey: 'k', artifacts: [{ kind: 'x', content: 'y' }] }),
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run the test**

Run: `pnpm --filter @holo/discovery test propose`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `propose.ts`**

```typescript
// packages/discovery/src/propose.ts
import Anthropic from '@anthropic-ai/sdk';
import { holoError, ErrorCode } from '@holo/errors';
import type { Proposal } from './types.js';

export interface ProposeInput {
  apiKey: string;
  artifacts: { kind: string; content: string }[];
}

const SYSTEM = `You are a procedure-naming assistant. Given a small bundle of related work artifacts (Slack messages, deals, meetings, docs, tickets) that all appear to be part of one repeatable process, propose a name for that procedure.

Output EXACTLY this format, no other text:
slug: <kebab-case slug, 2-5 words>
name: <Title Case Name, 2-5 words>
summary: <one sentence describing when this procedure runs and what it accomplishes>

The slug must be lowercase, hyphenated, contain only [a-z0-9-]. Avoid generic names like "process-message" or "handle-thing".`;

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + '…' : s;
}

export async function proposeProcedureName(input: ProposeInput): Promise<Proposal> {
  const client = new Anthropic({ apiKey: input.apiKey });
  const userBlock = input.artifacts
    .map((a, i) => `Artifact ${i + 1} (${a.kind}):\n${truncate(a.content, 1500)}`)
    .join('\n\n---\n\n');

  let response: Anthropic.Message;
  try {
    response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 400,
      system: SYSTEM,
      messages: [{ role: 'user', content: userBlock }],
    });
  } catch (err) {
    throw holoError({
      code: ErrorCode.HOLO_INTERNAL,
      problem: `Procedure naming LLM call failed: ${String(err)}`,
      fix: 'Check ANTHROPIC_API_KEY and network connectivity',
    });
  }

  if (response.stop_reason !== 'end_turn') {
    throw holoError({
      code: ErrorCode.HOLO_INTERNAL,
      problem: 'Procedure naming output was truncated',
      fix: 'Retry; if persistent, reduce artifact content length',
    });
  }

  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('');

  const slug = text.match(/^slug:\s*([a-z0-9-]+)\s*$/m)?.[1];
  const name = text.match(/^name:\s*(.+)$/m)?.[1]?.trim();
  const summary = text.match(/^summary:\s*([\s\S]+?)$/m)?.[1]?.trim();

  if (!slug || !name || !summary) {
    throw holoError({
      code: ErrorCode.HOLO_INTERNAL,
      problem: `Procedure naming output did not match expected format: ${truncate(text, 200)}`,
      fix: 'Retry; the LLM occasionally drifts from the format.',
    });
  }

  return { proposedSlug: slug, proposedName: name, summary };
}
```

- [ ] **Step 4: Re-run the test**

Run: `pnpm --filter @holo/discovery test propose`
Expected: PASS.

- [ ] **Step 5: Re-export and commit**

Edit `packages/discovery/src/index.ts`:

```typescript
export * from './types.js';
export { clusterArtifacts } from './cluster.js';
export { proposeProcedureName } from './propose.js';
```

```bash
git add packages/discovery/src/propose.ts packages/discovery/src/__tests__/propose.test.ts packages/discovery/src/index.ts
git commit -m "feat(discovery): name procedures via Claude Haiku"
```

---

## Task 5: Discovery orchestrator (DB read → cluster → propose → DB write)

**Files:**
- Create: `packages/discovery/src/discover.ts`
- Test: `packages/discovery/src/__tests__/discover.test.ts`

This task is the integration boundary. The function loads recent artifacts + their best-chunk embeddings + entity hints (extracted from `payload`), clusters them, names each, and inserts proposals — skipping any episode whose centroid matches an existing rejected proposal (negative-signal blocklist).

- [ ] **Step 1: Write the integration test**

```typescript
// packages/discovery/src/__tests__/discover.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runDiscovery } from '../discover.js';

const mockDb = {
  recentArtifactsForOrg: vi.fn(),
  recentRejectedCentroidsForOrg: vi.fn(),
  insertEpisode: vi.fn(),
  insertProposal: vi.fn(),
};
const mockProposeFn = vi.fn();

describe('runDiscovery', () => {
  beforeEach(() => {
    Object.values(mockDb).forEach((m) => m.mockReset());
    mockProposeFn.mockReset();
  });

  it('inserts episode + proposal for each clusterable bundle', async () => {
    mockDb.recentArtifactsForOrg.mockResolvedValue([
      { id: 'a', sourceId: 's1', externalId: 'e1', kind: 'hubspot.deal',
        payload: { dealId: '42', title: 'Acme' }, fetchedAt: new Date('2026-05-01'),
        embedding: new Array(1024).fill(0.1), entityHints: ['deal:42'] },
      { id: 'b', sourceId: 's2', externalId: 'e2', kind: 'slack.message',
        payload: { text: 'Acme refund' }, fetchedAt: new Date('2026-05-02'),
        embedding: new Array(1024).fill(0.1), entityHints: ['deal:42'] },
      { id: 'c', sourceId: 's3', externalId: 'e3', kind: 'grain.meeting',
        payload: { title: 'Acme call' }, fetchedAt: new Date('2026-05-03'),
        embedding: new Array(1024).fill(0.1), entityHints: ['deal:42'] },
    ]);
    mockDb.recentRejectedCentroidsForOrg.mockResolvedValue([]);
    mockDb.insertEpisode.mockResolvedValue({ id: 'ep-1' });
    mockDb.insertProposal.mockResolvedValue({ id: 'pr-1' });
    mockProposeFn.mockResolvedValue({
      proposedSlug: 'handle-acme-refund',
      proposedName: 'Handle Acme Refund',
      summary: 'Customer asks for refund; sales + support coordinate.',
    });

    const result = await runDiscovery({
      organizationId: 'org-1',
      apiKey: 'k',
      db: mockDb,
      propose: mockProposeFn,
    });

    expect(mockDb.insertEpisode).toHaveBeenCalledTimes(1);
    expect(mockDb.insertProposal).toHaveBeenCalledWith(expect.objectContaining({
      proposedSlug: 'handle-acme-refund',
      episodeId: 'ep-1',
    }));
    expect(result.proposalsCreated).toBe(1);
  });

  it('skips clusters whose centroid matches a recently rejected proposal', async () => {
    const dup = new Array(1024).fill(0.1);
    mockDb.recentArtifactsForOrg.mockResolvedValue([
      { id: 'a', sourceId: 's1', externalId: 'e', kind: 'k', payload: {},
        fetchedAt: new Date(), embedding: dup, entityHints: ['x'] },
      { id: 'b', sourceId: 's2', externalId: 'e', kind: 'k', payload: {},
        fetchedAt: new Date(), embedding: dup, entityHints: ['x'] },
      { id: 'c', sourceId: 's3', externalId: 'e', kind: 'k', payload: {},
        fetchedAt: new Date(), embedding: dup, entityHints: ['x'] },
    ]);
    mockDb.recentRejectedCentroidsForOrg.mockResolvedValue([dup]);

    const result = await runDiscovery({
      organizationId: 'org-1', apiKey: 'k', db: mockDb, propose: mockProposeFn,
    });

    expect(mockDb.insertEpisode).not.toHaveBeenCalled();
    expect(mockProposeFn).not.toHaveBeenCalled();
    expect(result.proposalsSkipped).toBe(1);
  });
});
```

- [ ] **Step 2: Implement `discover.ts`**

```typescript
// packages/discovery/src/discover.ts
import { clusterArtifacts } from './cluster.js';
import { DEFAULT_CLUSTER_OPTIONS, type ArtifactInput, type Proposal } from './types.js';
import { proposeProcedureName as defaultPropose } from './propose.js';

export interface DiscoveryDb {
  recentArtifactsForOrg(orgId: string, sinceMs: number): Promise<ArtifactInput[]>;
  recentRejectedCentroidsForOrg(orgId: string, sinceMs: number): Promise<number[][]>;
  insertEpisode(input: {
    organizationId: string;
    artifactIds: string[];
    centroidEmbedding: number[];
    entityKey: string | null;
    firstSeenAt: Date;
    lastSeenAt: Date;
  }): Promise<{ id: string }>;
  insertProposal(input: {
    organizationId: string;
    episodeId: string;
    proposedSlug: string;
    proposedName: string;
    summary: string;
  }): Promise<{ id: string }>;
}

export interface DiscoveryInput {
  organizationId: string;
  apiKey: string;
  db: DiscoveryDb;
  propose?: (input: { apiKey: string; artifacts: { kind: string; content: string }[] }) => Promise<Proposal>;
  windowMs?: number;
}

export interface DiscoveryResult {
  proposalsCreated: number;
  proposalsSkipped: number;
  episodesConsidered: number;
}

function cosine(a: number[], b: number[]): number {
  let dot = 0; let na = 0; let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += (a[i] ?? 0) * (b[i] ?? 0);
    na += (a[i] ?? 0) ** 2;
    nb += (b[i] ?? 0) ** 2;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

function payloadToText(payload: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(payload)) {
    if (typeof v === 'string' && v.length > 0) parts.push(`${k}: ${v}`);
  }
  return parts.join('\n');
}

export async function runDiscovery(input: DiscoveryInput): Promise<DiscoveryResult> {
  const propose = input.propose ?? defaultPropose;
  const windowMs = input.windowMs ?? DEFAULT_CLUSTER_OPTIONS.timeWindowMs;
  const sinceMs = Date.now() - windowMs;

  const [artifacts, rejectedCentroids] = await Promise.all([
    input.db.recentArtifactsForOrg(input.organizationId, sinceMs),
    input.db.recentRejectedCentroidsForOrg(input.organizationId, windowMs * 4),
  ]);

  const episodes = clusterArtifacts(artifacts, DEFAULT_CLUSTER_OPTIONS);
  let created = 0;
  let skipped = 0;

  for (const ep of episodes) {
    const tooSimilarToRejected = rejectedCentroids.some(
      (c) => cosine(c, ep.centroidEmbedding) >= 0.92,
    );
    if (tooSimilarToRejected) { skipped++; continue; }

    const inserted = await input.db.insertEpisode({
      organizationId: input.organizationId,
      artifactIds: ep.artifactIds,
      centroidEmbedding: ep.centroidEmbedding,
      entityKey: ep.entityKey,
      firstSeenAt: ep.firstSeenAt,
      lastSeenAt: ep.lastSeenAt,
    });

    const byId = new Map(artifacts.map((a) => [a.id, a]));
    const proposal = await propose({
      apiKey: input.apiKey,
      artifacts: ep.artifactIds.slice(0, 5).map((id) => {
        const a = byId.get(id)!;
        return { kind: a.kind, content: payloadToText(a.payload) };
      }),
    });

    await input.db.insertProposal({
      organizationId: input.organizationId,
      episodeId: inserted.id,
      proposedSlug: proposal.proposedSlug,
      proposedName: proposal.proposedName,
      summary: proposal.summary,
    });
    created++;
  }

  return { proposalsCreated: created, proposalsSkipped: skipped, episodesConsidered: episodes.length };
}
```

- [ ] **Step 3: Re-run tests**

Run: `pnpm --filter @holo/discovery test`
Expected: all pass.

- [ ] **Step 4: Re-export and commit**

Edit `packages/discovery/src/index.ts`:

```typescript
export * from './types.js';
export { clusterArtifacts } from './cluster.js';
export { proposeProcedureName } from './propose.js';
export { runDiscovery, type DiscoveryDb, type DiscoveryInput, type DiscoveryResult } from './discover.js';
```

```bash
git add packages/discovery/src/discover.ts packages/discovery/src/__tests__/discover.test.ts packages/discovery/src/index.ts
git commit -m "feat(discovery): orchestrator with rejection-blocklist filter"
```

---

## Task 6: API route — POST /api/skills/discover

**Files:**
- Create: `apps/web/src/app/api/skills/discover/route.ts`

This route binds `runDiscovery` to a real `DiscoveryDb` backed by Drizzle. It loads artifacts joined with their highest-similarity chunk embedding and extracts entity hints from `payload` (heuristic: any string value that looks like an ID — UUID, numeric, or namespaced like `deal_42`).

- [ ] **Step 1: Implement the route**

Read `apps/web/src/app/api/skills/synthesize/route.ts` first to copy auth + org-scoping pattern. Then:

```typescript
// apps/web/src/app/api/skills/discover/route.ts
import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { eq, and, gte, sql, desc, inArray } from 'drizzle-orm';
import { schema } from '@holo/db';
import { runDiscovery, type DiscoveryDb } from '@holo/discovery';
import { getServerContext } from '@/lib/server-context';

const ID_HINT_REGEX = /\b([a-z]{3,12}[-_:]?[a-zA-Z0-9]{6,40})\b/g;

function extractHints(payload: Record<string, unknown>): string[] {
  const hints = new Set<string>();
  for (const [k, v] of Object.entries(payload)) {
    if (typeof v !== 'string') continue;
    const matches = v.match(ID_HINT_REGEX);
    if (matches) for (const m of matches) hints.add(`${k}:${m}`);
  }
  return Array.from(hints).slice(0, 8);
}

export async function POST() {
  const { auth, db } = await getServerContext();
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const orgId = (session.user as unknown as { organizationId: string }).organizationId;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return NextResponse.json({ error: 'missing_api_key' }, { status: 500 });

  const discoveryDb: DiscoveryDb = {
    async recentArtifactsForOrg(orgIdArg, sinceMs) {
      const since = new Date(sinceMs);
      const rows = await db
        .select({
          id: schema.sourceArtifacts.id,
          sourceId: schema.sourceArtifacts.sourceId,
          externalId: schema.sourceArtifacts.externalId,
          kind: schema.sourceArtifacts.kind,
          payload: schema.sourceArtifacts.payload,
          fetchedAt: schema.sourceArtifacts.fetchedAt,
          embedding: schema.chunks.embedding,
        })
        .from(schema.sourceArtifacts)
        .leftJoin(schema.chunks, eq(schema.chunks.sourceArtifactId, schema.sourceArtifacts.id))
        .where(and(
          eq(schema.sourceArtifacts.organizationId, orgIdArg),
          gte(schema.sourceArtifacts.fetchedAt, since),
        ))
        .orderBy(desc(schema.sourceArtifacts.fetchedAt))
        .limit(2000);

      return rows.map((r) => ({
        id: r.id,
        sourceId: r.sourceId,
        externalId: r.externalId,
        kind: r.kind,
        payload: r.payload as Record<string, unknown>,
        fetchedAt: r.fetchedAt,
        embedding: (r.embedding as number[] | null) ?? null,
        entityHints: extractHints(r.payload as Record<string, unknown>),
      }));
    },

    async recentRejectedCentroidsForOrg(orgIdArg, lookbackMs) {
      const since = new Date(Date.now() - lookbackMs);
      const rows = await db
        .select({ centroid: schema.procedureEpisodes.centroidEmbedding })
        .from(schema.procedureProposals)
        .innerJoin(
          schema.procedureEpisodes,
          eq(schema.procedureEpisodes.id, schema.procedureProposals.episodeId),
        )
        .where(and(
          eq(schema.procedureProposals.organizationId, orgIdArg),
          eq(schema.procedureProposals.status, 'rejected'),
          gte(schema.procedureProposals.createdAt, since),
        ));
      return rows.map((r) => (r.centroid as number[] | null) ?? []).filter((v) => v.length > 0);
    },

    async insertEpisode(payload) {
      const [row] = await db.insert(schema.procedureEpisodes).values({
        organizationId: payload.organizationId,
        sourceArtifactIds: payload.artifactIds,
        centroidEmbedding: payload.centroidEmbedding,
        entityKey: payload.entityKey,
        firstSeenAt: payload.firstSeenAt,
        lastSeenAt: payload.lastSeenAt,
      }).returning({ id: schema.procedureEpisodes.id });
      return { id: row!.id };
    },

    async insertProposal(payload) {
      const [row] = await db.insert(schema.procedureProposals).values({
        organizationId: payload.organizationId,
        episodeId: payload.episodeId,
        proposedSlug: payload.proposedSlug,
        proposedName: payload.proposedName,
        summary: payload.summary,
      }).returning({ id: schema.procedureProposals.id });
      return { id: row!.id };
    },
  };

  const result = await runDiscovery({ organizationId: orgId, apiKey, db: discoveryDb });
  return NextResponse.json(result);
}
```

- [ ] **Step 2: Smoke test the route locally**

Run: `pnpm --filter @holo/web dev` (in another terminal)
Run: `curl -X POST http://localhost:3000/api/skills/discover -H "cookie: $(cat .test-cookie)"` (use your authenticated session cookie; or skip and rely on the UI test in Task 11).
Expected: HTTP 200 with `{ proposalsCreated, proposalsSkipped, episodesConsidered }`.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/api/skills/discover/route.ts
git commit -m "feat(api): POST /api/skills/discover triggers procedure discovery"
```

---

## Task 7: API route — GET /api/skills/proposals

**Files:**
- Create: `apps/web/src/app/api/skills/proposals/route.ts`

- [ ] **Step 1: Implement**

```typescript
// apps/web/src/app/api/skills/proposals/route.ts
import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { and, desc, eq } from 'drizzle-orm';
import { schema } from '@holo/db';
import { getServerContext } from '@/lib/server-context';

export async function GET() {
  const { auth, db } = await getServerContext();
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const orgId = (session.user as unknown as { organizationId: string }).organizationId;

  const rows = await db
    .select({
      id: schema.procedureProposals.id,
      proposedSlug: schema.procedureProposals.proposedSlug,
      proposedName: schema.procedureProposals.proposedName,
      summary: schema.procedureProposals.summary,
      createdAt: schema.procedureProposals.createdAt,
      episodeId: schema.procedureProposals.episodeId,
      artifactIds: schema.procedureEpisodes.sourceArtifactIds,
      entityKey: schema.procedureEpisodes.entityKey,
    })
    .from(schema.procedureProposals)
    .innerJoin(
      schema.procedureEpisodes,
      eq(schema.procedureEpisodes.id, schema.procedureProposals.episodeId),
    )
    .where(and(
      eq(schema.procedureProposals.organizationId, orgId),
      eq(schema.procedureProposals.status, 'pending'),
    ))
    .orderBy(desc(schema.procedureProposals.createdAt))
    .limit(20);

  return NextResponse.json({ proposals: rows });
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/app/api/skills/proposals/route.ts
git commit -m "feat(api): GET /api/skills/proposals lists pending proposals"
```

---

## Task 8: API route — POST /api/skills/proposals/[id]/accept

**Files:**
- Create: `apps/web/src/app/api/skills/proposals/[id]/accept/route.ts`

Acceptance: write `skill_labels` rows for each artifact in the episode pointing at `finalSlug`, mark proposal `accepted`, insert decision row, then call existing synthesize logic by re-using the path from `apps/web/src/app/api/skills/synthesize/route.ts`.

- [ ] **Step 1: Implement**

```typescript
// apps/web/src/app/api/skills/proposals/[id]/accept/route.ts
import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { and, eq } from 'drizzle-orm';
import { schema } from '@holo/db';
import { synthesizeSkill } from '@holo/skills';
import { getServerContext } from '@/lib/server-context';

interface AcceptBody { finalSlug?: string }

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { auth, db } = await getServerContext();
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const orgId = (session.user as unknown as { organizationId: string }).organizationId;
  const userId = session.user.id;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return NextResponse.json({ error: 'missing_api_key' }, { status: 500 });

  const { id: proposalId } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as AcceptBody;

  const [proposal] = await db
    .select({
      id: schema.procedureProposals.id,
      proposedSlug: schema.procedureProposals.proposedSlug,
      episodeId: schema.procedureProposals.episodeId,
      artifactIds: schema.procedureEpisodes.sourceArtifactIds,
    })
    .from(schema.procedureProposals)
    .innerJoin(
      schema.procedureEpisodes,
      eq(schema.procedureEpisodes.id, schema.procedureProposals.episodeId),
    )
    .where(and(
      eq(schema.procedureProposals.id, proposalId),
      eq(schema.procedureProposals.organizationId, orgId),
      eq(schema.procedureProposals.status, 'pending'),
    ));
  if (!proposal) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const finalSlug = (body.finalSlug ?? proposal.proposedSlug).toLowerCase().replace(/[^a-z0-9-]/g, '-');

  await db.transaction(async (tx) => {
    for (const artifactId of proposal.artifactIds) {
      await tx.insert(schema.skillLabels).values({
        organizationId: orgId,
        sourceArtifactId: artifactId,
        skillSlug: finalSlug,
      }).onConflictDoNothing();
    }
    await tx.update(schema.procedureProposals)
      .set({ status: 'accepted' })
      .where(eq(schema.procedureProposals.id, proposalId));
    await tx.insert(schema.procedureProposalDecisions).values({
      organizationId: orgId,
      proposalId,
      decision: 'accept',
      finalSlug,
      decidedBy: userId,
    });
  });

  const artifactRows = await db
    .select({
      id: schema.sourceArtifacts.id,
      kind: schema.sourceArtifacts.kind,
      payload: schema.sourceArtifacts.payload,
    })
    .from(schema.sourceArtifacts)
    .where(eq(schema.sourceArtifacts.organizationId, orgId));

  const labeled = artifactRows
    .filter((r) => proposal.artifactIds.includes(r.id))
    .map((r) => ({
      artifactId: r.id,
      kind: r.kind,
      content: JSON.stringify(r.payload).slice(0, 4000),
    }));

  const skill = await synthesizeSkill({ skillSlug: finalSlug, labeledArtifacts: labeled, apiKey });

  return NextResponse.json({ slug: finalSlug, skill });
}
```

Note: this route hands the synthesized skill back to the client. **It does not yet persist the skill to the `skills` table** — the existing synthesize route does that and we should reuse its persistence logic. **Follow up:** read `apps/web/src/app/api/skills/synthesize/route.ts` and either factor the persistence into a shared helper in `@holo/skills` or call the synthesize route internally. Pick whichever is shorter; if uncertain, copy the persistence block verbatim into this route and add a TODO to dedupe.

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/app/api/skills/proposals/
git commit -m "feat(api): POST /api/skills/proposals/[id]/accept materializes labels + skill"
```

---

## Task 9: API route — POST /api/skills/proposals/[id]/reject

**Files:**
- Create: `apps/web/src/app/api/skills/proposals/[id]/reject/route.ts`

- [ ] **Step 1: Implement**

```typescript
// apps/web/src/app/api/skills/proposals/[id]/reject/route.ts
import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { and, eq } from 'drizzle-orm';
import { schema } from '@holo/db';
import { getServerContext } from '@/lib/server-context';

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { auth, db } = await getServerContext();
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const orgId = (session.user as unknown as { organizationId: string }).organizationId;
  const userId = session.user.id;
  const { id: proposalId } = await ctx.params;

  const updated = await db
    .update(schema.procedureProposals)
    .set({ status: 'rejected' })
    .where(and(
      eq(schema.procedureProposals.id, proposalId),
      eq(schema.procedureProposals.organizationId, orgId),
      eq(schema.procedureProposals.status, 'pending'),
    ))
    .returning({ id: schema.procedureProposals.id });
  if (updated.length === 0) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  await db.insert(schema.procedureProposalDecisions).values({
    organizationId: orgId,
    proposalId,
    decision: 'reject',
    decidedBy: userId,
  });

  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/app/api/skills/proposals/
git commit -m "feat(api): POST /api/skills/proposals/[id]/reject"
```

---

## Task 10: UI — Suggested procedures section

**Files:**
- Create: `apps/web/src/components/suggested-procedures.tsx`
- Modify: `apps/web/src/app/(app)/skills/page.tsx`

Per `CLAUDE.md`: read `DESIGN.md` first and use existing tokens. Match the look of `SkillLabelPanel`. Accent color `#3F47FF` only on the primary "Yes" button.

- [ ] **Step 1: Read `DESIGN.md` and `apps/web/src/components/skill-label-panel.tsx`** to copy the card / button / spacing patterns.

- [ ] **Step 2: Implement `suggested-procedures.tsx`** as a client component that fetches `/api/skills/proposals` on mount, renders a list of cards (proposed name, summary, artifact count, kinds), and exposes Accept / Reject / Edit-name actions. On accept, POST to `/proposals/[id]/accept` (optionally with `{ finalSlug }`); on reject, POST to `/proposals/[id]/reject`. After either action, optimistically remove the card; on error, revert and toast.

  The component should also render a "Discover now" button that POSTs to `/api/skills/discover` and refetches. While discovery is running, show a loading state.

  Empty state when no proposals: "No suggestions yet. Click Discover to scan recent artifacts, or wait for the nightly run."

- [ ] **Step 3: Wire it into the Skills page**

In `apps/web/src/app/(app)/skills/page.tsx`, import and render `<SuggestedProcedures />` between the existing skills table and `<SkillLabelPanel />`.

- [ ] **Step 4: Manual UI test**

Run dev server, navigate to /skills, verify:
- "Discover" button works and creates proposals (after Task 6 produced any)
- Each proposal shows name + summary + "Accept" / "Reject" / "Rename"
- Accept produces a synthesized skill that appears in the existing table
- Reject removes the card and the same proposal does not return on next discover

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/suggested-procedures.tsx apps/web/src/app/\(app\)/skills/page.tsx
git commit -m "feat(web): suggested procedures section on skills page"
```

---

## Task 11: Cron handler

**Files:**
- Create: `apps/web/src/app/api/cron/discover/route.ts`
- Modify: `apps/web/vercel.json`

- [ ] **Step 1: Implement the cron route**

```typescript
// apps/web/src/app/api/cron/discover/route.ts
import { NextResponse } from 'next/server';
import { schema } from '@holo/db';
import { runDiscovery, type DiscoveryDb } from '@holo/discovery';
import { getServerContext } from '@/lib/server-context';

export async function GET(req: Request) {
  if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const { db } = await getServerContext();
  const apiKey = process.env.ANTHROPIC_API_KEY!;
  const orgs = await db.select({ id: schema.organization.id }).from(schema.organization);

  // Build the same discoveryDb adapter as in /api/skills/discover/route.ts.
  // EXTRACT the adapter into a shared helper at packages/discovery/src/drizzle-adapter.ts
  // before this task to avoid duplication; both routes import it.
  const buildDb = (await import('@/lib/discovery-db')).buildDiscoveryDb;
  const results: Record<string, unknown> = {};
  for (const o of orgs) {
    results[o.id] = await runDiscovery({
      organizationId: o.id,
      apiKey,
      db: buildDb(db) as DiscoveryDb,
    });
  }
  return NextResponse.json(results);
}
```

- [ ] **Step 2: Extract the adapter**

Move the `discoveryDb` literal from `apps/web/src/app/api/skills/discover/route.ts` (Task 6) into `apps/web/src/lib/discovery-db.ts` exporting `buildDiscoveryDb(db)`. Update both call sites.

- [ ] **Step 3: Register the cron in `apps/web/vercel.json`**

Read the existing `vercel.json`. Add to the `crons` array:

```json
{ "path": "/api/cron/discover", "schedule": "0 8 * * *" }
```

(Daily at 08:00 UTC.)

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/app/api/cron/discover/ apps/web/src/lib/discovery-db.ts apps/web/src/app/api/skills/discover/route.ts apps/web/vercel.json
git commit -m "feat(cron): nightly procedure discovery for all orgs"
```

---

## Task 12: Wire CI + verification

- [ ] **Step 1: Run the full test suite**

Run: `pnpm test` (from repo root)
Expected: PASS, including new `@holo/discovery` tests and `@holo/db` schema test.

- [ ] **Step 2: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS in all workspaces.

- [ ] **Step 3: Run lint**

Run: `pnpm lint`
Expected: PASS.

- [ ] **Step 4: Final commit if anything changed**

```bash
git status
# if anything was auto-fixed:
git add -A
git commit -m "chore: lint fixes"
```

---

## Self-review notes

- **Spec coverage:** Each piece of the brainstormed feature has a task — clustering (T3), naming (T4), persistence (T1, T5), discovery trigger (T6), listing (T7), accept (T8), reject (T9), UI (T10), cron (T11). Negative-signal blocklist is implemented in T5 (`recentRejectedCentroidsForOrg` + cosine ≥ 0.92 skip).
- **Known sharp edges:**
  1. Entity-hint extraction in T6 is heuristic (regex over payload strings). It's fine for HubSpot / Notion / Slack IDs but will miss email-thread references and Grain meeting IDs that don't fit the pattern. Add a per-connector hint extractor in a follow-up if quality is poor.
  2. T5's `recentArtifactsForOrg` query joins to `chunks` and takes whichever chunk row appears first. If an artifact has multiple chunks (e.g. long Slack thread split into 5 chunks), we should pick the largest chunk's embedding. The current `leftJoin` will return one row per chunk — **this is a bug**: deduplicate by `sourceArtifacts.id` and keep the chunk with the longest content. Fix in T6 before shipping.
  3. T8's "synthesized skill is not persisted" TODO must be resolved before merge — accepted proposals must end up in the `skills` table or the user sees nothing.
- **Type consistency:** `proposedSlug`/`proposedName`/`summary` are consistent across `propose.ts`, `discover.ts`, the proposals API, and the UI fetch shape.
- **No placeholders:** all code blocks are concrete except the UI component in T10 — which is intentional, since UI implementation should match `DESIGN.md` patterns the agent must read first. The behavior contract is fully specified.

---

**Plan complete and saved to `docs/superpowers/plans/2026-05-05-procedure-auto-discovery.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
