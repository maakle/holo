import type { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { schema, type DB } from '@holo/db';
import {
  verifyGoogleChatJwt,
  type GoogleChatAppEvent,
} from '@holo/connectors';
import { tryClaimGoogleChatEvent } from './dedupe.js';
import { enqueueGoogleChatBotJob } from './queue.js';
import { logger } from '../logger.js';

// Same convention as the Slack handlers — handlers don't read gateway
// session vars, so accept the full app and treat its Variables shape as
// opaque. See apps/gateway/src/slack/events.ts.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyHono = Hono<any, any, any>;

interface MountGoogleChatEventsOptions {
  db: DB;
  /**
   * Cloud project number for the shared Holo Chat App, used as the expected
   * JWT audience. Per-org BYO apps store their own audience in
   * `google_chat_app_configs` and resolve it on the per-tenant route.
   */
  sharedAudience: string | undefined;
  redisUrl: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function getCustomAppAudience(
  db: DB,
  organizationId: string,
): Promise<string | null> {
  const rows = await db
    .select({ audience: schema.googleChatAppConfigs.audience })
    .from(schema.googleChatAppConfigs)
    .where(eq(schema.googleChatAppConfigs.organizationId, organizationId))
    .limit(1);
  return rows[0]?.audience ?? null;
}

/**
 * POST /google-chat-app/events             — shared Holo Chat App
 * POST /google-chat-app/events/:orgId      — EE per-org custom Chat App
 *
 * Three responsibilities, in order — parallel to the Slack events handler:
 *   1. Verify the JWT in `Authorization: Bearer …` against Google's JWKS
 *      with the right audience. Per-org route looks up
 *      `google_chat_app_configs` by orgId; shared route uses env. If the
 *      audience is unconfigured on either path, reject — failing closed
 *      prevents silently accepting unsigned input.
 *   2. For `MESSAGE` events: claim (space_name, message_name) in
 *      google_chat_event_dedupe; enqueue a worker job; ack 200 within
 *      Google's 30s deadline. Duplicates (Google retry) ack without
 *      re-enqueueing.
 *   3. For other event types (ADDED_TO_SPACE, REMOVED_FROM_SPACE,
 *      CARD_CLICKED): ack 200, log, no work to do yet. The bot's
 *      onboarding ack reply ("Hi! Add me to the connections page…") and
 *      reactions handling come in a follow-up.
 */
export function mountGoogleChatAppEvents(
  app: AnyHono,
  opts: MountGoogleChatEventsOptions,
): void {
  app.post('/google-chat-app/events', async (c) => {
    if (!opts.sharedAudience) {
      logger.warn(
        'google-chat-app events: GOOGLE_CHAT_APP_PROJECT_NUMBER unset, rejecting',
      );
      return c.json(
        { error: 'google chat app audience not configured' },
        503,
      );
    }
    return handleGoogleChatEvent(c, opts, opts.sharedAudience);
  });

  app.post('/google-chat-app/events/:orgId', async (c) => {
    const orgId = c.req.param('orgId');
    if (!UUID_RE.test(orgId)) {
      return c.json({ error: 'invalid org id in path' }, 400);
    }
    const audience = await getCustomAppAudience(opts.db, orgId);
    if (!audience) {
      logger.warn(
        { orgId },
        'google-chat-app events: per-org audience missing — no google_chat_app_configs row',
      );
      return c.json({ error: 'no custom google chat app for org' }, 404);
    }
    return handleGoogleChatEvent(c, opts, audience);
  });
}

async function handleGoogleChatEvent(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  c: any,
  opts: MountGoogleChatEventsOptions,
  audience: string,
): Promise<Response> {
  // Verify before parsing. Body is JSON, but we don't want to trust its
  // contents until the JWT proves the request originated from Google's
  // platform service account.
  const verify = await verifyGoogleChatJwt({
    audience,
    authorizationHeader: c.req.header('authorization'),
  });
  if (!verify.ok) {
    logger.warn(
      { reason: verify.reason },
      'google-chat-app events: jwt rejected',
    );
    return c.json({ error: 'invalid authorization' }, 401);
  }

  let envelope: GoogleChatAppEvent;
  try {
    envelope = (await c.req.json()) as GoogleChatAppEvent;
  } catch {
    return c.json({ error: 'invalid json' }, 400);
  }

  // Lifecycle and click events ack but do not enqueue. The connections page
  // surfaces ADDED_TO_SPACE rows for admin visibility; that wiring lands
  // alongside the admin UI step.
  if (envelope.type !== 'MESSAGE' || !envelope.message || !envelope.space) {
    logger.debug(
      { type: envelope.type },
      'google-chat-app events: non-message event, ack only',
    );
    return c.json({ ok: true }, 200);
  }

  // Filter out the bot's own messages. The platform SA sends MESSAGE events
  // for posts the bot itself made — without this, every reply we patch
  // would re-trigger us via the create event that preceded the patch.
  if (envelope.message.sender?.type === 'BOT') {
    return c.json({ ok: true }, 200);
  }

  if (!envelope.customerNumber) {
    // Without a customer number we cannot map this event to a Holo org.
    // Dev-mode pings from the Cloud Console "test in space" tool hit this
    // path; ack so the test succeeds, but log so production misconfigs are
    // visible.
    logger.debug(
      { space: envelope.space.name },
      'google-chat-app events: missing customerNumber, ack without work',
    );
    return c.json({ ok: true }, 200);
  }

  const messageName = envelope.message.name;
  const spaceName = envelope.space.name;
  if (!messageName || !spaceName) {
    return c.json({ error: 'malformed event: missing names' }, 400);
  }

  const claimed = await tryClaimGoogleChatEvent(opts.db, spaceName, messageName);
  if (!claimed) {
    logger.debug(
      { messageName },
      'google-chat-app events: duplicate event, skipping',
    );
    return c.json({ ok: true }, 200);
  }

  // Prefer argumentText (mention stripped) when present, fall back to text.
  // The agent gets a clean query without the leading <users/BOT_ID>.
  const text = envelope.message.argumentText ?? envelope.message.text ?? '';
  const asker = envelope.user?.name ?? envelope.message.sender?.name ?? '';

  try {
    if (envelope.space.type === 'DM' || envelope.space.singleUserBotDm === true) {
      await enqueueGoogleChatBotJob(opts.redisUrl, {
        kind: 'dm',
        customerNumber: envelope.customerNumber,
        spaceName,
        threadName: envelope.message.thread?.name,
        messageName,
        asker,
        text,
      });
    } else if (envelope.space.type === 'ROOM') {
      // For room messages, only act when the bot is actually addressed —
      // `argumentText` is non-empty if the bot was @mentioned (Google
      // populates it on the event). When the bot wasn't mentioned, Chat
      // does not deliver the event in the first place under the standard
      // app subscription, so this branch is effectively "always a
      // mention"; we keep the guard for forward compatibility with
      // Workspace Events subscriptions.
      const threadName = envelope.message.thread?.name ?? '';
      await enqueueGoogleChatBotJob(opts.redisUrl, {
        kind: 'mention',
        customerNumber: envelope.customerNumber,
        spaceName,
        threadName,
        messageName,
        asker,
        text,
      });
    } else {
      logger.debug(
        { spaceType: envelope.space.type },
        'google-chat-app events: unknown space type, ack',
      );
    }
  } catch (err) {
    // Never let an enqueue failure cause a Google retry storm. Log and ack;
    // we revisit visibility into dropped events with alerting later.
    logger.error(
      { err },
      'google-chat-app events: enqueue failed, dropping event',
    );
  }

  return c.json({ ok: true }, 200);
}
