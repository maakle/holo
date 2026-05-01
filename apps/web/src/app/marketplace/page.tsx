import { desc, eq } from 'drizzle-orm';
import { schema } from '@holo/db';
import { getServerContext } from '@/lib/server-context';

function parseDescription(redactedContent: string): string {
  const descMatch = redactedContent.match(/^description:\s*(.+)$/m);
  return descMatch?.[1]?.trim() ?? '';
}

export default async function MarketplacePage() {
  const { db } = await getServerContext();

  const published = await db
    .select({
      id: schema.publishedSkills.id,
      redactedContent: schema.publishedSkills.redactedContent,
      publishedAt: schema.publishedSkills.publishedAt,
      name: schema.skills.name,
      slug: schema.skills.slug,
    })
    .from(schema.publishedSkills)
    .innerJoin(schema.skills, eq(schema.publishedSkills.skillId, schema.skills.id))
    .orderBy(desc(schema.publishedSkills.publishedAt))
    .limit(50);

  return (
    <div className="min-h-screen bg-white dark:bg-gray-950 text-gray-900 dark:text-gray-100">
      <div className="max-w-5xl mx-auto px-6 py-16">
        <div className="mb-12">
          <h1 className="text-2xl font-semibold tracking-tight">Skill Marketplace</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">
            Community-contributed agent skills, ready to use.
          </p>
        </div>

        {published.length === 0 ? (
          <p className="text-sm text-gray-400 dark:text-gray-500">
            No skills published yet. Be the first.
          </p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {published.map((row) => {
              const description = parseDescription(row.redactedContent);
              const formattedDate = row.publishedAt.toLocaleDateString('en-US', {
                year: 'numeric',
                month: 'short',
                day: 'numeric',
              });
              return (
                <div
                  key={row.id}
                  className="rounded border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-5 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors"
                >
                  <h2 className="text-sm font-semibold mb-1">{row.name}</h2>
                  {description && (
                    <p className="text-xs text-gray-500 dark:text-gray-400 mb-3 leading-relaxed">
                      {description}
                    </p>
                  )}
                  <span className="text-xs text-gray-400 dark:text-gray-500 tabular-nums uppercase tracking-wide font-medium">
                    {formattedDate}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
