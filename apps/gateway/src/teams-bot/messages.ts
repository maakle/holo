import type { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { schema, type DB } from '@holo/db';
import { verifyTeamsJwt, type TeamsActivity } from '@holo/connectors';
import { tryClaimTeamsActivity } from './dedupe.js';
import { enqueueTeamsBotJob } from './queue.js';
import { logger } from '../logger.js';

// Handlers don't read gateway session vars, so accept the full app and
// treat its Variables shape as opaque. Same convention as Slack /
// Google Chat handlers.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyHono = Hono<any, any, any>;

interface MountTeamsBotMessagesOptions {
  db: DB;
  /**
   * Microsoft App ID for the shared Holo Teams bot — used as the
   * expected JWT audience on `/teams-bot/messages`. Per-org BYO bots
   * resolve their App ID from `teams_app_configs` on the per-org
   * route.
   */
  sharedAppId: string | undefined;
  redisUrl: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function getCustomAppForOrg(
  db: DB,
  organizationId: string,
): Promise<{ id: string; appId: string } | null> {
  const rows = await db
    .select({
      id: schema.teamsAppConfigs.id,
      appId: schema.teamsAppConfigs.appId,
    })
    .from(schema.teamsAppConfigs)
    .where(eq(schema.teamsAppConfigs.organizationId, organizationId))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * POST /teams-bot/messages              — shared Holo bot
 * POST /teams-bot/messages/:orgId       — EE per-org BYO bot
 *
 * Pipeline:
 *   1. Read raw body so we can verify the JWT against
 *      `Activity.serviceUrl` before trusting any field.
 *   2. Verify the Bot Framework JWT — RS256 signature against
 *      OIDC-discovered JWKS, audience = bot App ID, issuer = Bot
 *      Connector, serviceurl claim == Activity.serviceUrl. Failure → 401.
 *   3. For `message` activities: claim (tenant_id, activity_id), enqueue
 *      a worker job, ack 200 within Microsoft's 15s deadline.
 *   4. For `messageReaction`: enqueue a reaction job (worker writes the
 *      feedback row when Teams user mapping ships).
 *   5. For lifecycle types (`conversationUpdate`, `typing`, `invoke`,
 *      `event`): ack 200, no work.
 */
export function mountTeamsBotMessages(
  app: AnyHono,
  opts: MountTeamsBotMessagesOptions,
): void {
  app.post('/teams-bot/messages', async (c) => {
    if (!opts.sharedAppId) {
      logger.warn(
        'teams-bot messages: WORKER_TEAMS_BOT_APP_ID unset, rejecting',
      );
      return c.json({ error: 'teams bot app id not configured' }, 503);
    }
    return handleTeamsActivity(c, opts, {
      audience: opts.sharedAppId,
      teamsAppConfigId: null,
    });
  });

  app.post('/teams-bot/messages/:orgId', async (c) => {
    const orgId = c.req.param('orgId');
    if (!UUID_RE.test(orgId)) {
      return c.json({ error: 'invalid org id in path' }, 400);
    }
    const custom = await getCustomAppForOrg(opts.db, orgId);
    if (!custom) {
      logger.warn(
        { orgId },
        'teams-bot messages: per-org app id missing — no teams_app_configs row',
      );
      return c.json({ error: 'no custom teams bot for org' }, 404);
    }
    return handleTeamsActivity(c, opts, {
      audience: custom.appId,
      teamsAppConfigId: custom.id,
    });
  });
}

async function handleTeamsActivity(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  c: any,
  opts: MountTeamsBotMessagesOptions,
  ctx: { audience: string; teamsAppConfigId: string | null },
): Promise<Response> {
  // Parse the body once — we need Activity.serviceUrl in the JWT
  // verification step. Errors here return 400 before any JWT work so
  // malformed payloads can't even trigger a JWKS fetch.
  let activity: TeamsActivity;
  try {
    activity = (await c.req.json()) as TeamsActivity;
  } catch {
    return c.json({ error: 'invalid json' }, 400);
  }

  const verify = await verifyTeamsJwt({
    audience: ctx.audience,
    authorizationHeader: c.req.header('authorization'),
    activityServiceUrl: activity.serviceUrl,
  });
  if (!verify.ok) {
    logger.warn({ reason: verify.reason }, 'teams-bot messages: jwt rejected');
    return c.json({ error: 'invalid authorization' }, 401);
  }

  const tenantId = activity.channelData?.tenant?.id ?? activity.conversation.tenantId;
  if (!tenantId) {
    logger.debug(
      { type: activity.type },
      'teams-bot messages: missing tenant id, ack without work',
    );
    return c.json({ ok: true }, 200);
  }

  // Bot's own messages never re-trigger the bot — Bot Framework
  // generally suppresses them, but the recipient.id===from.id guard
  // makes the contract explicit.
  if (
    activity.from &&
    activity.recipient &&
    activity.from.id === activity.recipient.id
  ) {
    return c.json({ ok: true }, 200);
  }

  if (activity.type === 'message') {
    return await routeMessageActivity(c, opts, ctx, activity, tenantId);
  }
  if (activity.type === 'messageReaction') {
    return await routeReactionActivity(c, opts, ctx, activity, tenantId);
  }

  // conversationUpdate / typing / invoke / event — ack only for now.
  // Membership add (bot was @added to a channel/team) will land in a
  // follow-up that writes the `teams_installations` row.
  logger.debug(
    { type: activity.type },
    'teams-bot messages: non-message/reaction event, ack only',
  );
  return c.json({ ok: true }, 200);
}

async function routeMessageActivity(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  c: any,
  opts: MountTeamsBotMessagesOptions,
  ctx: { audience: string; teamsAppConfigId: string | null },
  activity: TeamsActivity,
  tenantId: string,
): Promise<Response> {
  const claimed = await tryClaimTeamsActivity(opts.db, tenantId, activity.id);
  if (!claimed) {
    logger.debug(
      { activityId: activity.id },
      'teams-bot messages: duplicate activity, skipping',
    );
    return c.json({ ok: true }, 200);
  }

  const text = stripMentionTags(activity.text ?? '');
  const asker = activity.from?.aadObjectId ?? activity.from?.id ?? '';
  const askerName = activity.from?.name;
  const conversationType = activity.conversation.conversationType;

  try {
    if (conversationType === 'personal') {
      await enqueueTeamsBotJob(opts.redisUrl, {
        kind: 'dm',
        tenantId,
        activityId: activity.id,
        conversationId: activity.conversation.id,
        serviceUrl: activity.serviceUrl,
        asker,
        ...(askerName !== undefined ? { askerName } : {}),
        text,
        teamsAppConfigId: ctx.teamsAppConfigId,
      });
    } else if (conversationType === 'channel' || conversationType === 'groupChat') {
      await enqueueTeamsBotJob(opts.redisUrl, {
        kind: 'mention',
        tenantId,
        activityId: activity.id,
        conversationId: activity.conversation.id,
        serviceUrl: activity.serviceUrl,
        asker,
        ...(askerName !== undefined ? { askerName } : {}),
        text,
        teamsAppConfigId: ctx.teamsAppConfigId,
      });
    } else {
      logger.debug(
        { conversationType },
        'teams-bot messages: unknown conversation type, ack',
      );
    }
  } catch (err) {
    // Never let an enqueue failure cause a Microsoft retry storm. Log
    // and ack; alerting on dropped events lands in a follow-up.
    logger.error({ err }, 'teams-bot messages: enqueue failed, dropping');
  }

  return c.json({ ok: true }, 200);
}

async function routeReactionActivity(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  c: any,
  opts: MountTeamsBotMessagesOptions,
  ctx: { audience: string; teamsAppConfigId: string | null },
  activity: TeamsActivity,
  tenantId: string,
): Promise<Response> {
  const claimed = await tryClaimTeamsActivity(opts.db, tenantId, activity.id);
  if (!claimed) {
    return c.json({ ok: true }, 200);
  }
  if (!activity.replyToId) {
    // A reaction without a target — ignore.
    return c.json({ ok: true }, 200);
  }
  const asker = activity.from?.aadObjectId ?? activity.from?.id ?? '';

  const added = activity.reactionsAdded ?? [];
  const removed = activity.reactionsRemoved ?? [];
  // Bot Framework can deliver one reactionAdded and one reactionsRemoved
  // in the same envelope (rare). Enqueue one job per reaction so the
  // worker reasons about a single (replyToId, type) at a time.
  for (const r of added) {
    try {
      await enqueueTeamsBotJob(opts.redisUrl, {
        kind: 'reaction',
        tenantId,
        activityId: activity.id,
        conversationId: activity.conversation.id,
        serviceUrl: activity.serviceUrl,
        asker,
        replyToId: activity.replyToId,
        reactionType: r.type,
        removed: false,
        teamsAppConfigId: ctx.teamsAppConfigId,
      });
    } catch (err) {
      logger.error({ err }, 'teams-bot messages: reaction enqueue failed');
    }
  }
  for (const r of removed) {
    try {
      await enqueueTeamsBotJob(opts.redisUrl, {
        kind: 'reaction',
        tenantId,
        activityId: activity.id,
        conversationId: activity.conversation.id,
        serviceUrl: activity.serviceUrl,
        asker,
        replyToId: activity.replyToId,
        reactionType: r.type,
        removed: true,
        teamsAppConfigId: ctx.teamsAppConfigId,
      });
    } catch (err) {
      logger.error({ err }, 'teams-bot messages: reaction enqueue failed');
    }
  }
  return c.json({ ok: true }, 200);
}

/**
 * Teams puts the bot mention as both an `entities[].mention` AND a
 * literal `<at>holo</at>` span in `activity.text`. Strip the tags
 * before passing to the agent so it sees a clean question.
 */
function stripMentionTags(text: string): string {
  return text.replace(/<at>[^<]*<\/at>/g, '').replace(/\s+/g, ' ').trim();
}

export { stripMentionTags as __stripMentionTagsForTests };
