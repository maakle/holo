import { eq } from 'drizzle-orm';
import { schema, type DB } from '@holo/db';
import type { Env } from '@holo/env';

export interface SlackAppCreds {
  clientId: string;
  clientSecret: string;
  signingSecret: string;
  source: 'custom' | 'env';
  /** Set when source === 'custom'. */
  configId: string | null;
}

/**
 * Resolve the Slack OAuth + signing credentials to use for `orgId`.
 *
 * EE customers can register a custom Slack app per org (see
 * `slack_app_configs`). When such a row exists, all OAuth flows and webhook
 * signature checks for that org use the customer's app — their branding,
 * scopes, and manifest. Otherwise we fall back to the shared Holo app
 * configured via SLACK_CONNECTOR_* env vars.
 *
 * Returns null when neither path is configured — the caller surfaces
 * HOLO_CONNECTOR_NOT_IMPLEMENTED. The signing-secret field is intentionally
 * required even on the env path so callers (event handlers) can fail closed
 * if the deployment forgot SLACK_CONNECTOR_SIGNING_SECRET.
 */
export async function resolveSlackAppCreds(
  db: DB,
  env: Env,
  orgId: string,
): Promise<SlackAppCreds | null> {
  const rows = await db
    .select({
      id: schema.slackAppConfigs.id,
      clientId: schema.slackAppConfigs.clientId,
      clientSecret: schema.slackAppConfigs.clientSecret,
      signingSecret: schema.slackAppConfigs.signingSecret,
    })
    .from(schema.slackAppConfigs)
    .where(eq(schema.slackAppConfigs.organizationId, orgId))
    .limit(1);
  const custom = rows[0];
  if (custom) {
    return {
      clientId: custom.clientId,
      clientSecret: custom.clientSecret,
      signingSecret: custom.signingSecret,
      source: 'custom',
      configId: custom.id,
    };
  }
  if (
    !env.SLACK_CONNECTOR_CLIENT_ID ||
    !env.SLACK_CONNECTOR_CLIENT_SECRET ||
    !env.SLACK_CONNECTOR_SIGNING_SECRET
  ) {
    return null;
  }
  return {
    clientId: env.SLACK_CONNECTOR_CLIENT_ID,
    clientSecret: env.SLACK_CONNECTOR_CLIENT_SECRET,
    signingSecret: env.SLACK_CONNECTOR_SIGNING_SECRET,
    source: 'env',
    configId: null,
  };
}
