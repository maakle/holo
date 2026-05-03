import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { and, asc, eq } from 'drizzle-orm';
import { schema } from '@holo/db';
import { getServerContext } from '@/lib/server-context';
import { inviteMember, removeMember, revokeInvitation, leaveWorkspace } from './actions';

export default async function TeamPage() {
  const { auth, db } = await getServerContext();
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in');

  const sessionUser = session.user as unknown as {
    id: string;
    email: string;
    organizationId: string;
  };
  const orgId = sessionUser.organizationId;

  const members = await db
    .select({
      memberId: schema.member.id,
      role: schema.member.role,
      createdAt: schema.member.createdAt,
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

  const pendingInvites = await db
    .select({
      id: schema.invitation.id,
      email: schema.invitation.email,
      role: schema.invitation.role,
      token: schema.invitation.token,
      expiresAt: schema.invitation.expiresAt,
      createdAt: schema.invitation.createdAt,
    })
    .from(schema.invitation)
    .where(
      and(
        eq(schema.invitation.organizationId, orgId),
        eq(schema.invitation.status, 'pending'),
      ),
    )
    .orderBy(asc(schema.invitation.createdAt));

  const ownerCount = members.filter((m) => m.role === 'owner').length;
  const isLastOwner = myRow?.role === 'owner' && ownerCount <= 1;

  return (
    <div className="space-y-10">
      <div>
        <h1 className="font-display text-h1">Team</h1>
        <p className="mt-1 text-body-sm text-text-muted">
          {members.length} {members.length === 1 ? 'member' : 'members'} in this workspace.
        </p>
      </div>

      {canManage && (
        <section className="space-y-3">
          <h2 className="text-h3">Invite a member</h2>
          <form
            action={inviteMember}
            className="flex flex-col gap-2 sm:flex-row sm:items-end"
          >
            <label className="flex-1 space-y-1">
              <span className="text-caption uppercase text-text-subtle">Email</span>
              <input
                name="email"
                type="email"
                required
                placeholder="teammate@company.com"
                className="h-10 w-full rounded-md border border-border bg-transparent px-3 text-body-sm outline-none placeholder:text-text-subtle focus:border-transparent focus:outline focus:outline-2 focus:outline-accent"
              />
            </label>
            <label className="space-y-1">
              <span className="text-caption uppercase text-text-subtle">Role</span>
              <select
                name="role"
                defaultValue="member"
                className="h-10 rounded-md border border-border bg-transparent px-3 text-body-sm outline-none focus:border-transparent focus:outline focus:outline-2 focus:outline-accent"
              >
                <option value="member">Member</option>
                <option value="admin">Admin</option>
              </select>
            </label>
            <button
              type="submit"
              className="h-10 rounded-md bg-accent px-4 text-body-sm font-medium text-accent-fg hover:opacity-90"
            >
              Send invite
            </button>
          </form>
          <p className="text-body-sm text-text-subtle">
            Email delivery isn&apos;t wired yet — copy the invite link from the table below
            and share it manually. Invites expire after 7 days.
          </p>
        </section>
      )}

      <section className="space-y-3">
        <h2 className="text-h3">Members</h2>
        <div className="overflow-hidden rounded-md border border-border">
          <table className="w-full text-body-sm">
            <thead className="bg-surface-2 text-caption uppercase tracking-[0.06em] text-text-subtle">
              <tr>
                <th className="px-4 py-3 text-left font-medium">Member</th>
                <th className="px-4 py-3 text-left font-medium">Role</th>
                <th className="px-4 py-3 text-left font-medium">Joined</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {members.map((m) => {
                const isSelf = m.userId === sessionUser.id;
                return (
                  <tr key={m.memberId} className="border-t border-border">
                    <td className="px-4 py-3">
                      <div className="font-medium">{m.name ?? m.email}</div>
                      <div className="text-text-subtle">{m.email}</div>
                    </td>
                    <td className="px-4 py-3 capitalize text-text-muted">{m.role}</td>
                    <td className="px-4 py-3 text-text-muted">
                      {new Date(m.createdAt).toISOString().slice(0, 10)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {canManage && !isSelf ? (
                        <form action={removeMember}>
                          <input type="hidden" name="memberId" value={m.memberId} />
                          <button
                            type="submit"
                            className="text-body-sm text-text-muted hover:text-error"
                          >
                            Remove
                          </button>
                        </form>
                      ) : (
                        <span className="text-text-subtle">{isSelf ? 'You' : ''}</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {canManage && pendingInvites.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-h3">Pending invitations</h2>
          <div className="overflow-hidden rounded-md border border-border">
            <table className="w-full text-body-sm">
              <thead className="bg-surface-2 text-caption uppercase tracking-[0.06em] text-text-subtle">
                <tr>
                  <th className="px-4 py-3 text-left font-medium">Email</th>
                  <th className="px-4 py-3 text-left font-medium">Role</th>
                  <th className="px-4 py-3 text-left font-medium">Expires</th>
                  <th className="px-4 py-3 text-left font-medium">Invite link</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {pendingInvites.map((inv) => (
                  <tr key={inv.id} className="border-t border-border">
                    <td className="px-4 py-3">{inv.email}</td>
                    <td className="px-4 py-3 capitalize text-text-muted">{inv.role}</td>
                    <td className="px-4 py-3 text-text-muted">
                      {new Date(inv.expiresAt).toISOString().slice(0, 10)}
                    </td>
                    <td className="px-4 py-3 font-mono text-mono text-text-muted">
                      /invite/{inv.token.slice(0, 8)}…
                    </td>
                    <td className="px-4 py-3 text-right">
                      <form action={revokeInvitation}>
                        <input type="hidden" name="invitationId" value={inv.id} />
                        <button
                          type="submit"
                          className="text-body-sm text-text-muted hover:text-error"
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
      )}

      <section className="space-y-2 border-t border-border pt-8">
        <h2 className="text-h3">Leave workspace</h2>
        <p className="text-body-sm text-text-muted">
          You will lose access to this workspace&apos;s connectors and data immediately.
        </p>
        <form action={leaveWorkspace}>
          <button
            type="submit"
            disabled={isLastOwner}
            title={isLastOwner ? 'Promote another member to owner first.' : undefined}
            className="rounded-md border border-border px-4 py-2 text-body-sm text-text hover:border-error hover:text-error disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-border disabled:hover:text-text"
          >
            Leave workspace
          </button>
        </form>
      </section>
    </div>
  );
}
