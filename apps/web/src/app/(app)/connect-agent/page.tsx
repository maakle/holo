import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { and, eq, ne, sql } from 'drizzle-orm';
import { schema, SAMPLE_PROVIDER } from '@holo/db';
import { getServerContext } from '@/lib/server-context';
import { resolveActiveOrgId } from '@/lib/active-org';
import { ConnectAgentPanel } from '@/components/connect-agent-panel';
import {
  ConnectAgentBanner,
  type ConnectAgentBannerInitial,
} from '@/components/connect-agent-banner';

export default async function ConnectAgentPage() {
  const { auth, db} = await getServerContext();
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in');
  const orgId = resolveActiveOrgId(session);

  const gatewayBase = process.env['MCP_PUBLIC_URL']?.replace(/\/+$/, '')
    ?? 'http://localhost:8080';
  const mcpUrl = `${gatewayBase}/mcp`;

  const initial = await loadBannerInitial(db, orgId);

  return (
    <div className="space-y-8">
      <header className="flex flex-col gap-2">
        <span className="caption">Connect agent</span>
        <h1 className="font-display text-h1 font-semibold tracking-tight">
          Point your agent at holo
        </h1>
        <p className="max-w-2xl text-[15px] leading-6 text-text-muted">
          holo speaks the Model Context Protocol and a small REST surface. Test the gateway,
          then wire up your client below.
        </p>
      </header>
      <ConnectAgentBanner initial={initial} />
      <ConnectAgentPanel mcpUrl={mcpUrl} gatewayBase={gatewayBase} orgId={orgId} />
    </div>
  );
}

async function loadBannerInitial(
  db: Awaited<ReturnType<typeof getServerContext>>['db'],
  orgId: string,
): Promise<ConnectAgentBannerInitial> {
  // "Real connector" = anything other than our synthetic sample provider:
  // active connector_credentials OR a github_installations row OR an active
  // connector_service_accounts row (Google Drive / Google Chat).
  const [credCount, ghCount, saCount, sampleSource, realChunkRow] = await Promise.all([
    db
      .select({ c: sql<number>`count(*)::int` })
      .from(schema.connectorCredentials)
      .where(
        and(
          eq(schema.connectorCredentials.organizationId, orgId),
          eq(schema.connectorCredentials.status, 'active'),
        ),
      ),
    db
      .select({ c: sql<number>`count(*)::int` })
      .from(schema.githubInstallations)
      .where(eq(schema.githubInstallations.organizationId, orgId)),
    db
      .select({ c: sql<number>`count(*)::int` })
      .from(schema.connectorServiceAccounts)
      .where(
        and(
          eq(schema.connectorServiceAccounts.organizationId, orgId),
          eq(schema.connectorServiceAccounts.status, 'active'),
        ),
      ),
    db
      .select({ id: schema.sources.id })
      .from(schema.sources)
      .where(
        and(
          eq(schema.sources.organizationId, orgId),
          eq(schema.sources.provider, SAMPLE_PROVIDER),
        ),
      )
      .limit(1),
    db
      .select({ c: sql<number>`count(*)::int` })
      .from(schema.chunks)
      .where(
        and(
          eq(schema.chunks.organizationId, orgId),
          ne(schema.chunks.provider, SAMPLE_PROVIDER),
        ),
      ),
  ]);

  const hasRealConnector =
    (credCount[0]?.c ?? 0) > 0 ||
    (ghCount[0]?.c ?? 0) > 0 ||
    (saCount[0]?.c ?? 0) > 0;

  return {
    hasRealConnector,
    realChunksIndexed: realChunkRow[0]?.c ?? 0,
    sampleActive: sampleSource.length > 0,
  };
}
