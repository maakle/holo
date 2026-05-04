import { and, eq } from 'drizzle-orm';
import type { DB } from '@holo/db';
import { schema } from '@holo/db';
import { holoError, ErrorCode } from '@holo/errors';

export interface RunConnectSlackInput {
  db: DB;
  organizationId: string;
  userId: string;
  /** Slack bot token starting with `xoxb-`. */
  token: string;
  fetchImpl?: typeof fetch;
}

export interface RunConnectSlackOutput {
  teamId: string;
  teamName: string;
  inserted: boolean;
}

/**
 * Connect a Slack workspace via a manually-pasted bot token. Mirrors what the
 * OAuth callback does in apps/web — validates the token with auth.test,
 * upserts a connectorCredentials row, and upserts a sources row. Useful for
 * local dev where running the OAuth callback requires a public tunnel.
 */
export async function runConnectSlack(input: RunConnectSlackInput): Promise<RunConnectSlackOutput> {
  if (!/^xox[bp]-/.test(input.token)) {
    throw holoError({
      code: ErrorCode.HOLO_INVALID_INPUT,
      problem: 'Slack token must start with xoxb- (bot) or xoxp- (user)',
      fix: 'Copy the Bot User OAuth Token from api.slack.com → your app → OAuth & Permissions.',
    });
  }

  const fetchImpl = input.fetchImpl ?? fetch;
  const res = await fetchImpl('https://slack.com/api/auth.test', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${input.token}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
  });
  const json = (await res.json()) as {
    ok: boolean;
    error?: string;
    team_id?: string;
    team?: string;
  };
  if (!json.ok || !json.team_id) {
    throw holoError({
      code: ErrorCode.HOLO_OAUTH_EXCHANGE_FAILED,
      problem: `Slack auth.test failed: ${json.error ?? 'no team_id'}`,
      fix: 'Verify the token is current and the app is installed to a workspace.',
    });
  }

  const teamId = json.team_id;
  const teamName = json.team ?? teamId;

  const existing = await input.db
    .select({ id: schema.connectorCredentials.id })
    .from(schema.connectorCredentials)
    .where(
      and(
        eq(schema.connectorCredentials.organizationId, input.organizationId),
        eq(schema.connectorCredentials.userId, input.userId),
        eq(schema.connectorCredentials.provider, 'slack'),
      ),
    );
  let inserted = false;
  if (existing[0]) {
    await input.db
      .update(schema.connectorCredentials)
      .set({
        accessToken: input.token,
        status: 'active',
        lastRefreshedAt: new Date(),
      })
      .where(eq(schema.connectorCredentials.id, existing[0].id));
  } else {
    await input.db.insert(schema.connectorCredentials).values({
      organizationId: input.organizationId,
      userId: input.userId,
      provider: 'slack',
      accessToken: input.token,
      status: 'active',
    });
    inserted = true;
  }

  await input.db
    .insert(schema.sources)
    .values({
      organizationId: input.organizationId,
      provider: 'slack',
      externalId: teamId,
      name: teamName,
      metadata: { team_id: teamId },
    })
    .onConflictDoUpdate({
      target: [schema.sources.organizationId, schema.sources.provider, schema.sources.externalId],
      set: { name: teamName, updatedAt: new Date() },
    });

  return { teamId, teamName, inserted };
}
