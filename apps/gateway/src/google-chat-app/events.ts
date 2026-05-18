import type { Hono } from 'hono';
import { eq, sql } from 'drizzle-orm';
import { schema, type DB } from '@holo/db';
import {
  verifyGoogleChatJwt,
  HOLO_CHAT_SLASH_COMMAND_HELP,
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
  /**
   * Public web base URL used to build the "go register your domain" link
   * in the unbound-domain fallback reply. When unset, the reply omits the
   * URL and just nudges the asker to talk to their admin.
   */
  webPublicUrl: string | undefined;
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
 * Inbound flow for MESSAGE events:
 *   1. Verify JWT (per-route audience).
 *   2. Dedupe by (space_name, message_name).
 *   3. Resolve tenant → org:
 *      a. Cache hit: row with matching `domain_id`.
 *      b. Cache miss: look up rows whose `primary_domains` array contains
 *         the asker's email domain. On match, cache `domain_id` for next
 *         time.
 *      c. No match: enqueue an `unbound-info` job — the bot DMs the
 *         asker a plain text reply pointing them at the Holo setup page,
 *         so the bot is never silent.
 *   4. Enqueue mention/dm job carrying the resolved `organizationId`.
 *
 * For ADDED_TO_SPACE events (bot added to a space, or first DM opened):
 * enqueue a `welcome` job that posts an unsolicited greeting via the shared
 * SA. Google Workspace Marketplace review requires this and that the
 * greeting is distinct from `/help`.
 *
 * Other event types (REMOVED_FROM_SPACE, CARD_CLICKED): ack 200, no work.
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

  const domainId = envelope.user?.domainId;
  const askerEmail = envelope.user?.email ?? null;

  logger.info(
    {
      type: envelope.type,
      domainId,
      askerEmail,
      spaceType: envelope.space?.type,
      singleUserBotDm: envelope.space?.singleUserBotDm,
      senderType: envelope.message?.sender?.type,
      hasMessage: Boolean(envelope.message),
    },
    'google-chat-app events: inbound',
  );

  // Google Chat parses the synchronous response body as a
  // `google.chat.v1.Message` proto. Returning anything with unknown
  // fields (e.g. `{ ok: true }`) makes Google log a parsing error and
  // surface "Holo reagiert nicht" in the client. Use `{}` for "no
  // immediate reply"; real replies are posted async via the Chat API.

  if (envelope.type === 'ADDED_TO_SPACE' && envelope.space?.name) {
    try {
      await enqueueGoogleChatBotJob(opts.redisUrl, {
        kind: 'welcome',
        spaceName: envelope.space.name,
        useSharedServiceAccount: true,
      });
    } catch (err) {
      logger.error(
        { err, spaceName: envelope.space.name },
        'google-chat-app events: enqueue welcome failed',
      );
    }
    return c.json({}, 200);
  }

  if (envelope.type === 'REMOVED_FROM_SPACE') {
    // No durable per-space state to clean: google_chat_workspaces is keyed
    // on domainId, not spaceName, and google_chat_answer_index rows stay
    // useful for historical analytics even after the bot leaves. Log so
    // ops can correlate sudden drops in mention traffic with removals.
    logger.info(
      { spaceName: envelope.space?.name, askerEmail },
      'google-chat-app events: bot removed from space',
    );
    return c.json({}, 200);
  }

  if (envelope.type !== 'MESSAGE' || !envelope.message || !envelope.space) {
    logger.debug(
      { type: envelope.type },
      'google-chat-app events: non-message event, ack only',
    );
    return c.json({}, 200);
  }

  if (envelope.message.sender?.type === 'BOT') {
    return c.json({}, 200);
  }

  if (!domainId && !askerEmail) {
    logger.warn(
      { space: envelope.space.name },
      'google-chat-app events: missing both user.domainId and user.email — cannot route',
    );
    return c.json({}, 200);
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
    return c.json({}, 200);
  }

  const resolved = await resolveOrgForEvent(opts.db, domainId, askerEmail);
  if (!resolved) {
    await handleUnboundDomain(opts, envelope, domainId, askerEmail, spaceName);
    return c.json({}, 200);
  }

  // Prefer argumentText (mention stripped) when present, fall back to text.
  // Slash commands invoked via Chat's autocomplete picker arrive with
  // `slashCommand.commandId` set and an empty `argumentText`/`text` body,
  // so normalize them to the matching textual form here — that way the
  // worker's single `isHelpCommand` check handles both invocation paths
  // (picker click + literal `/help` typed) without divergent branches.
  const rawText = envelope.message.argumentText ?? envelope.message.text ?? '';
  const text =
    envelope.message.slashCommand?.commandId === HOLO_CHAT_SLASH_COMMAND_HELP
      ? '/help'
      : rawText;
  const asker = envelope.user?.name ?? envelope.message.sender?.name ?? '';

  try {
    if (envelope.space.type === 'DM' || envelope.space.singleUserBotDm === true) {
      await enqueueGoogleChatBotJob(opts.redisUrl, {
        kind: 'dm',
        organizationId: resolved.organizationId,
        spaceName,
        threadName: envelope.message.thread?.name,
        messageName,
        asker,
        text,
      });
    } else if (envelope.space.type === 'ROOM') {
      const threadName = envelope.message.thread?.name ?? '';
      await enqueueGoogleChatBotJob(opts.redisUrl, {
        kind: 'mention',
        organizationId: resolved.organizationId,
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
    logger.error(
      { err },
      'google-chat-app events: enqueue failed, dropping event',
    );
  }

  return c.json({}, 200);
}

interface ResolvedOrg {
  organizationId: string;
}

/**
 * Resolve which Holo org owns this Chat event. Two-stage lookup:
 *
 *   1. Cache: row where `domain_id = <event's user.domainId>`.
 *   2. Email-domain match: row whose `primary_domains` array contains
 *      the asker's email domain. On hit, cache `domain_id` so subsequent
 *      events skip the array scan.
 *
 * Returns null if neither matches — the caller handles the unbound case
 * with an informational reply.
 */
async function resolveOrgForEvent(
  db: DB,
  domainId: string | undefined,
  askerEmail: string | null,
): Promise<ResolvedOrg | null> {
  if (domainId) {
    const cached = await db
      .select({ organizationId: schema.googleChatWorkspaces.organizationId })
      .from(schema.googleChatWorkspaces)
      .where(eq(schema.googleChatWorkspaces.domainId, domainId))
      .limit(1);
    if (cached[0]) return { organizationId: cached[0].organizationId };
  }

  if (!askerEmail) return null;
  const emailDomain = askerEmail.split('@')[1]?.toLowerCase();
  if (!emailDomain) return null;

  const byDomain = await db
    .select({
      id: schema.googleChatWorkspaces.id,
      organizationId: schema.googleChatWorkspaces.organizationId,
    })
    .from(schema.googleChatWorkspaces)
    .where(
      sql`${schema.googleChatWorkspaces.primaryDomains} @> ARRAY[${emailDomain}]::text[]`,
    )
    .limit(1);
  const match = byDomain[0];
  if (!match) return null;

  // Cache the domain_id for fast lookup next time. Best-effort — if the
  // unique constraint fires because another row already cached the same
  // domainId (shouldn't happen for a correctly-registered tenant), the
  // routing still works via the email-domain path.
  if (domainId) {
    try {
      await db
        .update(schema.googleChatWorkspaces)
        .set({ domainId })
        .where(eq(schema.googleChatWorkspaces.id, match.id));
    } catch (err) {
      logger.warn(
        { err, domainId, organizationId: match.organizationId },
        'google-chat-app events: failed to cache domain_id (non-fatal)',
      );
    }
  }

  return { organizationId: match.organizationId };
}

async function handleUnboundDomain(
  opts: MountGoogleChatEventsOptions,
  envelope: GoogleChatAppEvent,
  domainId: string | undefined,
  askerEmail: string | null,
  spaceName: string,
): Promise<void> {
  const setupUrl = opts.webPublicUrl
    ? `${opts.webPublicUrl.replace(/\/+$/, '')}/connect-agent?mode=chat-bot&surface=google-chat`
    : '';

  logger.info(
    { domainId, askerEmail },
    'google-chat-app events: unbound domain, posting informational reply',
  );

  try {
    await enqueueGoogleChatBotJob(opts.redisUrl, {
      kind: 'unbound-info',
      domainId: domainId ?? '',
      askerEmail,
      spaceName,
      threadName: envelope.message?.thread?.name,
      setupUrl,
      useSharedServiceAccount: true,
    });
  } catch (err) {
    logger.error(
      { err, domainId },
      'google-chat-app events: enqueue unbound-info failed',
    );
  }
}
