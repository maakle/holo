import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { eq, and } from 'drizzle-orm';
import { schema } from '@holo/db';
import { getServerContext } from '@/lib/server-context';
import { CONNECTORS } from '@/lib/connector-registry';
import { ConnectorRow } from '@/components/connector-row';

export default async function ConnectionsPage({
  searchParams,
}: {
  searchParams: Promise<{ connect_error?: string; connect_fix?: string }>;
}) {
  const sp = await searchParams;
  const { auth, db } = await getServerContext();
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in');

  const userId = session.user.id;
  const orgId = (session.user as unknown as { organizationId: string }).organizationId;

  const credRows = await db
    .select({
      provider: schema.connectorCredentials.provider,
      status: schema.connectorCredentials.status,
    })
    .from(schema.connectorCredentials)
    .where(
      and(
        eq(schema.connectorCredentials.organizationId, orgId),
        eq(schema.connectorCredentials.userId, userId),
      ),
    );
  const sourceRows = await db
    .select({ provider: schema.sources.provider, name: schema.sources.name })
    .from(schema.sources)
    .where(eq(schema.sources.organizationId, orgId));

  const connected = new Map(
    credRows.filter((r) => r.status === 'active').map((r) => [r.provider, true]),
  );
  const sourceName = new Map(sourceRows.map((r) => [r.provider, r.name]));

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Connections</h1>
        <p className="text-sm text-gray-500">
          Connect the tools your team's work lives in.
        </p>
      </div>
      {sp.connect_error ? (
        <div className="rounded-md border border-red-300 bg-red-50 p-3 text-sm dark:border-red-800 dark:bg-red-950">
          <div className="font-medium text-red-700 dark:text-red-200">{sp.connect_error}</div>
          {sp.connect_fix ? (
            <div className="text-red-700 dark:text-red-300">{sp.connect_fix}</div>
          ) : null}
        </div>
      ) : null}
      <div className="space-y-2">
        {CONNECTORS.map((meta) => (
          <ConnectorRow
            key={meta.id}
            meta={meta}
            status={connected.get(meta.id) ? 'connected' : 'disconnected'}
            connectedAs={sourceName.get(meta.id)}
          />
        ))}
      </div>
    </div>
  );
}
