import { Suspense } from 'react';
import Link from 'next/link';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { ArrowUpRight, Plug, Activity, Sparkles, ScrollText, type LucideIcon } from 'lucide-react';
import { getServerContext } from '@/lib/server-context';
import { resolveActiveOrgId } from '@/lib/active-org';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { StatsSection, StatsSkeleton } from './_components/stats-section';
import { RecentInvocations, RecentInvocationsSkeleton } from './_components/recent-invocations';

export default async function DashboardPage() {
  const { auth, defaultOrgId } = await getServerContext();
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in');
  const orgId = resolveActiveOrgId(session, defaultOrgId);
  if (!orgId) redirect('/sign-in');

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

      <Suspense fallback={<StatsSkeleton />}>
        <StatsSection orgId={orgId} />
      </Suspense>

      <section className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Suspense fallback={<RecentInvocationsSkeleton />}>
          <RecentInvocations orgId={orgId} />
        </Suspense>

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
