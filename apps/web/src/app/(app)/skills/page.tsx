import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import { schema } from '@holo/db';
import { getServerContext } from '@/lib/server-context';
import { resolveActiveOrgId } from '@/lib/active-org';
import { Badge } from '@/components/ui/badge';
import { SkillStatusPill } from './_components/skill-status-pill';

export const dynamic = 'force-dynamic';

export default async function SkillsListPage() {
  const { auth, db } = await getServerContext();
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in?callbackURL=/skills');
  const orgId = resolveActiveOrgId(session);

  // Skills the org owns. The unique index is (org, slug, version) so multiple
  // rows per slug are expected (history). v1 dedupes to the latest version per
  // slug — versioning history viewer is explicitly out of scope (RFC-0005).
  const rows = await db
    .select({
      id: schema.skills.id,
      slug: schema.skills.slug,
      name: schema.skills.name,
      status: schema.skills.status,
      version: schema.skills.version,
      updatedAt: schema.skills.updatedAt,
      updatedBy: schema.skills.updatedBy,
      createdBy: schema.skills.createdBy,
      parentSkillId: schema.skills.parentSkillId,
      archivedAt: schema.skills.archivedAt,
    })
    .from(schema.skills)
    .where(and(eq(schema.skills.organizationId, orgId), isNull(schema.skills.archivedAt)))
    .orderBy(desc(schema.skills.updatedAt));

  const latestBySlug = new Map<string, (typeof rows)[number]>();
  for (const r of rows) {
    const cur = latestBySlug.get(r.slug);
    if (!cur || cur.version < r.version) latestBySlug.set(r.slug, r);
  }
  const skills = Array.from(latestBySlug.values());

  // Editor display names. Resolve in a single query.
  const userIds = Array.from(
    new Set(skills.flatMap((s) => [s.updatedBy, s.createdBy]).filter((x): x is string => !!x)),
  );
  const userRows = userIds.length
    ? await db
        .select({ id: schema.user.id, name: schema.user.name, email: schema.user.email })
        .from(schema.user)
        .where(inArray(schema.user.id, userIds))
    : [];
  const userById = new Map(userRows.map((u) => [u.id, u.name || u.email]));

  // Last-used: latest skill_run per skill. The run table is org-scoped so this
  // is a one-query fetch + client-side reduce.
  const runRows = skills.length
    ? await db
        .select({
          skillId: schema.skillRuns.skillId,
          startedAt: schema.skillRuns.startedAt,
        })
        .from(schema.skillRuns)
        .where(eq(schema.skillRuns.organizationId, orgId))
    : [];
  const lastUsedBySkill = new Map<string, Date>();
  for (const r of runRows) {
    const cur = lastUsedBySkill.get(r.skillId);
    if (!cur || cur < r.startedAt) lastUsedBySkill.set(r.skillId, r.startedAt);
  }

  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <span className="caption">Agent runtime</span>
        <h1 className="font-display text-h1 font-semibold tracking-tight">Skills</h1>
        <p className="max-w-2xl text-[15px] leading-6 text-text-muted">
          Reusable agent procedures for this workspace. Fork an org-active skill to
          experiment, edit defaults without touching YAML, and promote the result
          when it&apos;s ready.
        </p>
      </header>

      {skills.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="overflow-hidden rounded-lg border border-border">
          <table className="w-full text-[13px]">
            <thead className="bg-surface-2 text-text-subtle">
              <tr>
                <Th>Name</Th>
                <Th>Status</Th>
                <Th>Version</Th>
                <Th>Last edited</Th>
                <Th>Last used</Th>
                <Th className="text-right">Action</Th>
              </tr>
            </thead>
            <tbody>
              {skills.map((s) => {
                const editor = s.updatedBy ?? s.createdBy;
                const editorLabel = editor ? userById.get(editor) ?? '—' : '—';
                const lastUsed = lastUsedBySkill.get(s.id);
                return (
                  <tr key={s.id} className="border-t border-border hover:bg-surface-2/60">
                    <td className="px-4 py-3">
                      <Link
                        href={`/skills/${s.slug}`}
                        className="font-medium text-text hover:text-accent"
                      >
                        {s.name}
                      </Link>
                      <div className="text-text-subtle">
                        <code className="font-mono text-[12px]">{s.slug}</code>
                        {s.parentSkillId ? (
                          <span className="ml-2 text-text-subtle">· fork</span>
                        ) : null}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <SkillStatusPill status={s.status} />
                    </td>
                    <td className="px-4 py-3 text-text-muted tabular-nums">v{s.version}</td>
                    <td className="px-4 py-3 text-text-muted">
                      <div>{new Date(s.updatedAt).toISOString().slice(0, 10)}</div>
                      <div className="text-text-subtle">{editorLabel}</div>
                    </td>
                    <td className="px-4 py-3 text-text-muted tabular-nums">
                      {lastUsed ? new Date(lastUsed).toISOString().slice(0, 10) : '—'}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link
                        href={`/chat?skill=${encodeURIComponent(s.slug)}`}
                        className="mr-3 text-text-muted hover:text-accent"
                      >
                        Run
                      </Link>
                      <Link
                        href={`/skills/${s.slug}`}
                        className="text-text-muted hover:text-accent"
                      >
                        Open
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="rounded-lg border border-border bg-surface px-6 py-10 text-center">
      <Badge variant="neutral">No skills yet</Badge>
      <p className="mx-auto mt-3 max-w-md text-[13px] text-text-muted">
        Skills get synthesized from your team&apos;s artifacts (see auto-extract) or
        added by hand. Once you have one, you can fork, edit, and promote it
        without leaving this page.
      </p>
    </div>
  );
}

function Th({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <th
      className={
        'caption px-4 py-3 text-left font-medium text-text-subtle' +
        (className ? ` ${className}` : '')
      }
    >
      {children}
    </th>
  );
}
