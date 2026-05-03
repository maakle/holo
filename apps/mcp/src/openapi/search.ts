import { createRoute, z } from '@hono/zod-openapi';

export const SearchRequestSchema = z
  .object({
    query: z
      .string()
      .min(1)
      .openapi({
        description: 'Natural-language query.',
        example: 'how do we onboard a new ATS partner?',
      }),
    limit: z
      .number()
      .int()
      .min(1)
      .max(50)
      .optional()
      .openapi({
        description: 'Maximum number of hits to return (1–50). Defaults to 10.',
        example: 5,
      }),
  })
  .openapi('SearchRequest');

export const SearchHitSchema = z
  .object({
    chunkId: z.string().openapi({ example: '4d3a7c0a-…' }),
    provider: z.string().openapi({ example: 'github' }),
    sourceId: z.string().openapi({ example: 'b1f2…' }),
    kind: z.string().openapi({ example: 'pull_request_body' }),
    content: z.string(),
    score: z.number().openapi({ example: 0.0234 }),
    metadata: z.record(z.unknown()).nullable(),
  })
  .openapi('SearchHit');

export const SearchResponseSchema = z
  .object({
    hits: z.array(SearchHitSchema),
  })
  .openapi('SearchResponse');

export const HoloErrorSchema = z
  .object({
    code: z.string(),
    problem: z.string(),
    cause: z.string().optional(),
    fix: z.string(),
    docs_url: z.string().optional(),
  })
  .openapi('HoloError');

export const searchRoute = createRoute({
  method: 'post',
  path: '/v1/search',
  tags: ['Retrieval'],
  summary: 'Hybrid search across the workspace',
  description:
    "BM25 + vector + RRF over the workspace's connected sources. Same backend as the MCP " +
    "`search` tool; agents that don't speak MCP can hit this REST endpoint instead.",
  security: [{ bearerAuth: [] }],
  request: {
    body: {
      content: {
        'application/json': { schema: SearchRequestSchema },
      },
    },
  },
  responses: {
    200: {
      description: 'Ranked content chunks.',
      content: {
        'application/json': { schema: SearchResponseSchema },
      },
    },
    400: {
      description: 'Validation error.',
      content: { 'application/json': { schema: HoloErrorSchema } },
    },
    401: {
      description: 'Missing or invalid bearer token.',
      content: { 'application/json': { schema: HoloErrorSchema } },
    },
  },
});
