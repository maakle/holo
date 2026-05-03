import Link from 'next/link';
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
    <div className="min-h-screen bg-bg text-text">
      <header className="sticky top-0 z-20 border-b border-border bg-bg/90 backdrop-blur supports-[backdrop-filter]:bg-bg/70">
        <div className="mx-auto flex h-14 max-w-[1024px] items-center justify-between px-6">
          <Link href="/" className="font-display text-[15px] font-semibold tracking-tight">
            holo
          </Link>
          <nav className="flex items-center gap-5 text-[13px] text-text-muted">
            <Link href="/marketplace" className="text-text">
              Marketplace
            </Link>
            <Link href="/sign-in" className="hover:text-text">
              Sign in
            </Link>
          </nav>
        </div>
      </header>
      <div className="mx-auto max-w-[1024px] px-6 py-16">
        <div className="mb-12 flex flex-col gap-2">
          <span className="caption">Marketplace</span>
          <h1 className="font-display text-display-2 font-semibold tracking-tight">
            Skill Marketplace
          </h1>
          <p className="max-w-2xl text-[15px] leading-6 text-text-muted">
            Community-contributed agent skills, ready to use. Procedures distilled from real
            production work, redacted and reviewed.
          </p>
        </div>

        {published.length === 0 ? (
          <div className="rounded-md border border-border bg-surface px-5 py-10 text-center">
            <p className="text-[13px] text-text-muted">
              No skills published yet. Be the first.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {published.map((row) => {
              const description = parseDescription(row.redactedContent);
              const formattedDate = row.publishedAt.toLocaleDateString('en-US', {
                year: 'numeric',
                month: 'short',
                day: 'numeric',
              });
              return (
                <article
                  key={row.id}
                  className="group rounded-md border border-border bg-surface p-5 transition-colors duration-micro hover:border-border-strong"
                >
                  <h2 className="font-display text-[15px] font-semibold tracking-tight">
                    {row.name}
                  </h2>
                  {description && (
                    <p className="mt-2 line-clamp-3 text-[13px] leading-5 text-text-muted">
                      {description}
                    </p>
                  )}
                  <div className="mt-4 flex items-center justify-between">
                    <span className="caption text-text-subtle">{formattedDate}</span>
                    <span className="font-mono text-[12px] text-text-subtle">/{row.slug}</span>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
