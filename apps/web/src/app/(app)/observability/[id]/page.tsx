import { headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import { and, eq } from 'drizzle-orm';
import { schema } from '@holo/db';
import { getServerContext } from '@/lib/server-context';
import { resolveActiveOrgId } from '@/lib/active-org';
import { ReplayPanels } from '@/components/replay-panels';

interface ReplayPageProps {
  params: Promise<{ id: string }>;
}

function formatUtc(date: Date): string {
  return date.toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC');
}

export default async function ReplayPage({ params }: ReplayPageProps) {
  const { id } = await params;
  const { auth, db} = await getServerContext();
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in');

  const orgId = resolveActiveOrgId(session);
  if (!orgId) redirect('/sign-in');

  const [invocation] = await db
    .select()
    .from(schema.mcpInvocations)
    .where(
      and(
        eq(schema.mcpInvocations.id, id),
        eq(schema.mcpInvocations.organizationId, orgId),
      ),
    )
    .limit(1);

  if (!invocation) notFound();

  const isError = !!invocation.errorCode;

  return (
    <div className="space-y-8">
      <header className="flex flex-col gap-3">
        <Link
          href="/observability"
          className="text-[13px] text-text-muted hover:text-text"
        >
          ← Observability
        </Link>
        <span className="caption">Replay</span>
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h1 className="font-display text-h1 font-semibold tracking-tight">
            {invocation.toolName}
          </h1>
          <span
            className="inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium"
            style={{
              background: isError
                ? 'color-mix(in srgb, var(--error) 12%, transparent)'
                : 'color-mix(in srgb, var(--success) 12%, transparent)',
              color: isError ? 'var(--error)' : 'var(--success)',
            }}
          >
            {isError ? 'error' : 'success'}
          </span>
        </div>
        <p className="text-[13px] text-text-muted">
          Replay ID <span className="font-mono">{invocation.id}</span>
        </p>
      </header>

      <dl className="grid grid-cols-1 gap-px overflow-hidden rounded border border-border bg-border sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Timestamp (UTC)" value={formatUtc(invocation.createdAt)} mono />
        <Field
          label="Agent identity"
          value={invocation.agentIdentity ?? '—'}
        />
        <Field
          label="Latency"
          value={`${invocation.latencyMs} ms`}
          mono
        />
        <Field
          label="Error code"
          value={invocation.errorCode ?? '—'}
          mono
          tone={isError ? 'error' : undefined}
        />
      </dl>

      <ReplayPanels
        inputJson={invocation.inputJson}
        outputJson={invocation.outputJson}
        errorCode={invocation.errorCode}
      />

      <p className="text-[12px] text-text-subtle">
        Read-only replay. Live re-execution against current data is on the v0.2 roadmap.
      </p>
    </div>
  );
}

function Field({
  label,
  value,
  mono,
  tone,
}: {
  label: string;
  value: string;
  mono?: boolean;
  tone?: 'error';
}) {
  return (
    <div className="bg-bg p-4">
      <dt className="caption text-text-subtle">{label}</dt>
      <dd
        className={`mt-1 text-[13px] ${mono ? 'font-mono' : ''}`}
        style={{ color: tone === 'error' ? 'var(--error)' : 'var(--text)' }}
      >
        {value}
      </dd>
    </div>
  );
}
