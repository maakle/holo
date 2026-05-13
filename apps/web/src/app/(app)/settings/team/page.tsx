import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { and, asc, eq } from 'drizzle-orm';
import { schema } from '@holo/db';
import { getServerContext } from '@/lib/server-context';
import { resolveActiveOrgId } from '@/lib/active-org';
import { Badge } from '@/components/ui/badge';
import { InviteForm } from './invite-form';
import { InviteLinkCard } from './invite-link-card';
import { RemoveMemberButton } from './remove-member-button';
import { RevokeInviteButton } from './revoke-invite-button';

export const dynamic = 'force-dynamic';

export default async function TeamPage() {
  const { auth, db, env } = await getServerContext();
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in?callbackURL=/settings/team');

  const sessionUser = session.user as unknown as {
    id: string;
    email: string;
  };
  const orgId = resolveActiveOrgId(session);
  if (!orgId) redirect('/dashboard');

  const members = await db
    .select({
      memberId: schema.member.id,
      role: schema.member.role,
      joinedAt: schema.member.createdAt,
      userId: schema.user.id,
      email: schema.user.email,
      name: schema.user.name,
    })
    .from(schema.member)
    .innerJoin(schema.user, eq(schema.user.id, schema.member.userId))
    .where(eq(schema.member.organizationId, orgId))
    .orderBy(asc(schema.member.createdAt));

  const myRow = members.find((m) => m.userId === sessionUser.id);
  // Defense in depth: if the current user isn't actually a member of the
  // resolved active org (e.g. their session is stale because they were
  // removed elsewhere), don't render someone else's workspace data. The
  // (app) layout normally reconciles this, but this guard keeps the team
  // page honest if the layout ever misses an edge case.
  if (!myRow) redirect('/workspaces/new');
  const canManage = myRow.role === 'owner' || myRow.role === 'admin';

  const pending = await db
    .select({
      id: schema.invitation.id,
      email: schema.invitation.email,
      role: schema.invitation.role,
      expiresAt: schema.invitation.expiresAt,
    })
    .from(schema.invitation)
    .where(
      and(
        eq(schema.invitation.organizationId, orgId),
        eq(schema.invitation.status, 'pending'),
      ),
    )
    .orderBy(asc(schema.invitation.expiresAt));

  let inviteLinkUrl: string | null = null;
  if (canManage) {
    const linkRows = await db
      .select({ token: schema.orgInviteLink.token })
      .from(schema.orgInviteLink)
      .where(eq(schema.orgInviteLink.organizationId, orgId))
      .limit(1);
    const token = linkRows[0]?.token;
    if (token) {
      const base = env.BETTER_AUTH_URL.replace(/\/+$/, '');
      inviteLinkUrl = `${base}/join/${token}`;
    }
  }

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <h2 className="text-[15px] font-medium">Members &amp; invitations</h2>
        <p className="text-[13px] leading-5 text-text-muted">
          Invite teammates by email. They&apos;ll join this workspace and see the same
          connections, skills, and observability.
        </p>
      </section>

      {canManage && <InviteForm />}
      {canManage && <InviteLinkCard initialUrl={inviteLinkUrl} />}

      <section className="space-y-3">
        <h2 className="text-[15px] font-medium">
          Members <span className="text-text-subtle">· {members.length}</span>
        </h2>
        <div className="overflow-hidden rounded-lg border border-border">
          <table className="w-full text-[13px]">
            <thead className="bg-surface-2 text-text-subtle">
              <tr>
                <Th>Member</Th>
                <Th>Role</Th>
                <Th>Joined</Th>
                {canManage ? <Th className="text-right">Action</Th> : null}
              </tr>
            </thead>
            <tbody>
              {members.map((m) => {
                const isSelf = m.userId === sessionUser.id;
                return (
                  <tr key={m.memberId} className="border-t border-border">
                    <td className="px-4 py-3">
                      <div className="font-medium text-text">{m.name || m.email}</div>
                      <div className="text-text-subtle">{m.email}</div>
                    </td>
                    <td className="px-4 py-3">
                      <Badge
                        variant={m.role === 'owner' ? 'accent' : 'neutral'}
                        className="capitalize"
                      >
                        {m.role}
                      </Badge>
                      {isSelf ? (
                        <span className="ml-2 text-text-subtle">· you</span>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 text-text-muted">
                      {new Date(m.joinedAt).toISOString().slice(0, 10)}
                    </td>
                    {canManage ? (
                      <td className="px-4 py-3 text-right">
                        {isSelf ? null : (
                          <RemoveMemberButton
                            memberId={m.memberId}
                            memberLabel={m.name || m.email}
                          />
                        )}
                      </td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {canManage && pending.length > 0 ? (
        <section className="space-y-3">
          <h2 className="text-[15px] font-medium">
            Pending invitations <span className="text-text-subtle">· {pending.length}</span>
          </h2>
          <div className="overflow-hidden rounded-lg border border-border">
            <table className="w-full text-[13px]">
              <thead className="bg-surface-2 text-text-subtle">
                <tr>
                  <Th>Email</Th>
                  <Th>Role</Th>
                  <Th>Expires</Th>
                  <Th className="text-right">Action</Th>
                </tr>
              </thead>
              <tbody>
                {pending.map((inv) => (
                  <tr key={inv.id} className="border-t border-border">
                    <td className="px-4 py-3 text-text">{inv.email}</td>
                    <td className="px-4 py-3 capitalize text-text-muted">{inv.role}</td>
                    <td className="px-4 py-3 text-text-muted">
                      {new Date(inv.expiresAt).toISOString().slice(0, 10)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <RevokeInviteButton invitationId={inv.id} inviteeEmail={inv.email} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
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
