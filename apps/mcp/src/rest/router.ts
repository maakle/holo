import { Hono } from 'hono';
import type { DB } from '@holo/db';
import type { McpSessionVars } from '../middleware/session.js';
import { runListSkillsTool } from '../tools/list-skills.js';
import { runGetSkillTool } from '../tools/get-skill.js';
import { runSearchTool } from '../tools/search.js';

type RestEnv = { Variables: McpSessionVars };

export function createRestRouter(db: DB) {
  const router = new Hono<RestEnv>();

  // GET /v1/health — no auth required
  router.get('/v1/health', (c) => c.json({ status: 'ok', version: '0.1' }));

  // GET /v1/skills — list active skills
  router.get('/v1/skills', async (c) => {
    const user = c.get('user');
    const status = c.req.query('status') as 'draft' | 'active' | 'archived' | undefined;
    const result = await runListSkillsTool(
      { db, organizationId: user.organizationId },
      { status: status ?? 'active' },
    );
    return c.json(result);
  });

  // GET /v1/skills/:slug — get skill by slug
  router.get('/v1/skills/:slug', async (c) => {
    const user = c.get('user');
    const slug = c.req.param('slug');
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
    return c.json(result);
  });

  // POST /v1/search — semantic search
  router.post('/v1/search', async (c) => {
    const user = c.get('user');
    const body = (await c.req.json().catch(() => ({}))) as {
      query?: string;
      limit?: number;
    };

    if (!body.query || typeof body.query !== 'string') {
      return c.json(
        {
          code: 'HOLO_INVALID_INPUT',
          problem: 'query is required',
          fix: 'Provide { query: string } in the request body.',
        },
        400,
      );
    }

    const result = await runSearchTool(
      {
        db,
        organizationId: user.organizationId,
        userSubjects: [`org:${user.organizationId}`],
      },
      { q: body.query, top_k: body.limit ?? 10 },
    );
    return c.json(result);
  });

  return router;
}
