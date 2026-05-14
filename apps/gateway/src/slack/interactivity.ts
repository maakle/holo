import type { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { schema, type DB } from '@holo/db';
import { verifySlackSignature } from '@holo/connectors';
import { logger } from '../logger.js';

// See note in events.ts — Slack handlers don't read gateway session vars.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyHono = Hono<any, any, any>;

interface MountSlackInteractivityOptions {
  db: DB;
  signingSecret: string | undefined;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * action_id the worker stamps on the "Show sources" button. Must match
 * `SHOW_SOURCES_ACTION_ID` in apps/worker/src/slack-bot/blocks.ts — duplicated
 * here to keep the gateway free of a worker-package dependency.
 */
const SHOW_SOURCES_ACTION_ID = 'holo_show_sources';

/** event_type stamped on answer-message metadata. Same constraint as above. */
const HOLO_ANSWER_METADATA_EVENT_TYPE = 'holo_answer';

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

interface InteractivityPayload {
  type: string;
  response_url?: string;
  message?: {
    metadata?: {
      event_type?: string;
      event_payload?: Record<string, unknown>;
    };
  };
  actions?: Array<{ action_id?: string; value?: string }>;
}

interface ShownSource {
  provider: string;
  kind: string;
  title: string;
  url?: string;
}

/**
 * POST /slack/interactivity            — shared Holo app
 * POST /slack/interactivity/:orgId     — EE per-org custom Slack app
 *
 * Slack POSTs application/x-www-form-urlencoded with a single `payload` field
 * containing JSON. Signature is HMAC of the raw urlencoded body (not the
 * decoded JSON) — same rule as /slack/events and /slack/commands.
 *
 * Today this handles a single action: the "Show sources" button on an answer
 * message. The source list rides in `message.metadata.event_payload.sources`
 * (stamped at post time by the worker), so the handler is stateless — it
 * never touches the DB on the hot path. The gateway always acks 200; any
 * failure becomes an ephemeral error message via the per-interaction
 * `response_url`.
 */
export function mountSlackInteractivity(
  app: AnyHono,
  opts: MountSlackInteractivityOptions,
): void {
  app.post('/slack/interactivity', async (c) => {
    if (!opts.signingSecret) {
      logger.warn(
        'slack interactivity: SLACK_CONNECTOR_SIGNING_SECRET unset, rejecting',
      );
      return c.json({ error: 'slack signing secret not configured' }, 503);
    }
    return handleInteractivity(c, opts.signingSecret);
  });

  app.post('/slack/interactivity/:orgId', async (c) => {
    const orgId = c.req.param('orgId');
    if (!UUID_RE.test(orgId)) {
      return c.json({ error: 'invalid org id in path' }, 400);
    }
    const customApp = await getCustomAppForOrg(opts.db, orgId);
    if (!customApp) {
      logger.warn(
        { orgId },
        'slack interactivity: per-org signing secret missing — no slack_app_configs row',
      );
      return c.json({ error: 'no custom slack app for org' }, 404);
    }
    return handleInteractivity(c, customApp.signingSecret);
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function handleInteractivity(c: any, signingSecret: string): Promise<Response> {
  const rawBody = await c.req.text();
  const verify = verifySlackSignature({
    signingSecret,
    rawBody,
    signatureHeader: c.req.header('x-slack-signature'),
    timestampHeader: c.req.header('x-slack-request-timestamp'),
  });
  if (!verify.ok) {
    logger.warn(
      { reason: verify.reason },
      'slack interactivity: signature rejected',
    );
    return c.json({ error: 'invalid signature' }, 401);
  }

  const params = new URLSearchParams(rawBody);
  const payloadRaw = params.get('payload');
  if (!payloadRaw) {
    return c.json({ error: 'missing payload' }, 400);
  }

  let payload: InteractivityPayload;
  try {
    payload = JSON.parse(payloadRaw) as InteractivityPayload;
  } catch {
    return c.json({ error: 'invalid payload json' }, 400);
  }

  if (payload.type !== 'block_actions') {
    // Other interactivity types (view_submission, shortcut, etc.) — ack so
    // Slack doesn't retry, but no work to do today.
    return c.json({ ok: true }, 200);
  }

  const action = payload.actions?.[0];
  if (!action || action.action_id !== SHOW_SOURCES_ACTION_ID) {
    return c.json({ ok: true }, 200);
  }

  const responseUrl = payload.response_url;
  if (!responseUrl) {
    logger.warn('slack interactivity: show_sources without response_url');
    return c.json({ ok: true }, 200);
  }

  const meta = payload.message?.metadata;
  if (meta?.event_type !== HOLO_ANSWER_METADATA_EVENT_TYPE) {
    // Older message posted before metadata was attached, or metadata was
    // stripped. Tell the user rather than silently no-op'ing.
    await postEphemeral(responseUrl, "I couldn't find the sources for this answer.");
    return c.json({ ok: true }, 200);
  }
  const rawSources = (meta.event_payload as { sources?: unknown } | undefined)?.sources;
  const sources = isShownSourceArray(rawSources) ? rawSources : [];
  if (sources.length === 0) {
    await postEphemeral(responseUrl, 'No sources were used for this answer.');
    return c.json({ ok: true }, 200);
  }

  await postEphemeralSources(responseUrl, sources);
  return c.json({ ok: true }, 200);
}

function isShownSourceArray(v: unknown): v is ShownSource[] {
  return (
    Array.isArray(v) &&
    v.every(
      (s) =>
        s !== null &&
        typeof s === 'object' &&
        typeof (s as { provider?: unknown }).provider === 'string' &&
        typeof (s as { kind?: unknown }).kind === 'string' &&
        typeof (s as { title?: unknown }).title === 'string',
    )
  );
}

async function postEphemeral(responseUrl: string, text: string): Promise<void> {
  await fetch(responseUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      response_type: 'ephemeral',
      replace_original: false,
      text,
    }),
  });
}

async function postEphemeralSources(
  responseUrl: string,
  sources: ShownSource[],
): Promise<void> {
  const blocks: Array<Record<string, unknown>> = [
    {
      type: 'context',
      elements: [{ type: 'mrkdwn', text: '*Sources*' }],
    },
  ];
  sources.forEach((s, i) => {
    const linked = s.url ? `<${s.url}|${s.title}>` : s.title;
    blocks.push({
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: `[${i + 1}] ${s.provider} · ${s.kind} · ${linked}`,
        },
      ],
    });
  });

  await fetch(responseUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      response_type: 'ephemeral',
      replace_original: false,
      text: 'Sources',
      blocks,
    }),
  });
}
