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
    <div className="space-y-8">
      <header className="flex flex-col gap-2">
        <span className="caption">Connections</span>
        <h1 className="font-display text-h1 font-semibold tracking-tight">Connect your tools</h1>
        <p className="max-w-2xl text-[15px] leading-6 text-text-muted">
          Connect the tools your team&apos;s work lives in. holo ingests and indexes them so
          your agents can retrieve real context.
        </p>
      </header>
      {sp.connect_error ? (
        <div className="rounded-md border border-error/30 bg-[color-mix(in_srgb,var(--error)_10%,transparent)] p-4 text-[13px]">
          <div className="font-medium text-error">{sp.connect_error}</div>
          {sp.connect_fix ? (
            <div className="mt-1 text-error/80">{sp.connect_fix}</div>
          ) : null}
        </div>
      ) : null}
      <div className="overflow-hidden rounded-md border border-border bg-surface">
        {CONNECTORS.map((meta, idx) => (
          <div key={meta.id} className={idx > 0 ? 'border-t border-border' : undefined}>
            <ConnectorRow
              meta={meta}
              status={connected.get(meta.id) ? 'connected' : 'disconnected'}
              connectedAs={sourceName.get(meta.id)}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
