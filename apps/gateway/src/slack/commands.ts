import type { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { schema, type DB } from '@holo/db';
import { verifySlackSignature } from '@holo/connectors';
import { enqueueSlackBotJob } from './queue.js';
import { logger } from '../logger.js';

// See note in events.ts — Slack handlers don't read gateway session vars.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyHono = Hono<any, any, any>;

interface MountSlackCommandsOptions {
  db: DB;
  /** Signing secret for the shared Holo app. EE per-org custom apps resolve their own secret per request. */
  signingSecret: string | undefined;
  redisUrl: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function getCustomAppSigningSecret(
  db: DB,
  organizationId: string,
): Promise<string | null> {
  const rows = await db
    .select({ signingSecret: schema.slackAppConfigs.signingSecret })
    .from(schema.slackAppConfigs)
    .where(eq(schema.slackAppConfigs.organizationId, organizationId))
    .limit(1);
  return rows[0]?.signingSecret ?? null;
}

/**
 * POST /slack/commands           — shared Holo app
 * POST /slack/commands/:orgId    — EE per-org custom Slack app
 *
 * Slash commands arrive as application/x-www-form-urlencoded (NOT JSON), so
 * the signature is computed over the urlencoded body. Same verification rule
 * as events: never parse before verifying — re-serialization breaks the HMAC.
 *
 * Slack's docs say commands must respond within 3000ms or the user sees a
 * timeout error. We immediately return an ephemeral "Working on it…" message,
 * then do the actual work async via the worker, which posts the result via
 * the `response_url` Slack provides (good for ~30 minutes / 5 invocations).
 */
export function mountSlackCommands(
  app: AnyHono,
  opts: MountSlackCommandsOptions,
): void {
  app.post('/slack/commands', async (c) => {
    if (!opts.signingSecret) {
      logger.warn('slack commands: SLACK_CONNECTOR_SIGNING_SECRET unset, rejecting');
      return c.json({ error: 'slack signing secret not configured' }, 503);
    }
    return handleSlashCommand(c, opts, opts.signingSecret);
  });

  app.post('/slack/commands/:orgId', async (c) => {
    const orgId = c.req.param('orgId');
    if (!UUID_RE.test(orgId)) {
      return c.json({ error: 'invalid org id in path' }, 400);
    }
    const secret = await getCustomAppSigningSecret(opts.db, orgId);
    if (!secret) {
      logger.warn(
        { orgId },
        'slack commands: per-org signing secret missing — no slack_app_configs row',
      );
      return c.json({ error: 'no custom slack app for org' }, 404);
    }
    return handleSlashCommand(c, opts, secret);
  });
}

async function handleSlashCommand(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  c: any,
  opts: MountSlackCommandsOptions,
  signingSecret: string,
): Promise<Response> {
  const rawBody = await c.req.text();
  const verify = verifySlackSignature({
    signingSecret,
    rawBody,
    signatureHeader: c.req.header('x-slack-signature'),
    timestampHeader: c.req.header('x-slack-request-timestamp'),
  });
  if (!verify.ok) {
    logger.warn({ reason: verify.reason }, 'slack commands: signature rejected');
    return c.json({ error: 'invalid signature' }, 401);
  }

  const params = new URLSearchParams(rawBody);
  const teamId = params.get('team_id');
  const channelId = params.get('channel_id');
  const userId = params.get('user_id');
  const text = params.get('text') ?? '';
  const responseUrl = params.get('response_url');

  if (!teamId || !channelId || !userId || !responseUrl) {
    return c.json({ error: 'missing required slash command fields' }, 400);
  }

  try {
    await enqueueSlackBotJob(opts.redisUrl, {
      kind: 'slash_command',
      teamId,
      channel: channelId,
      asker: userId,
      text,
      responseUrl,
    });
  } catch (err) {
    logger.error({ err }, 'slack commands: enqueue failed');
    // Tell the user something actionable rather than a silent timeout.
    return c.json(
      {
        response_type: 'ephemeral',
        text: 'holo is temporarily unavailable. Try again in a minute.',
      },
      200,
    );
  }

  // Default response_type is 'ephemeral' — only the invoking user sees the
  // ack. The worker posts the actual answer via response_url and decides
  // whether to make it in_channel based on a `--public` flag in `text`.
  return c.json(
    {
      response_type: 'ephemeral',
      text: '_holo is thinking…_',
    },
    200,
  );
}
