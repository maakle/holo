import type { Hono } from 'hono';
import { verifySlackSignature } from '@holo/connectors';
import { enqueueSlackBotJob } from './queue.js';
import { logger } from '../logger.js';

// See note in events.ts — Slack handlers don't read gateway session vars.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyHono = Hono<any, any, any>;

interface MountSlackCommandsOptions {
  signingSecret: string | undefined;
  redisUrl: string;
}

/**
 * POST /slack/commands — handles the /holo slash command.
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
      logger.warn('slack commands: SLACK_SIGNING_SECRET unset, rejecting');
      return c.json({ error: 'slack signing secret not configured' }, 503);
    }

    const rawBody = await c.req.text();
    const verify = verifySlackSignature({
      signingSecret: opts.signingSecret,
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
  });
}
