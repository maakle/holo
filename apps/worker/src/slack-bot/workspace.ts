import { eq, and, isNull, type SQL } from 'drizzle-orm';
import { schema, type DB } from '@holo/db';

export interface WorkspaceCreds {
  organizationId: string;
  accessToken: string;
}

export interface CredentialRow {
  accessToken: string | null;
  slackAppConfigId: string | null;
  lastRefreshedAt: Date | null;
  connectedAt: Date;
}

/**
 * Pick which credentials row to post outbound Slack messages with. Pure so it
 * can be unit-tested without spinning up a DB.
 *
 * Disambiguation rules:
 *   - When `slackAppConfigId` is null or a string (i.e. the caller knows
 *     which Slack app fired the event), filter strictly. Posting with the
 *     wrong app's token lands in the wrong bot's DM and Slack returns
 *     channel_not_found — silent breakage for the user.
 *   - When undefined (legacy in-flight job from before the hint existed),
 *     fall back to "most recently refreshed/connected." This preserves
 *     behavior for jobs already in Redis when this code ships.
 *   - Within the matching set, prefer the most recently refreshed row so
 *     workspaces with multiple human installers pick a fresh token.
 */
export function pickCredentials(
  rows: CredentialRow[],
  slackAppConfigId: string | null | undefined,
): WorkspaceCreds['accessToken'] | null {
  const usable = rows.filter(
    (r): r is CredentialRow & { accessToken: string } =>
      typeof r.accessToken === 'string' && r.accessToken.length > 0,
  );
  const filtered =
    slackAppConfigId === undefined
      ? usable
      : usable.filter((r) => r.slackAppConfigId === slackAppConfigId);
  if (filtered.length === 0) return null;
  filtered.sort((a, b) => {
    const ta = (a.lastRefreshedAt ?? a.connectedAt).getTime();
    const tb = (b.lastRefreshedAt ?? b.connectedAt).getTime();
    return tb - ta;
  });
  return filtered[0]!.accessToken;
}

/**
 * Resolve which workspace this Slack team_id maps to, and which token to
 * post with. We trust whichever connector_credentials row was registered with
 * this team (the install path upserts a `sources` row keyed by team_id), and
 * pick the matching `slackAppConfigId` so we don't post with the wrong app's
 * token when one workspace has both the shared Holo app AND an EE custom app.
 */
export async function resolveWorkspace(
  db: DB,
  teamId: string,
  slackAppConfigId: string | null | undefined,
): Promise<WorkspaceCreds | null> {
  const sourceRow = await db
    .select({ organizationId: schema.sources.organizationId })
    .from(schema.sources)
    .where(
      and(eq(schema.sources.provider, 'slack'), eq(schema.sources.externalId, teamId)),
    )
    .limit(1);
  if (!sourceRow[0]) return null;
  const orgId = sourceRow[0].organizationId;

  const whereParts: SQL[] = [
    eq(schema.connectorCredentials.organizationId, orgId),
    eq(schema.connectorCredentials.provider, 'slack'),
    eq(schema.connectorCredentials.status, 'active'),
  ];
  // Push the filter into SQL when we have a hint — there's no point pulling
  // every Slack credential into memory just to drop it. `undefined` keeps the
  // pre-hint behavior for in-flight legacy jobs.
  if (slackAppConfigId === null) {
    whereParts.push(isNull(schema.connectorCredentials.slackAppConfigId));
  } else if (typeof slackAppConfigId === 'string') {
    whereParts.push(eq(schema.connectorCredentials.slackAppConfigId, slackAppConfigId));
  }
  const credRows = await db
    .select({
      accessToken: schema.connectorCredentials.accessToken,
      slackAppConfigId: schema.connectorCredentials.slackAppConfigId,
      lastRefreshedAt: schema.connectorCredentials.lastRefreshedAt,
      connectedAt: schema.connectorCredentials.connectedAt,
    })
    .from(schema.connectorCredentials)
    .where(and(...whereParts));

  const token = pickCredentials(credRows, slackAppConfigId);
  if (!token) return null;
  return { organizationId: orgId, accessToken: token };
}

export async function fetchOrgName(db: DB, organizationId: string): Promise<string> {
  const rows = await db
    .select({ name: schema.organization.name })
    .from(schema.organization)
    .where(eq(schema.organization.id, organizationId))
    .limit(1);
  return rows[0]?.name ?? 'this organization';
}
