import type { Hono } from 'hono';
import type { DB } from '@holo/db';
import { verifySlackSignature } from '@holo/connectors';
import { tryClaimSlackEvent } from './dedupe.js';
import { enqueueSlackBotJob } from './queue.js';
import { logger } from '../logger.js';

// Hono is parameterized by Variables; we don't need any of the gateway's
// session vars in the Slack handlers, so accept the full app and treat its
// Variables shape as opaque. `any` is the cleanest way to express
// "don't care" without forcing every caller to satisfy a stricter shape.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyHono = Hono<any, any, any>;

interface MountSlackEventsOptions {
  db: DB;
  signingSecret: string | undefined;
  redisUrl: string;
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
  };
}

/**
 * POST /slack/events — Slack pushes every subscribed event here.
 *
 * Three responsibilities, in order:
 *   1. Verify HMAC signature against SLACK_SIGNING_SECRET. Reject otherwise.
 *      (If the secret is unset on the server, reject everything — failing
 *      closed prevents silently accepting unsigned input.)
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
      logger.warn('slack events: SLACK_SIGNING_SECRET unset, rejecting');
      return c.json({ error: 'slack signing secret not configured' }, 503);
    }

    // Slack signs the *raw* request body. Read once as text — never JSON-parse
    // before verification (re-serialization changes whitespace and breaks the
    // signature).
    const rawBody = await c.req.text();
    const verify = verifySlackSignature({
      signingSecret: opts.signingSecret,
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
        });
      }
      // app_uninstalled, member_joined_channel, etc. — fall through to ack.
    } catch (err) {
      // Never let an enqueue failure cause a Slack retry storm. Log and ack;
      // we can revisit visibility into dropped events with proper alerting.
      logger.error({ err }, 'slack events: enqueue failed, dropping event');
    }

    return c.json({ ok: true }, 200);
  });
}
