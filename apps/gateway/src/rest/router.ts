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
import { holoError, ErrorCode } from '@holo/errors';
import type { McpSessionVars } from '../middleware/session.js';
import { checkToolAllowed, resolveActiveToolAllowlist } from '../middleware/allowlist.js';
import {
  runListSkillsTool,
  runGetSkillTool,
  runSearchTool,
  runGetAccountBriefTool,
  invalidateAccountBriefCache,
} from '@holo/agent-tools';
import { z } from '@hono/zod-openapi';
import {
  AccountBriefSchema,
  AccountIdParamSchema,
  BriefQuerySchema,
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

const getAccountBriefRoute = createRoute({
  method: 'get',
  path: '/v1/accounts/{accountId}/brief',
  summary: 'Get the pre-call brief for an account',
  description:
    "RFC-0006 — five-section synthesis (at-a-glance, open issues, last conversation, product asks, context). Cached per (org, account, context, day); cache hits return `fromCache: true`. ACL'd via the same user-subject filter as `/v1/search`: callers must have at least one subject matching the account's chunks.",
  tags: ['brief'],
  security: [{ bearerAuth: [] }],
  request: { params: AccountIdParamSchema, query: BriefQuerySchema },
  responses: {
    200: {
      description: 'The structured brief.',
      content: { 'application/json': { schema: AccountBriefSchema } },
    },
    403: {
      description: 'Account not visible to this user (no matching subjects).',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    404: {
      description: 'Account not found in this organization.',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    401: {
      description: 'Missing or invalid bearer token',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
});

const regenerateAccountBriefRoute = createRoute({
  method: 'post',
  path: '/v1/accounts/{accountId}/brief/regenerate',
  summary: "Invalidate today's cached brief and re-synthesize",
  description:
    "Drops the cache row for (org, account, context, today) before re-running synthesis. Use this when an upstream connector just finished a sync and the user wants the brief refreshed before the meeting starts.",
  tags: ['brief'],
  security: [{ bearerAuth: [] }],
  request: { params: AccountIdParamSchema, query: BriefQuerySchema },
  responses: {
    200: {
      description: 'The freshly-synthesized brief.',
      content: { 'application/json': { schema: AccountBriefSchema } },
    },
    403: {
      description: 'Account not visible to this user.',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    404: {
      description: 'Account not found.',
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

    // Match the MCP transport's per-skill toolAllowlist enforcement: if the
    // caller has activated a skill via `x-active-skill-slug`, the REST
    // surface honors the same gate — search is only callable when the active
    // skill's allowlist is empty (allow-all default) or includes 'search'.
    const activeToolAllowlist = await resolveActiveToolAllowlist(
      db,
      user.organizationId,
      c.req.header('x-active-skill-slug'),
    );
    if (!checkToolAllowed('search', activeToolAllowlist)) {
      throw holoError({
        code: ErrorCode.HOLO_ALLOWLIST_EMPTY,
        problem: "Tool 'search' not in active skill allowlist",
        fix: "Add 'search' to the active skill's toolAllowlist, or activate a different skill.",
      });
    }

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

  router.openapi(getAccountBriefRoute, async (c) => {
    const user = c.get('user');
    const { accountId } = c.req.valid('param');
    const { context, customContext } = c.req.valid('query');

    const extraSubjects = await getSubjectsForUser(db, user.userId);
    const brief = await runGetAccountBriefTool(
      {
        db,
        organizationId: user.organizationId,
        userId: user.userId,
        userSubjects: [
          `org:${user.organizationId}`,
          `user:${user.userId}`,
          ...extraSubjects,
        ],
      },
      {
        account_id: accountId,
        context,
        ...(customContext ? { custom_context: customContext } : {}),
      },
    );
    // `emptyBrief` returns an at-a-glance with `displayName === ''`. That's
    // our signal that the account either doesn't exist in this org or isn't
    // visible to the caller's subjects — surface a 403 rather than the empty
    // payload so the UI doesn't render a ghost brief.
    if (brief.sections.atGlance.displayName === '') {
      return c.json(
        {
          code: 'HOLO_FORBIDDEN',
          problem: 'Account not visible to this user',
          fix: 'Verify the user has subjects matching at least one chunk on this account.',
        },
        403,
      );
    }
    return c.json(brief, 200);
  });

  router.openapi(regenerateAccountBriefRoute, async (c) => {
    const user = c.get('user');
    const { accountId } = c.req.valid('param');
    const { context, customContext } = c.req.valid('query');

    await invalidateAccountBriefCache({
      db,
      organizationId: user.organizationId,
      accountId,
      context,
    });

    const extraSubjects = await getSubjectsForUser(db, user.userId);
    const brief = await runGetAccountBriefTool(
      {
        db,
        organizationId: user.organizationId,
        userId: user.userId,
        userSubjects: [
          `org:${user.organizationId}`,
          `user:${user.userId}`,
          ...extraSubjects,
        ],
      },
      {
        account_id: accountId,
        context,
        ...(customContext ? { custom_context: customContext } : {}),
      },
    );
    if (brief.sections.atGlance.displayName === '') {
      return c.json(
        {
          code: 'HOLO_FORBIDDEN',
          problem: 'Account not visible to this user',
          fix: 'Verify the user has subjects matching at least one chunk on this account.',
        },
        403,
      );
    }
    return c.json(brief, 200);
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
