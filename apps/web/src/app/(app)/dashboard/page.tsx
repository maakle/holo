import Link from 'next/link';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { count, desc, eq } from 'drizzle-orm';
import { schema } from '@holo/db';
import { ArrowUpRight, Plug, Activity, Sparkles, ScrollText, type LucideIcon } from 'lucide-react';
import { getServerContext } from '@/lib/server-context';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

export default async function DashboardPage() {
  const { auth, db } = await getServerContext();
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in');
  const orgId = (session.user as unknown as { organizationId?: string }).organizationId;
  if (!orgId) redirect('/sign-in');

  const [connectedRows, skillRows, invocationRows, recentInvocations] = await Promise.all([
    db
      .select({ value: count() })
      .from(schema.connectorCredentials)
      .where(eq(schema.connectorCredentials.organizationId, orgId)),
    db.select({ value: count() }).from(schema.skills).where(eq(schema.skills.organizationId, orgId)),
    db
      .select({ value: count() })
      .from(schema.mcpInvocations)
      .where(eq(schema.mcpInvocations.organizationId, orgId)),
    db
      .select({
        id: schema.mcpInvocations.id,
        toolName: schema.mcpInvocations.toolName,
        latencyMs: schema.mcpInvocations.latencyMs,
        errorCode: schema.mcpInvocations.errorCode,
        createdAt: schema.mcpInvocations.createdAt,
      })
      .from(schema.mcpInvocations)
      .where(eq(schema.mcpInvocations.organizationId, orgId))
      .orderBy(desc(schema.mcpInvocations.createdAt))
      .limit(5),
  ]);

  const stats = [
    {
      label: 'Connections',
      value: connectedRows[0]?.value ?? 0,
      icon: Plug,
      href: '/connections',
      delta: null,
    },
    {
      label: 'Skills',
      value: skillRows[0]?.value ?? 0,
      icon: Sparkles,
      href: '/skills',
      delta: null,
    },
    {
      label: 'Invocations · 7d',
      value: invocationRows[0]?.value ?? 0,
      icon: Activity,
      href: '/observability',
      delta: null,
    },
  ] as const;

  return (
    <div className="space-y-10">
      <header className="flex flex-col gap-2">
        <span className="caption">Overview</span>
        <h1 className="font-display text-h1 font-semibold tracking-tight">Welcome back.</h1>
        <p className="max-w-2xl text-[15px] leading-6 text-text-muted">
          holo is your team&apos;s context layer for AI agents. Connect tools, extract skills,
          and watch every agent invocation in one place.
        </p>
      </header>

      <section className="grid grid-cols-1 gap-3 md:grid-cols-3">
        {stats.map(({ label, value, icon: Icon, href, delta }) => (
          <Link
            key={label}
            href={href}
            className="group rounded-md border border-border bg-surface p-5 transition-colors duration-micro hover:border-border-strong"
          >
            <div className="flex items-center justify-between">
              <span className="caption">{label}</span>
              <Icon className="h-4 w-4 text-text-subtle" />
            </div>
            <div className="mt-3 flex items-end justify-between gap-3">
              <div className="flex items-baseline gap-2">
                <span className="font-display text-display-2 font-semibold tabular-nums leading-none">
                  {value}
                </span>
                {delta !== null ? <DeltaBadge value={delta} /> : null}
              </div>
              <ArrowUpRight className="h-4 w-4 text-text-subtle opacity-0 transition-opacity duration-micro group-hover:opacity-100" />
            </div>
          </Link>
        ))}
      </section>

      <section className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <div className="flex flex-col gap-1">
              <CardTitle>Recent invocations</CardTitle>
              <CardDescription>Last 5 MCP tool calls from your agents.</CardDescription>
            </div>
            <Button variant="ghost" size="sm" asChild>
              <Link href="/observability">View all →</Link>
            </Button>
          </CardHeader>
          <CardContent className="px-0">
            {recentInvocations.length === 0 ? (
              <div className="px-5 py-10 text-center">
                <p className="text-[13px] text-text-muted">
                  No invocations yet. Connect an agent to see live activity.
                </p>
                <Button variant="primary" size="sm" className="mt-4" asChild>
                  <Link href="/connect-agent">Connect agent</Link>
                </Button>
              </div>
            ) : (
              <ul className="divide-y divide-border border-t border-border">
                {recentInvocations.map((inv) => (
                  <li
                    key={inv.id}
                    className="flex items-center justify-between gap-4 px-5 py-3 text-[13px] hover:bg-surface-2"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <Badge variant={inv.errorCode ? 'error' : 'success'}>
                        {inv.errorCode ? 'error' : 'ok'}
                      </Badge>
                      <span className="font-mono truncate text-text">{inv.toolName}</span>
                    </div>
                    <div className="flex shrink-0 items-center gap-4 text-text-muted">
                      <span className="font-mono tabular-nums">{inv.latencyMs}ms</span>
                      <time className="font-mono text-text-subtle">
                        {inv.createdAt.toISOString().slice(11, 19)}
                      </time>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Quick actions</CardTitle>
            <CardDescription>Get your team to first value.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-1">
            <QuickAction href="/connections" icon={Plug} label="Connect a tool" hint="GitHub, Slack, Notion…" />
            <QuickAction href="/skills" icon={Sparkles} label="Label a skill" hint="Turn artifacts into procedures" />
            <QuickAction href="/connect-agent" icon={Activity} label="Connect your agent" hint="Point any MCP client at holo" />
            <QuickAction href="/audit" icon={ScrollText} label="Review audit log" hint="Security & data-access events" />
          </CardContent>
        </Card>
      </section>
    </div>
  );
}

function DeltaBadge({ value }: { value: number }) {
  const positive = value >= 0;
  return (
    <span
      className="rounded-sm px-1.5 py-0.5 font-mono text-[11px] font-medium tabular-nums"
      style={{
        background: positive
          ? 'color-mix(in srgb, var(--success) 12%, transparent)'
          : 'color-mix(in srgb, var(--error) 12%, transparent)',
        color: positive ? 'var(--success)' : 'var(--error)',
      }}
    >
      {positive ? '+' : ''}
      {value}%
    </span>
  );
}

function QuickAction({
  href,
  icon: Icon,
  label,
  hint,
}: {
  href: string;
  icon: LucideIcon;
  label: string;
  hint: string;
}) {
  return (
    <Link
      href={href}
      className="-mx-2 flex items-center gap-3 rounded-md px-2 py-2 text-[13px] transition-colors duration-micro hover:bg-surface-2"
    >
      <Icon className="h-4 w-4 text-text-subtle" />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="text-text">{label}</span>
        <span className="text-[12px] text-text-subtle">{hint}</span>
      </div>
      <ArrowUpRight className="h-3.5 w-3.5 text-text-subtle" strokeWidth={1.75} />
    </Link>
  );
}
