import type { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { schema, type DB } from '@holo/db';
import { verifySlackSignature } from '@holo/connectors';
import { tryClaimSlackEvent } from './dedupe.js';
import { enqueueSlackBotJob } from './queue.js';
import type { Posthog } from '../posthog.js';
import { logger } from '../logger.js';

// Hono is parameterized by Variables; we don't need any of the gateway's
// session vars in the Slack handlers, so accept the full app and treat its
// Variables shape as opaque. `any` is the cleanest way to express
// "don't care" without forcing every caller to satisfy a stricter shape.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyHono = Hono<any, any, any>;

interface MountSlackEventsOptions {
  db: DB;
  /** Signing secret for the shared Holo Slack app. Per-org custom apps store their own secret in slack_app_configs and resolve it on the per-tenant route. */
  signingSecret: string | undefined;
  redisUrl: string;
  posthog?: Posthog;
}

interface SlackEventEnvelope {
  type: string;
  challenge?: string;
  token?: string;
  team_id?: string;
  event_id?: string;
  event?: {
    type: string;
    user?: string;
    text?: string;
    channel?: string;
    ts?: string;
    thread_ts?: string;
    bot_id?: string;
    channel_type?: string;
    subtype?: string;
    /** Present on reaction_added / reaction_removed only. */
    reaction?: string;
    /** Present on reaction_added / reaction_removed only — the message the
     * reaction landed on. `item.channel` is the channel, `item.ts` is the
     * target message ts; we look both up in `slack_answer_index`. */
    item?: { type: string; channel?: string; ts?: string };
  };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Resolve the signing secret + config id for an EE per-org custom Slack app.
 * Returns null if the org has no custom config — the route fails closed
 * because the tenant URL was specifically requested, so falling back to the
 * shared env secret would silently route events through the wrong app. The
 * config id is plumbed into the worker job so it can pick the matching
 * connector_credentials row instead of guessing by recency.
 */
async function getCustomAppForOrg(
  db: DB,
  organizationId: string,
): Promise<{ id: string; signingSecret: string } | null> {
  const rows = await db
    .select({
      id: schema.slackAppConfigs.id,
      signingSecret: schema.slackAppConfigs.signingSecret,
    })
    .from(schema.slackAppConfigs)
    .where(eq(schema.slackAppConfigs.organizationId, organizationId))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * POST /slack/events             — shared Holo app
 * POST /slack/events/:orgId      — EE per-org custom Slack app
 *
 * Three responsibilities, in order:
 *   1. Verify HMAC signature using the right signing secret for the route.
 *      Per-org route looks up slack_app_configs by orgId; shared route uses
 *      env. If the secret is missing on either path, reject — failing closed
 *      prevents silently accepting unsigned input.
 *   2. Handle url_verification handshakes by echoing the challenge.
 *   3. For real events: claim the event_id in slack_event_dedupe; enqueue a
 *      worker job; ack 200 within Slack's 3s deadline. If we've seen the
 *      event_id before (Slack retry), ack without re-enqueueing.
 */
export function mountSlackEvents(
  app: AnyHono,
  opts: MountSlackEventsOptions,
): void {
  app.post('/slack/events', async (c) => {
    if (!opts.signingSecret) {
      logger.warn('slack events: SLACK_CONNECTOR_SIGNING_SECRET unset, rejecting');
      return c.json({ error: 'slack signing secret not configured' }, 503);
    }
    return handleSlackEvent(c, opts, opts.signingSecret, null);
  });

  app.post('/slack/events/:orgId', async (c) => {
    const orgId = c.req.param('orgId');
    if (!UUID_RE.test(orgId)) {
      return c.json({ error: 'invalid org id in path' }, 400);
    }
    const customApp = await getCustomAppForOrg(opts.db, orgId);
    if (!customApp) {
      logger.warn(
        { orgId },
        'slack events: per-org signing secret missing — no slack_app_configs row',
      );
      return c.json({ error: 'no custom slack app for org' }, 404);
    }
    return handleSlackEvent(c, opts, customApp.signingSecret, customApp.id);
  });
}

async function handleSlackEvent(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  c: any,
  opts: MountSlackEventsOptions,
  signingSecret: string,
  slackAppConfigId: string | null,
): Promise<Response> {
  // Slack signs the *raw* request body. Read once as text — never JSON-parse
  // before verification (re-serialization changes whitespace and breaks the
  // signature).
  const rawBody = await c.req.text();
  const verify = verifySlackSignature({
    signingSecret,
    rawBody,
    signatureHeader: c.req.header('x-slack-signature'),
    timestampHeader: c.req.header('x-slack-request-timestamp'),
  });
  if (!verify.ok) {
    logger.warn({ reason: verify.reason }, 'slack events: signature rejected');
    return c.json({ error: 'invalid signature' }, 401);
  }

  let envelope: SlackEventEnvelope;
  try {
    envelope = JSON.parse(rawBody) as SlackEventEnvelope;
  } catch {
    return c.json({ error: 'invalid json' }, 400);
  }

  // url_verification: a one-time handshake when you first save the Request
  // URL in api.slack.com. Echo `challenge` back as text/plain.
  if (envelope.type === 'url_verification' && envelope.challenge) {
    return c.text(envelope.challenge, 200, { 'content-type': 'text/plain' });
  }

  if (envelope.type !== 'event_callback' || !envelope.event || !envelope.team_id) {
    // Other top-level types (e.g. app_rate_limited) — ack so Slack doesn't
    // retry, but no work to do.
    return c.json({ ok: true }, 200);
  }

  if (envelope.event_id) {
    const claimed = await tryClaimSlackEvent(
      opts.db,
      envelope.team_id,
      envelope.event_id,
    );
    if (!claimed) {
      logger.debug(
        { eventId: envelope.event_id },
        'slack events: duplicate event, skipping',
      );
      return c.json({ ok: true }, 200);
    }
  }

  const event = envelope.event;
  // TEMP DEBUG — remove after diagnosis.
  logger.info(
    {
      eventId: envelope.event_id,
      type: event.type,
      channelType: event.channel_type,
      subtype: event.subtype,
      botId: event.bot_id,
      hasChannel: Boolean(event.channel),
      hasUser: Boolean(event.user),
      hasText: typeof event.text === 'string',
      slackAppConfigId,
    },
    'slack events: received',
  );
  // Ignore the bot's own messages — both bot_id presence (server-set) and
  // subtype === 'bot_message' (legacy). Without this, every reply we post
  // would re-trigger us.
  if (event.bot_id || event.subtype === 'bot_message') {
    return c.json({ ok: true }, 200);
  }

  try {
    if (
      event.type === 'app_mention' &&
      event.channel &&
      event.user &&
      typeof event.text === 'string'
    ) {
      await enqueueSlackBotJob(opts.redisUrl, {
        kind: 'app_mention',
        teamId: envelope.team_id,
        channel: event.channel,
        // Reply in-thread to keep channels tidy. If the mention started a
        // thread of its own, thread_ts is unset — fall back to the message ts.
        threadTs: event.thread_ts ?? event.ts ?? '',
        asker: event.user,
        text: event.text,
        slackAppConfigId,
      });
      opts.posthog?.capture({
        distinctId: `slack:${event.user}`,
        event: 'slack_bot_mentioned',
        properties: {
          team_id: envelope.team_id,
          channel: event.channel,
          custom_app: slackAppConfigId !== null,
        },
      });
    } else if (
      event.type === 'message' &&
      event.channel_type === 'im' &&
      event.channel &&
      event.user &&
      typeof event.text === 'string'
    ) {
      await enqueueSlackBotJob(opts.redisUrl, {
        kind: 'message_im',
        teamId: envelope.team_id,
        channel: event.channel,
        threadTs: event.thread_ts,
        asker: event.user,
        text: event.text,
        slackAppConfigId,
      });
    } else if (
      // RFC-0008 (slack extension). Users 👍/👎 the bot's reply; the worker
      // maps the emoji to a feedback row. We enqueue both reaction_added and
      // reaction_removed (un-vote) and let the worker distinguish via the
      // `removed` field.
      (event.type === 'reaction_added' || event.type === 'reaction_removed') &&
      event.user &&
      typeof event.reaction === 'string' &&
      event.item?.type === 'message' &&
      event.item.channel &&
      event.item.ts
    ) {
      await enqueueSlackBotJob(opts.redisUrl, {
        kind: 'reaction_added',
        teamId: envelope.team_id,
        channel: event.item.channel,
        messageTs: event.item.ts,
        asker: event.user,
        reaction: event.reaction,
        removed: event.type === 'reaction_removed',
        slackAppConfigId,
      });
    }
    // app_uninstalled, member_joined_channel, etc. — fall through to ack.
  } catch (err) {
    // Never let an enqueue failure cause a Slack retry storm. Log and ack;
    // we can revisit visibility into dropped events with proper alerting.
    logger.error({ err }, 'slack events: enqueue failed, dropping event');
  }

  return c.json({ ok: true }, 200);
}
