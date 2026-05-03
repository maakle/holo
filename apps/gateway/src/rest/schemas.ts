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
  .object({ results: z.array(SearchHitSchema) })
  .openapi('SearchResponse');

export const HealthResponseSchema = z
  .object({ status: z.literal('ok'), version: z.string() })
  .openapi('Health');
