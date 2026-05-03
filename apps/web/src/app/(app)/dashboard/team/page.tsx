import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { and, asc, eq } from 'drizzle-orm';
import { schema } from '@holo/db';
import { getServerContext } from '@/lib/server-context';
import { Badge } from '@/components/ui/badge';
import { InviteForm } from './invite-form';
import { cancelInvitation } from './actions';

export const dynamic = 'force-dynamic';

export default async function TeamPage() {
  const { auth, db } = await getServerContext();
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in?callbackURL=/dashboard/team');

  const sessionUser = session.user as unknown as {
    id: string;
    email: string;
    organizationId?: string;
  };
  const sessionRow = session.session as { activeOrganizationId?: string | null };
  const orgId = sessionRow.activeOrganizationId ?? sessionUser.organizationId ?? '';
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
  const canManage = myRow?.role === 'owner' || myRow?.role === 'admin';

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

  return (
    <div className="max-w-3xl space-y-10">
      <header className="flex flex-col gap-2">
        <span className="caption">Team</span>
        <h1 className="font-display text-h1 font-semibold tracking-tight">
          Members & invitations
        </h1>
        <p className="text-[15px] leading-6 text-text-muted">
          Invite teammates by email. They&apos;ll join this workspace and see the same
          connections, skills, and observability.
        </p>
      </header>

      {canManage && <InviteForm />}

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
                <Th className="text-right">Joined</Th>
              </tr>
            </thead>
            <tbody>
              {members.map((m) => {
                const isSelf = m.userId === sessionUser.id;
                return (
                  <tr key={m.memberId} className="border-t border-border">
                    <td className="px-4 py-3">
                      <div className="font-medium text-text">{m.name ?? m.email}</div>
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
                    <td className="px-4 py-3 text-right text-text-muted">
                      {new Date(m.joinedAt).toISOString().slice(0, 10)}
                    </td>
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
                      <form action={cancelInvitation}>
                        <input type="hidden" name="invitationId" value={inv.id} />
                        <button
                          type="submit"
                          className="text-[13px] text-text-muted hover:text-error"
                        >
                          Revoke
                        </button>
                      </form>
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
