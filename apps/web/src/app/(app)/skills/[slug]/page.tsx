import { headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { schema } from '@holo/db';
import { parseSkill } from '@holo/skills';
import { getServerContext } from '@/lib/server-context';
import { resolveActiveOrgId } from '@/lib/active-org';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { SkillStatusPill } from '../_components/skill-status-pill';
import { canManageSkills, resolveMemberRole } from '../_lib/permissions';
import { ForkButton } from '../_components/fork-button';
import { PromoteButton } from '../_components/promote-button';
import { ArchiveButton } from '../_components/archive-button';
import { CollapsibleBody } from '../_components/collapsible-body';

export const dynamic = 'force-dynamic';

export default async function SkillDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const { auth, db } = await getServerContext();
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect(`/sign-in?callbackURL=/skills/${slug}`);
  const orgId = resolveActiveOrgId(session);
  const role = await resolveMemberRole(db, orgId, session.user.id);
  const canManage = canManageSkills(role);

  // Always show the latest version. Older rows are still queryable for the
  // future history viewer.
  const rows = await db
    .select()
    .from(schema.skills)
    .where(and(eq(schema.skills.organizationId, orgId), eq(schema.skills.slug, slug)))
    .orderBy(desc(schema.skills.version))
    .limit(1);
  const skill = rows[0];
  if (!skill) notFound();

  // Parse the YAML so we can render structured fields. parseSkill throws on
  // malformed content; if a draft has invalid YAML we still render the page
  // with a parse-error banner rather than 500.
  let parsed: ReturnType<typeof parseSkill> | null = null;
  let parseError: string | null = null;
  try {
    parsed = parseSkill(skill.content);
  } catch (e) {
    parseError = e instanceof Error ? e.message : String(e);
  }

  // Forks of this skill (only forks of *this* row, not of older versions).
  const forks = await db
    .select({
      id: schema.skills.id,
      slug: schema.skills.slug,
      name: schema.skills.name,
      status: schema.skills.status,
      version: schema.skills.version,
      updatedAt: schema.skills.updatedAt,
      updatedBy: schema.skills.updatedBy,
      createdBy: schema.skills.createdBy,
    })
    .from(schema.skills)
    .where(
      and(
        eq(schema.skills.organizationId, orgId),
        eq(schema.skills.parentSkillId, skill.id),
      ),
    )
    .orderBy(desc(schema.skills.updatedAt));

  const userIds = Array.from(
    new Set([skill.createdBy, skill.updatedBy, ...forks.flatMap((f) => [f.createdBy, f.updatedBy])].filter(
      (x): x is string => !!x,
    )),
  );
  const userRows = userIds.length
    ? await db
        .select({ id: schema.user.id, name: schema.user.name, email: schema.user.email })
        .from(schema.user)
        .where(inArray(schema.user.id, userIds))
    : [];
  const userById = new Map(userRows.map((u) => [u.id, u.name || u.email]));

  const defaults = parsed?.frontmatter.defaults;
  const tools = parsed?.frontmatter.tools ?? [];
  const allowlist = skill.toolAllowlist ?? [];

  return (
    <div className="max-w-3xl space-y-10">
      <header className="flex flex-col gap-3">
        <span className="caption">
          <Link href="/skills" className="hover:text-accent">
            Skills
          </Link>{' '}
          / {skill.slug}
        </span>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-display text-h1 font-semibold tracking-tight">
            {skill.name}
          </h1>
          <SkillStatusPill status={skill.status} />
          <Badge variant="neutral">v{skill.version}</Badge>
          {skill.parentSkillId ? <Badge variant="neutral">fork</Badge> : null}
        </div>
        <p className="text-[15px] leading-6 text-text-muted">
          {parsed?.frontmatter.description ?? skill.name}
        </p>
        <div className="flex flex-wrap gap-2 pt-2">
          <Button asChild variant="primary" size="default">
            <Link href={`/chat?skill=${encodeURIComponent(skill.slug)}`}>Run it</Link>
          </Button>
          <ForkButton slug={skill.slug} />
          {canManage ? (
            <>
              <Button asChild variant="secondary">
                <Link href={`/skills/${skill.slug}/edit`}>Edit</Link>
              </Button>
              {skill.status !== 'active' ? (
                <PromoteButton slug={skill.slug} />
              ) : null}
              <ArchiveButton slug={skill.slug} />
            </>
          ) : null}
        </div>
      </header>

      {parseError ? (
        <section className="rounded-md border border-error/40 bg-[color-mix(in_srgb,var(--error)_8%,transparent)] p-4 text-[13px] text-error">
          <strong className="font-medium">YAML parse error.</strong> {parseError}
        </section>
      ) : null}

      <section className="space-y-3">
        <h2 className="text-h3 font-semibold">What it pulls from</h2>
        {defaults ? (
          <div className="space-y-2 rounded-md border border-border bg-surface p-4 text-[13px]">
            {defaults.provider?.length ? (
              <DefaultRow label="Providers" values={defaults.provider} />
            ) : null}
            {defaults.accountFilter?.tier?.length ? (
              <DefaultRow label="Tier" values={defaults.accountFilter.tier} />
            ) : null}
            {defaults.accountFilter?.owner?.length ? (
              <DefaultRow label="Owner" values={defaults.accountFilter.owner} />
            ) : null}
            {defaults.accountFilter?.accountId?.length ? (
              <DefaultRow label="Account" values={defaults.accountFilter.accountId} />
            ) : null}
            {defaults.timeWindow && 'last' in defaults.timeWindow ? (
              <DefaultRow label="Window" values={[`last ${defaults.timeWindow.last}`]} />
            ) : null}
            {defaults.timeWindow && 'from' in defaults.timeWindow ? (
              <DefaultRow
                label="Window"
                values={[
                  defaults.timeWindow.from ? `from ${defaults.timeWindow.from}` : '',
                  defaults.timeWindow.to ? `to ${defaults.timeWindow.to}` : '',
                ].filter(Boolean)}
              />
            ) : null}
          </div>
        ) : (
          <p className="text-[13px] text-text-subtle">
            No default filters configured. The skill searches across every connector
            this workspace owns.
          </p>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-h3 font-semibold">What it does</h2>
        <CollapsibleBody body={parsed?.body ?? skill.content} />
      </section>

      <section className="space-y-3">
        <h2 className="text-h3 font-semibold">Tools it can call</h2>
        {tools.length === 0 && allowlist.length === 0 ? (
          <p className="text-[13px] text-text-subtle">No tools declared.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {(allowlist.length > 0 ? allowlist : tools).map((t) => (
              <code
                key={t}
                className="rounded-sm border border-border bg-surface-2 px-1.5 py-0.5 font-mono text-[12px] text-text-muted"
              >
                {t}
              </code>
            ))}
          </div>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-h3 font-semibold">
          Forks <span className="text-text-subtle">· {forks.length}</span>
        </h2>
        {forks.length === 0 ? (
          <p className="text-[13px] text-text-subtle">No forks of this skill yet.</p>
        ) : (
          <div className="overflow-hidden rounded-lg border border-border">
            <table className="w-full text-[13px]">
              <thead className="bg-surface-2 text-text-subtle">
                <tr>
                  <Th>Name</Th>
                  <Th>Status</Th>
                  <Th>Edited</Th>
                </tr>
              </thead>
              <tbody>
                {forks.map((f) => {
                  const editor = f.updatedBy ?? f.createdBy;
                  return (
                    <tr key={f.id} className="border-t border-border">
                      <td className="px-4 py-3">
                        <Link href={`/skills/${f.slug}`} className="font-medium text-text hover:text-accent">
                          {f.name}
                        </Link>
                        <div className="text-text-subtle">
                          <code className="font-mono text-[12px]">{f.slug}</code>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <SkillStatusPill status={f.status} />
                      </td>
                      <td className="px-4 py-3 text-text-muted">
                        <div>{new Date(f.updatedAt).toISOString().slice(0, 10)}</div>
                        <div className="text-text-subtle">
                          {editor ? userById.get(editor) ?? '—' : '—'}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function DefaultRow({ label, values }: { label: string; values: string[] }) {
  return (
    <div className="flex flex-wrap items-baseline gap-2">
      <span className="caption text-text-subtle">{label}</span>
      <div className="flex flex-wrap gap-1">
        {values.map((v) => (
          <code
            key={v}
            className="rounded-sm border border-border bg-surface-2 px-1.5 py-0.5 font-mono text-[12px] text-text-muted"
          >
            {v}
          </code>
        ))}
      </div>
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="caption px-4 py-3 text-left font-medium text-text-subtle">{children}</th>;
}
