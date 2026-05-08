import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { eq, and } from 'drizzle-orm';
import { schema, getSampleDataStatus } from '@holo/db';
import { getServerContext } from '@/lib/server-context';
import { resolveActiveOrgId } from '@/lib/active-org';
import { CONNECTORS, CONNECTOR_CATEGORIES } from '@/lib/connector-registry';
import { ConnectorRow } from '@/components/connector-row';
import { SlackOnboardingTrigger } from '@/components/slack-onboarding-trigger';
import { ConnectErrorBanner } from '@/components/connect-error-banner';
import { SampleConnectorRow } from '@/components/sample-connector-row';

export default async function ConnectionsPage({
  searchParams,
}: {
  searchParams: Promise<{ connect_error?: string; connect_fix?: string }>;
}) {
  const sp = await searchParams;
  const { auth, db} = await getServerContext();
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in');

  const userId = session.user.id;
  const orgId = resolveActiveOrgId(session);

  const [orgRow] = await db
    .select({ metadata: schema.organization.metadata })
    .from(schema.organization)
    .where(eq(schema.organization.id, orgId))
    .limit(1);
  const hideSampleData = Boolean(
    (orgRow?.metadata as { hideSampleData?: boolean } | null)?.hideSampleData,
  );

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

  // GitHub uses GitHub App installations, not connector_credentials. The
  // installation is org-scoped (not per-user) — any installation row for the
  // org means GitHub is connected for everyone in that org.
  const githubInstallRows = await db
    .select({
      id: schema.githubInstallations.id,
      accountLogin: schema.githubInstallations.accountLogin,
    })
    .from(schema.githubInstallations)
    .where(eq(schema.githubInstallations.organizationId, orgId))
    .limit(1);
  const githubConnected = githubInstallRows.length > 0;
  const githubAccountLogin = githubInstallRows[0]?.accountLogin ?? null;
  const sourceRows = await db
    .select({
      id: schema.sources.id,
      provider: schema.sources.provider,
      name: schema.sources.name,
    })
    .from(schema.sources)
    .where(eq(schema.sources.organizationId, orgId));

  const sourceIds = sourceRows.map((s) => s.id);
  const cursorRows = sourceIds.length
    ? await db
        .select({
          sourceId: schema.connectorCursors.sourceId,
          lastRunAt: schema.connectorCursors.lastRunAt,
          lastStatus: schema.connectorCursors.lastStatus,
        })
        .from(schema.connectorCursors)
        .where(eq(schema.connectorCursors.organizationId, orgId))
    : [];
  const lastSyncByProvider = new Map<string, { at: Date; status: string | null }>();
  const sourceProviderById = new Map(sourceRows.map((s) => [s.id, s.provider]));
  for (const c of cursorRows) {
    if (!c.lastRunAt) continue;
    const provider = sourceProviderById.get(c.sourceId);
    if (!provider) continue;
    const cur = lastSyncByProvider.get(provider);
    if (!cur || c.lastRunAt > cur.at) {
      lastSyncByProvider.set(provider, { at: c.lastRunAt, status: c.lastStatus });
    }
  }

  const sampleStatus = hideSampleData
    ? { active: false, artifactCount: 0, installedAt: null, kindBreakdown: [] }
    : await getSampleDataStatus(db, orgId);

  const allowlistRows = await db
    .select({
      provider: schema.connectorAllowlists.provider,
      pattern: schema.connectorAllowlists.pattern,
      patternKind: schema.connectorAllowlists.patternKind,
      decision: schema.connectorAllowlists.decision,
      notes: schema.connectorAllowlists.notes,
    })
    .from(schema.connectorAllowlists)
    .where(eq(schema.connectorAllowlists.organizationId, orgId));

  const connected = new Map(
    credRows
      .filter((r) => r.status === 'active' && r.provider !== 'github')
      .map((r) => [r.provider, true]),
  );
  if (githubConnected) connected.set('github', true);
  const sourceName = new Map(sourceRows.map((r) => [r.provider, r.name]));
  // For GitHub, fall back to the installation's account_login when no
  // source row exists yet (very brief window between install and first sync).
  if (!sourceName.has('github') && githubAccountLogin) {
    sourceName.set('github', githubAccountLogin);
  }
  const allowlistByProvider = new Map<
    string,
    { pattern: string; isGlob: boolean; label: string | null }[]
  >();
  for (const r of allowlistRows) {
    if (r.decision !== 'include') continue;
    const arr = allowlistByProvider.get(r.provider) ?? [];
    arr.push({ pattern: r.pattern, isGlob: r.patternKind === 'glob', label: r.notes });
    allowlistByProvider.set(r.provider, arr);
  }

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
        <ConnectErrorBanner code={sp.connect_error} fix={sp.connect_fix} />
      ) : null}
      <SlackOnboardingTrigger
        slackConnected={Boolean(connected.get('slack'))}
        slackAllowlistEmpty={(allowlistByProvider.get('slack') ?? []).length === 0}
        connectedAs={sourceName.get('slack')}
      />
      <div className="grid grid-cols-1 gap-8 md:grid-cols-[180px_1fr]">
        <nav className="hidden md:block">
          <div className="sticky top-6 flex flex-col gap-1">
            <span className="caption mb-2 text-text-subtle">Categories</span>
            {!hideSampleData ? (
              <a
                href="#cat-sample"
                className="text-[13px] leading-6 text-text-muted transition-colors duration-micro hover:text-text"
              >
                Sample data
              </a>
            ) : null}
            {CONNECTOR_CATEGORIES.filter((c) =>
              CONNECTORS.some((m) => m.category === c.id),
            ).map((cat) => (
              <a
                key={cat.id}
                href={`#cat-${cat.id}`}
                className="text-[13px] leading-6 text-text-muted transition-colors duration-micro hover:text-text"
              >
                {cat.label}
              </a>
            ))}
          </div>
        </nav>

        <div className="flex flex-col gap-8">
          {!hideSampleData ? (
            <SampleConnectorRow
              installed={sampleStatus.active}
              artifactCount={sampleStatus.artifactCount}
              installedAt={sampleStatus.installedAt}
              kindBreakdown={sampleStatus.kindBreakdown}
            />
          ) : null}
          {CONNECTOR_CATEGORIES.map((cat) => {
            const items = CONNECTORS.filter((m) => m.category === cat.id);
            if (items.length === 0) return null;
            return (
              <section
                key={cat.id}
                id={`cat-${cat.id}`}
                className="flex flex-col gap-3 scroll-mt-6"
              >
                <span className="caption text-text-subtle">{cat.label}</span>
                <div className="overflow-hidden rounded-md border border-border bg-surface">
                  {items.map((meta, idx) => (
                    <div
                      key={meta.id}
                      className={idx > 0 ? 'border-t border-border' : undefined}
                    >
                      <ConnectorRow
                        meta={meta}
                        status={connected.get(meta.id) ? 'connected' : 'disconnected'}
                        connectedAs={sourceName.get(meta.id)}
                        allowlist={allowlistByProvider.get(meta.id) ?? []}
                        lastSyncedAt={lastSyncByProvider.get(meta.id)?.at.toISOString() ?? null}
                        lastSyncStatus={lastSyncByProvider.get(meta.id)?.status ?? null}
                      />
                    </div>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
}
