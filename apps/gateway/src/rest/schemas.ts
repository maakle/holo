/**
 * Zod schemas for the v1 REST surface. Used by @hono/zod-openapi to:
 *   1. Validate request input (params/query/body) at the edge.
 *   2. Type the handler's `c.req.valid(...)` accessors.
 *   3. Generate the /openapi.json document.
 *
 * Single source of truth — there is no separate hand-maintained spec file.
 */

import { z } from '@hono/zod-openapi';

// ── Domain ──────────────────────────────────────────────────────────────────

export const SkillStatusSchema = z
  .enum(['draft', 'active', 'archived'])
  .openapi('SkillStatus');

export const SkillSchema = z
  .object({
    id: z.uuid().openapi({ example: '5f3e0b0e-...' }),
    name: z.string(),
    slug: z.string(),
    version: z.number().int().positive(),
    status: SkillStatusSchema,
    description: z.string().optional(),
  })
  .openapi('Skill');

export const SkillDetailSchema = z
  .object({
    id: z.uuid(),
    name: z.string(),
    slug: z.string(),
    version: z.number().int().positive(),
    status: SkillStatusSchema,
    content: z.string(),
  })
  .openapi('SkillDetail');

export const SearchHitSchema = z
  .object({
    chunk_id: z.string(),
    content: z.string(),
    score: z.number(),
    source: z.object({
      provider: z.string(),
      artifact_kind: z.string(),
      metadata: z.record(z.string(), z.unknown()),
    }),
    snippet_url: z.url().optional(),
  })
  .openapi('SearchHit');

/**
 * Projected citation — one-per-result reading of `SearchHit` that pre-builds
 * a human label, a deep link, and a short snippet. Clients building UI
 * should prefer this over re-deriving the same fields from `SearchHit.metadata`.
 * `index` is 1-based and stable within a response.
 */
export const CitationSchema = z
  .object({
    index: z.number().int().positive(),
    chunk_id: z.string(),
    provider: z.string(),
    artifact_kind: z.string(),
    label: z.string(),
    url: z.url().optional(),
    snippet: z.string(),
  })
  .openapi('Citation');

/** One embedding-model pass within a search. The fallback pass only fires
 * when the primary returns fewer than the minimum-results threshold. */
export const SearchCoveragePassSchema = z
  .object({
    role: z.enum(['primary', 'fallback']),
    embedding_model: z.string(),
    branch_counts: z.object({
      vector_returned: z.number().int().nonnegative(),
      bm25_returned: z.number().int().nonnegative(),
      fused_returned: z.number().int().nonnegative(),
    }),
    timings_ms: z.number().nonnegative(),
  })
  .openapi('SearchCoveragePass');

/** Telemetry envelope — substrate for "what I searched" footers. */
export const SearchCoverageSchema = z
  .object({
    query: z.string(),
    filters: z.object({
      provider: z.string().nullable(),
      account_ids: z.array(z.string()).nullable(),
      user_subjects_count: z.number().int().nonnegative(),
      top_k: z.number().int().positive(),
    }),
    passes: z.array(SearchCoveragePassSchema),
    fallback_used: z.boolean(),
    total_returned: z.number().int().nonnegative(),
    total_timings_ms: z.number().nonnegative(),
  })
  .openapi('SearchCoverage');

// ── Errors ──────────────────────────────────────────────────────────────────

export const ErrorSchema = z
  .object({
    code: z.string().openapi({ example: 'HOLO_NOT_FOUND' }),
    problem: z.string(),
    fix: z.string().optional(),
  })
  .openapi('Error');

// ── Request inputs ──────────────────────────────────────────────────────────

export const ListSkillsQuerySchema = z.object({
  status: SkillStatusSchema.optional().default('active'),
});

export const SkillSlugParamSchema = z.object({
  slug: z.string().min(1),
});

export const SearchBodySchema = z.object({
  query: z.string().min(1).openapi({ example: 'ranked retrieval pipeline' }),
  limit: z.number().int().positive().max(100).optional().default(10),
});

// ── Response envelopes ──────────────────────────────────────────────────────

export const ListSkillsResponseSchema = z
  .object({ skills: z.array(SkillSchema) })
  .openapi('ListSkillsResponse');

export const GetSkillResponseSchema = z
  .object({ skill: SkillDetailSchema.nullable() })
  .openapi('GetSkillResponse');

export const SearchResponseSchema = z
  .object({
    results: z.array(SearchHitSchema),
    citations: z.array(CitationSchema),
    coverage: SearchCoverageSchema,
  })
  .openapi('SearchResponse');

export const HealthResponseSchema = z
  .object({ status: z.literal('ok'), version: z.string() })
  .openapi('Health');

// ── Account brief (RFC-0006) ────────────────────────────────────────────────

export const BriefContextSchema = z
  .enum(['renewal', 'upsell', 'check-in', 'objection', 'first-meeting', 'custom'])
  .openapi('BriefContext');

export const BriefFreshnessSchema = z
  .object({
    lastSyncedAt: z.string().nullable(),
    perProvider: z.object({
      pylon: z.string().nullable(),
      grain: z.string().nullable(),
      hubspot: z.string().nullable(),
      notion: z.string().nullable(),
      github: z.string().nullable(),
    }),
  })
  .openapi('BriefFreshness');

export const BriefClaimSchema = z
  .object({
    text: z.string(),
    citationRefs: z.array(z.number().int().nonnegative()),
  })
  .openapi('BriefClaim');

export const BriefSectionSchema = z
  .object({
    citations: z.array(CitationSchema),
    claims: z.array(BriefClaimSchema),
    freshness: BriefFreshnessSchema,
  })
  .openapi('BriefSection');

export const BriefAtGlanceSchema = z
  .object({
    citations: z.array(CitationSchema),
    claims: z.array(BriefClaimSchema),
    freshness: BriefFreshnessSchema,
    displayName: z.string(),
    tier: z.string().nullable(),
    arr: z.object({ amount: z.string(), currency: z.string() }).nullable(),
    owner: z.string().nullable(),
    accountAgeDays: z.number().int().nullable(),
    lastContactAt: z.string().nullable(),
  })
  .openapi('BriefAtGlance');

export const BriefSectionsSchema = z
  .object({
    atGlance: BriefAtGlanceSchema,
    issues: BriefSectionSchema,
    lastConversation: BriefSectionSchema,
    productAsks: BriefSectionSchema,
    contextSection: BriefSectionSchema,
  })
  .openapi('BriefSections');

export const AccountBriefSchema = z
  .object({
    accountId: z.uuid(),
    context: BriefContextSchema,
    customContext: z.string().nullable(),
    sections: BriefSectionsSchema,
    freshness: BriefFreshnessSchema,
    generatedAt: z.string(),
    fromCache: z.boolean(),
  })
  .openapi('AccountBrief');

export const AccountIdParamSchema = z.object({
  accountId: z.uuid(),
});

export const BriefQuerySchema = z.object({
  context: BriefContextSchema,
  customContext: z.string().max(500).optional(),
});
