import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { schema } from '@holo/db';
import { getServerContext } from '@/lib/server-context';
import { SkillLabelPanel } from '@/components/skill-label-panel';
import { PublishButton } from '@/components/publish-button';

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
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Skills</h1>
        <p className="text-sm text-gray-500">
          Procedures extracted from your team&apos;s actual work.
        </p>
      </div>

      {skills.length > 0 ? (
        <div className="rounded-md border border-gray-200 dark:border-gray-800 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-900">
              <tr className="border-b border-gray-200 dark:border-gray-800 text-left">
                <th className="px-4 py-2 font-medium text-gray-500 dark:text-gray-400">Name</th>
                <th className="px-4 py-2 font-medium text-gray-500 dark:text-gray-400">Slug</th>
                <th className="px-4 py-2 font-medium text-gray-500 dark:text-gray-400">Status</th>
                <th className="px-4 py-2 font-medium text-gray-500 dark:text-gray-400">Labels</th>
                <th className="px-4 py-2 font-medium text-gray-500 dark:text-gray-400">Updated</th>
                <th className="px-4 py-2 font-medium text-gray-500 dark:text-gray-400">Marketplace</th>
              </tr>
            </thead>
            <tbody>
              {skills.map((s) => (
                <tr
                  key={s.id}
                  className="border-b border-gray-100 dark:border-gray-900 last:border-0 hover:bg-gray-50 dark:hover:bg-gray-900/50"
                >
                  <td className="px-4 py-2 font-medium">{s.name}</td>
                  <td className="px-4 py-2 font-mono text-xs text-gray-500 dark:text-gray-400">{s.slug}</td>
                  <td className="px-4 py-2">
                    <span
                      className={
                        s.status === 'active'
                          ? 'text-green-600 dark:text-green-400'
                          : 'text-gray-400 dark:text-gray-500'
                      }
                    >
                      {s.status}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-gray-500 dark:text-gray-400">
                    {labelCountMap.get(s.slug) ?? 0}
                  </td>
                  <td className="px-4 py-2 text-gray-400 dark:text-gray-500 text-xs">
                    {s.updatedAt.toLocaleDateString()}
                  </td>
                  <td className="px-4 py-2">
                    <PublishButton skillId={s.id} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-sm text-gray-500 dark:text-gray-400">
          No skills yet. Label example artifacts below to create your first skill.
        </p>
      )}

      <SkillLabelPanel />
    </div>
  );
}
