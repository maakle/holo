import { headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { and, desc, eq } from 'drizzle-orm';
import { schema } from '@holo/db';
import { getServerContext } from '@/lib/server-context';
import { resolveActiveOrgId } from '@/lib/active-org';
import { canManageSkills, resolveMemberRole } from '../../_lib/permissions';
import { SkillEditor } from '../../_components/skill-editor';

export const dynamic = 'force-dynamic';

export default async function SkillEditPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const { auth, db } = await getServerContext();
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect(`/sign-in?callbackURL=/skills/${slug}/edit`);
  const orgId = resolveActiveOrgId(session);

  const rows = await db
    .select()
    .from(schema.skills)
    .where(and(eq(schema.skills.organizationId, orgId), eq(schema.skills.slug, slug)))
    .orderBy(desc(schema.skills.version))
    .limit(1);
  const skill = rows[0];
  if (!skill) notFound();

  // Permission check: org-active skills require owner/admin. Drafts are
  // editable by any member who can see them (this matches the RFC's
  // "fork → edit → PR" loop where the forker owns the draft). We also let
  // the creator edit their own draft regardless of role.
  const role = await resolveMemberRole(db, orgId, session.user.id);
  const isCreator = skill.createdBy === session.user.id;
  const canEdit =
    skill.status === 'active'
      ? canManageSkills(role)
      : canManageSkills(role) || isCreator;
  if (!canEdit) {
    redirect(`/skills/${slug}`);
  }

  return (
    <div className="max-w-4xl space-y-6" data-fullwidth>
      <header className="space-y-2">
        <span className="caption">
          Editing · {skill.slug} · v{skill.version}
        </span>
        <h1 className="font-display text-h1 font-semibold tracking-tight">{skill.name}</h1>
        <p className="text-[15px] leading-6 text-text-muted">
          Form mode covers the safe fields. Body mode is markdown. YAML mode is the
          escape hatch — toggle it under &ldquo;Advanced&rdquo; and watch for the
          validation gutter.
        </p>
      </header>

      <SkillEditor
        slug={skill.slug}
        initialContent={skill.content}
        canPromote={canManageSkills(role) && skill.status !== 'active'}
        canArchive={canManageSkills(role)}
      />
    </div>
  );
}
