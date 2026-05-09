import Link from 'next/link';
import { count, eq } from 'drizzle-orm';
import { schema } from '@holo/db';
import { ArrowUpRight, Plug, Activity, Sparkles } from 'lucide-react';
import { getServerContext } from '@/lib/server-context';

export async function StatsSection({ orgId }: { orgId: string }) {
  const { db } = await getServerContext();
  const [credRows, githubRows, skillRows, invocationRows] = await Promise.all([
    db
      .select({ value: count() })
      .from(schema.connectorCredentials)
      .where(eq(schema.connectorCredentials.organizationId, orgId)),
    db
      .select({ value: count() })
      .from(schema.githubInstallations)
      .where(eq(schema.githubInstallations.organizationId, orgId)),
    db.select({ value: count() }).from(schema.skills).where(eq(schema.skills.organizationId, orgId)),
    db
      .select({ value: count() })
      .from(schema.mcpInvocations)
      .where(eq(schema.mcpInvocations.organizationId, orgId)),
  ]);

  const connectionCount = (credRows[0]?.value ?? 0) + (githubRows[0]?.value ?? 0);

  const stats = [
    { label: 'Connections', value: connectionCount, icon: Plug, href: '/connections' },
    { label: 'Skills', value: skillRows[0]?.value ?? 0, icon: Sparkles, href: '/skills' },
    { label: 'Invocations · 7d', value: invocationRows[0]?.value ?? 0, icon: Activity, href: '/observability' },
  ] as const;

  return (
    <section className="grid grid-cols-1 gap-4 md:grid-cols-3">
      {stats.map(({ label, value, icon: Icon, href }) => (
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
            <span className="font-display text-display-2 font-semibold tabular-nums leading-none">
              {value}
            </span>
            <ArrowUpRight className="h-4 w-4 text-text-subtle opacity-0 transition-opacity duration-micro group-hover:opacity-100" />
          </div>
        </Link>
      ))}
    </section>
  );
}

export function StatsSkeleton() {
  return (
    <section className="grid grid-cols-1 gap-4 md:grid-cols-3">
      {[0, 1, 2].map((i) => (
        <div key={i} className="h-28 rounded-md border border-border bg-surface" />
      ))}
    </section>
  );
}
