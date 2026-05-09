import { eq, and } from 'drizzle-orm';
import { schema, type DB } from '@holo/db';

export interface WorkspaceCreds {
  organizationId: string;
  accessToken: string;
}

/**
 * Resolve which workspace this Slack team_id maps to. We trust whichever
 * connectorCredentials row was registered with this team — the install path
 * upserts a `sources` row keyed by team_id, and connectorCredentials is
 * already scoped per (org, provider). Multiple users in one org could each
 * own a credentials row, but they all hold tokens for the same workspace, so
 * any of them works for outbound posting; we pick the most recently
 * refreshed one to maximize the chance the token is still valid.
 */
export async function resolveWorkspace(
  db: DB,
  teamId: string,
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

  const credRows = await db
    .select({
      accessToken: schema.connectorCredentials.accessToken,
      lastRefreshedAt: schema.connectorCredentials.lastRefreshedAt,
      connectedAt: schema.connectorCredentials.connectedAt,
    })
    .from(schema.connectorCredentials)
    .where(
      and(
        eq(schema.connectorCredentials.organizationId, orgId),
        eq(schema.connectorCredentials.provider, 'slack'),
        eq(schema.connectorCredentials.status, 'active'),
      ),
    );
  const validRows = credRows.filter((r): r is typeof r & { accessToken: string } =>
    typeof r.accessToken === 'string' && r.accessToken.length > 0,
  );
  if (validRows.length === 0) return null;

  validRows.sort((a, b) => {
    const ta = (a.lastRefreshedAt ?? a.connectedAt).getTime();
    const tb = (b.lastRefreshedAt ?? b.connectedAt).getTime();
    return tb - ta;
  });
  const top = validRows[0];
  if (!top) return null;
  return { organizationId: orgId, accessToken: top.accessToken };
}

export async function fetchOrgName(db: DB, organizationId: string): Promise<string> {
  const rows = await db
    .select({ name: schema.organization.name })
    .from(schema.organization)
    .where(eq(schema.organization.id, organizationId))
    .limit(1);
  return rows[0]?.name ?? 'this organization';
}
