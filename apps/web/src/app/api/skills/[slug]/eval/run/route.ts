/**
 * POST /api/skills/[slug]/eval/run — kick off a regression run on demand.
 *
 * Owner/admin-only (matches the promotion endpoint). Synchronous: the run
 * blocks until every active eval entry has been graded. For large skills
 * this can take a minute; the worker cron handles nightly batches without
 * tying up an HTTP connection.
 */

import { eq, and } from 'drizzle-orm';
import { schema } from '@holo/db';
import { ErrorCode, holoError } from '@holo/errors';
import { withActiveOrg } from '@/lib/with-active-org';
import { runSkillEval } from '@/lib/run-skill-eval';

export const maxDuration = 300;
export const runtime = 'nodejs';

export const POST = withActiveOrg<{ slug: string }>(
  async ({ ctx, session, orgId, params }) => {
    const { db, env } = ctx;
    if (!env.ANTHROPIC_API_KEY) {
      throw holoError({
        code: ErrorCode.HOLO_ENV_INVALID,
        problem: 'ANTHROPIC_API_KEY is not configured',
        fix: 'Set ANTHROPIC_API_KEY in the web app environment to run evals.',
      });
    }
    const userId = session.user.id;
    const [me] = await db
      .select({ role: schema.member.role })
      .from(schema.member)
      .where(
        and(eq(schema.member.organizationId, orgId), eq(schema.member.userId, userId)),
      )
      .limit(1);
    if (!me || (me.role !== 'owner' && me.role !== 'admin')) {
      throw holoError({
        code: ErrorCode.HOLO_AUTH_FORBIDDEN,
        problem: 'only workspace owners or admins can run evals',
        fix: 'Ask an owner or admin to run this.',
      });
    }

    const result = await runSkillEval({
      db,
      organizationId: orgId,
      userId,
      skillSlug: params.slug,
      anthropicApiKey: env.ANTHROPIC_API_KEY,
    });
    if (!result) return { run: null, message: 'no active eval entries for this skill' };
    return { run: result };
  },
);
