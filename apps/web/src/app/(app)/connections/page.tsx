import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { eq, and, isNull } from 'drizzle-orm';
import { schema, getSampleDataStatus } from '@holo/db';
import { getServerContext } from '@/lib/server-context';
import { resolveActiveOrgId } from '@/lib/active-org';
import { CONNECTORS } from '@/lib/connector-registry';
import { ConnectorBrowser, type ConnectorBrowserItem } from '@/components/connector-browser';
import { SlackOnboardingTrigger } from '@/components/slack-onboarding-trigger';
import { ConnectErrorBanner } from '@/components/connect-error-banner';
import { SampleConnectorRow } from '@/components/sample-connector-row';
import { loadLatestSyncStatusByProvider } from '@/lib/sync-status';

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

  // Google connectors use service accounts (org-scoped, no userId) — same
  // shape as GitHub installations. Any active SA row for the org means the
  // connector is connected for everyone.
  const serviceAccountRows = await db
    .select({ provider: schema.connectorServiceAccounts.provider })
    .from(schema.connectorServiceAccounts)
    .where(
      and(
        eq(schema.connectorServiceAccounts.organizationId, orgId),
        eq(schema.connectorServiceAccounts.status, 'active'),
      ),
    );
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
  // `connector_cursors.last_status` is only written on successful syncs (the
  // worker's cursor upsert hard-codes `status: 'ok'`), so failures never
  // surface there. Overlay the latest *finished* sync_runs row per provider
  // to expose 'failed' / 'stalled' on the card. A non-ok run wins regardless
  // of timestamp: for providers with multiple queues (github code + prose),
  // a healthy queue's cursor will almost always be newer than the failing
  // queue's last run, and we want the failure to surface.
  const latestRunByProvider = await loadLatestSyncStatusByProvider(db, orgId);
  for (const [provider, run] of latestRunByProvider) {
    const cur = lastSyncByProvider.get(provider);
    const runIsBad = run.status !== 'ok';
    if (!cur || runIsBad || run.finishedAt >= cur.at) {
      lastSyncByProvider.set(provider, {
        at: cur && runIsBad ? cur.at : run.finishedAt,
        status: run.status,
      });
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

  // Open disconnect-cleanup jobs (worker hasn't finished) — render those rows
  // in "Disconnecting…" state on first paint instead of flashing the
  // pre-disconnect "Connected" UI for one polling tick.
  const disconnectingRows = await db
    .select({ provider: schema.connectorDisconnectJobs.provider })
    .from(schema.connectorDisconnectJobs)
    .where(
      and(
        eq(schema.connectorDisconnectJobs.organizationId, orgId),
        isNull(schema.connectorDisconnectJobs.finishedAt),
      ),
    );
  const disconnectingProviders = new Set(disconnectingRows.map((r) => r.provider));

  // Maps are keyed by raw provider strings so lookups by any
  // ConnectorMeta['id'] — including the "coming soon" tiles whose IDs aren't
  // in SYNC_PROVIDERS — typecheck cleanly. Unimplemented connectors simply
  // miss the lookup (they have no DB rows) and render in the disconnected
  // state, which the row component reinterprets as "Coming soon".
  const connected = new Map<string, boolean>(
    credRows
      .filter(
        (r) =>
          r.status === 'active' &&
          r.provider !== 'github' &&
          r.provider !== 'googledrive' &&
          r.provider !== 'google-chat',
      )
      .map((r) => [r.provider, true]),
  );
  if (githubConnected) connected.set('github', true);
  for (const sa of serviceAccountRows) connected.set(sa.provider, true);
  const sourceName = new Map<string, string>(sourceRows.map((r) => [r.provider, r.name]));
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
          Connect the tools your team&apos;s work lives in. holo ingests and indexes them so your
          agents can retrieve real context.
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
      {!hideSampleData ? (
        <SampleConnectorRow
          installed={sampleStatus.active}
          artifactCount={sampleStatus.artifactCount}
          installedAt={sampleStatus.installedAt}
          kindBreakdown={sampleStatus.kindBreakdown}
        />
      ) : null}
      <ConnectorBrowser
        showSampleNav={!hideSampleData}
        items={CONNECTORS.map<ConnectorBrowserItem>((meta) => ({
          meta,
          status: connected.get(meta.id) ? 'connected' : 'disconnected',
          connectedAs: sourceName.get(meta.id),
          allowlist: allowlistByProvider.get(meta.id) ?? [],
          lastSyncedAt: lastSyncByProvider.get(meta.id)?.at.toISOString() ?? null,
          lastSyncStatus: lastSyncByProvider.get(meta.id)?.status ?? null,
          initialDisconnecting: disconnectingProviders.has(meta.id),
        }))}
      />
    </div>
  );
}
