import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { schema } from '@holo/db';
import { getServerContext } from '@/lib/server-context';
import { SkillLabelPanel } from '@/components/skill-label-panel';
import { SuggestedProcedures } from '@/components/suggested-procedures';
import { PublishButton } from '@/components/publish-button';
import { Badge } from '@/components/ui/badge';
import Link from 'next/link';
import { Store } from 'lucide-react';

export default async function SkillsPage() {
  const { auth, db } = await getServerContext();
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in');

  const orgId = (session.user as unknown as { organizationId: string }).organizationId;

  const skills = await db
    .select({
      id: schema.skills.id,
      name: schema.skills.name,
      slug: schema.skills.slug,
      version: schema.skills.version,
      status: schema.skills.status,
      updatedAt: schema.skills.updatedAt,
    })
    .from(schema.skills)
    .where(eq(schema.skills.organizationId, orgId))
    .orderBy(schema.skills.updatedAt);

  const labelRows = await db
    .select({
      skillSlug: schema.skillLabels.skillSlug,
    })
    .from(schema.skillLabels)
    .where(eq(schema.skillLabels.organizationId, orgId));

  const labelCountMap = new Map<string, number>();
  for (const row of labelRows) {
    labelCountMap.set(row.skillSlug, (labelCountMap.get(row.skillSlug) ?? 0) + 1);
  }

  return (
    <div className="space-y-8">
      <header className="flex flex-col gap-3">
        <div className="flex items-start justify-between gap-4">
          <div className="flex flex-col gap-2">
            <span className="caption">Skills</span>
            <h1 className="font-display text-h1 font-semibold tracking-tight">
              Procedures extracted from work
            </h1>
          </div>
          <Link
            href="/marketplace"
            className="inline-flex shrink-0 items-center gap-2 rounded-md border border-border bg-surface px-3 py-1.5 text-[13px] text-text-muted transition-colors duration-micro hover:border-border-strong hover:bg-surface-2 hover:text-text"
          >
            <Store className="h-3.5 w-3.5" />
            Marketplace
          </Link>
        </div>
        <p className="max-w-2xl text-[15px] leading-6 text-text-muted">
          Skills are procedures distilled from your team&apos;s actual artifacts. Label examples
          below to teach holo new skills, then publish them to the marketplace.
        </p>
      </header>

      {skills.length > 0 ? (
        <div className="overflow-hidden rounded-md border border-border bg-surface">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-border bg-surface-2/40 text-left">
                {['Name', 'Slug', 'Status', 'Labels', 'Updated', 'Marketplace'].map((c) => (
                  <th
                    key={c}
                    className="px-4 py-3 caption text-text-subtle font-medium"
                  >
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {skills.map((s) => (
                <tr
                  key={s.id}
                  className="border-b border-border last:border-0 transition-colors duration-micro hover:bg-surface-2/40"
                >
                  <td className="px-4 py-3 font-medium text-text">{s.name}</td>
                  <td className="px-4 py-3 font-mono text-[12px] text-text-muted">{s.slug}</td>
                  <td className="px-4 py-3">
                    <Badge variant={s.status === 'active' ? 'success' : 'neutral'}>
                      {s.status}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 tabular-nums text-text-muted">
                    {labelCountMap.get(s.slug) ?? 0}
                  </td>
                  <td className="px-4 py-3 font-mono text-[12px] text-text-subtle tabular-nums">
                    {s.updatedAt.toISOString().slice(0, 10)}
                  </td>
                  <td className="px-4 py-3">
                    <PublishButton skillId={s.id} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="rounded-md border border-border bg-surface px-5 py-8 text-center">
          <p className="text-[13px] text-text-muted">
            No skills yet. Label example artifacts below to create your first skill.
          </p>
        </div>
      )}

      <SuggestedProcedures />

      <SkillLabelPanel />
    </div>
  );
}
