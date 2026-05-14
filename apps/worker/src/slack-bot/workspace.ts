import { eq, and, isNull, type SQL } from 'drizzle-orm';
import { schema, type DB } from '@holo/db';

export interface WorkspaceCreds {
  organizationId: string;
  accessToken: string;
}

export interface CredentialRow {
  organizationId: string;
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
): WorkspaceCreds | null {
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
  const top = filtered[0]!;
  return { organizationId: top.organizationId, accessToken: top.accessToken };
}

/**
 * Resolve which workspace this Slack team_id maps to, and which token to
 * post with.
 *
 * The naive approach — `team_id → sources → org_id → credentials` — breaks
 * down when a single Slack workspace is installed under multiple Holo orgs
 * (e.g. once via the shared app under org A, then again via an EE custom app
 * under org B). Both orgs have a `sources` row keyed by the same team_id, and
 * picking one with LIMIT 1 routes events to the wrong org's credentials.
 *
 * Instead we join sources → credentials in one query and require both the
 * team_id match AND the slack_app_config_id match (NULL for shared, specific
 * UUID for custom). That uniquely identifies the install regardless of how
 * many orgs have a sources row for this team.
 */
export async function resolveWorkspace(
  db: DB,
  teamId: string,
  slackAppConfigId: string | null | undefined,
): Promise<WorkspaceCreds | null> {
  const whereParts: SQL[] = [
    eq(schema.sources.provider, 'slack'),
    eq(schema.sources.externalId, teamId),
    eq(schema.connectorCredentials.provider, 'slack'),
    eq(schema.connectorCredentials.status, 'active'),
  ];
  if (slackAppConfigId === null) {
    whereParts.push(isNull(schema.connectorCredentials.slackAppConfigId));
  } else if (typeof slackAppConfigId === 'string') {
    whereParts.push(eq(schema.connectorCredentials.slackAppConfigId, slackAppConfigId));
  }
  // `undefined` keeps the pre-hint behavior for in-flight legacy jobs: no
  // slack_app_config_id filter at all, fall back to recency in pickCredentials.

  const credRows = await db
    .select({
      organizationId: schema.connectorCredentials.organizationId,
      accessToken: schema.connectorCredentials.accessToken,
      slackAppConfigId: schema.connectorCredentials.slackAppConfigId,
      lastRefreshedAt: schema.connectorCredentials.lastRefreshedAt,
      connectedAt: schema.connectorCredentials.connectedAt,
    })
    .from(schema.connectorCredentials)
    .innerJoin(
      schema.sources,
      eq(schema.sources.organizationId, schema.connectorCredentials.organizationId),
    )
    .where(and(...whereParts));

  return pickCredentials(credRows, slackAppConfigId);
}

export async function fetchOrgName(db: DB, organizationId: string): Promise<string> {
  const rows = await db
    .select({ name: schema.organization.name })
    .from(schema.organization)
    .where(eq(schema.organization.id, organizationId))
    .limit(1);
  return rows[0]?.name ?? 'this organization';
}
