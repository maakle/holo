/**
 * Schema-first REST router using @hono/zod-openapi.
 *
 * Routes are defined declaratively via `createRoute({...})`: request shape,
 * response shapes, and metadata all live next to the handler. The OpenAPI
 * document is derived from these definitions — no hand-maintained spec.
 */

import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import type { DB } from '@holo/db';
import { getSubjectsForUser } from '@holo/user-subjects';
import type { McpSessionVars } from '../middleware/session.js';
import { runListSkillsTool } from '../tools/list-skills.js';
import { runGetSkillTool } from '../tools/get-skill.js';
import { runSearchTool } from '../tools/search.js';
import { z } from '@hono/zod-openapi';
import {
  ErrorSchema,
  GetSkillResponseSchema,
  HealthResponseSchema,
  ListSkillsQuerySchema,
  ListSkillsResponseSchema,
  SearchBodySchema,
  SearchResponseSchema,
  SkillSlugParamSchema,
} from './schemas.js';

type ListSkillsResponse = z.infer<typeof ListSkillsResponseSchema>;
type GetSkillResponse = z.infer<typeof GetSkillResponseSchema>;

type RestEnv = { Variables: McpSessionVars };

// ── Route definitions (schema = single source of truth) ────────────────────

const healthRoute = createRoute({
  method: 'get',
  path: '/v1/health',
  summary: 'Liveness probe',
  tags: ['system'],
  responses: {
    200: {
      description: 'Gateway is up',
      content: { 'application/json': { schema: HealthResponseSchema } },
    },
  },
});

const listSkillsRoute = createRoute({
  method: 'get',
  path: '/v1/skills',
  summary: 'List skills',
  description: 'Returns skills for the authenticated user\'s organization.',
  tags: ['skills'],
  security: [{ bearerAuth: [] }],
  request: { query: ListSkillsQuerySchema },
  responses: {
    200: {
      description: 'A page of skills',
      content: { 'application/json': { schema: ListSkillsResponseSchema } },
    },
    401: {
      description: 'Missing or invalid bearer token',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
});

const getSkillRoute = createRoute({
  method: 'get',
  path: '/v1/skills/{slug}',
  summary: 'Get a skill by slug',
  tags: ['skills'],
  security: [{ bearerAuth: [] }],
  request: { params: SkillSlugParamSchema },
  responses: {
    200: {
      description: 'The skill, or { skill: null } if not found',
      content: { 'application/json': { schema: GetSkillResponseSchema } },
    },
    404: {
      description: 'Skill not found',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    401: {
      description: 'Missing or invalid bearer token',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
});

const searchRoute = createRoute({
  method: 'post',
  path: '/v1/search',
  summary: 'Semantic search across the org\'s indexed content',
  tags: ['search'],
  security: [{ bearerAuth: [] }],
  request: {
    body: {
      required: true,
      content: { 'application/json': { schema: SearchBodySchema } },
    },
  },
  responses: {
    200: {
      description: 'Ranked search hits',
      content: { 'application/json': { schema: SearchResponseSchema } },
    },
    400: {
      description: 'Invalid input',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    401: {
      description: 'Missing or invalid bearer token',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
});

// ── Router factory ──────────────────────────────────────────────────────────

export function createRestRouter(db: DB) {
  const router = new OpenAPIHono<RestEnv>();

  router.openapi(healthRoute, (c) => c.json({ status: 'ok' as const, version: '0.1' }, 200));

  router.openapi(listSkillsRoute, async (c) => {
    const user = c.get('user');
    const { status } = c.req.valid('query');
    const result = await runListSkillsTool(
      { db, organizationId: user.organizationId },
      { status },
    );
    // Cast: Drizzle types enum columns as `string`, but the underlying values
    // are constrained at the DB level to the SkillStatus enum.
    return c.json(result as ListSkillsResponse, 200);
  });

  router.openapi(getSkillRoute, async (c) => {
    const user = c.get('user');
    const { slug } = c.req.valid('param');
    const result = await runGetSkillTool(
      { db, organizationId: user.organizationId },
      { slug },
    );
    if (!result.skill) {
      return c.json(
        {
          code: 'HOLO_NOT_FOUND',
          problem: `skill "${slug}" not found`,
          fix: 'Check the slug and try again.',
        },
        404,
      );
    }
    return c.json(result as GetSkillResponse, 200);
  });

  router.openapi(searchRoute, async (c) => {
    const user = c.get('user');
    const { query, limit } = c.req.valid('json');

    const extraSubjects = await getSubjectsForUser(db, user.userId);
    const result = await runSearchTool(
      {
        db,
        organizationId: user.organizationId,
        userSubjects: [
          `org:${user.organizationId}`,
          `user:${user.userId}`,
          ...extraSubjects,
        ],
      },
      { q: query, top_k: limit },
    );
    return c.json(result, 200);
  });

  return router;
}

// ── OpenAPI document config (used by main.ts to mount /openapi.json) ───────

export const openApiConfig = {
  openapi: '3.1.0' as const,
  info: {
    title: 'Holo Gateway REST API',
    version: '0.1.0',
    description: 'Agent context layer REST surface. MCP lives at /mcp.',
  },
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http' as const,
        scheme: 'bearer' as const,
        bearerFormat: 'holo_<hex>',
      },
    },
  },
};
