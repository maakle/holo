import 'server-only';
import { holoError, ErrorCode } from '@holo/errors';

type SessionLike = {
  user: { id: string } & Record<string, unknown>;
  session: Record<string, unknown>;
};

/**
 * Resolve the workspace (organization) the request should operate on.
 *
 * better-auth tracks the currently-selected workspace as
 * `session.session.activeOrganizationId` (set by `organization.setActive`).
 * The user's `organizationId` field is the *home* org assigned at signup and
 * never changes — using it for data queries breaks workspace switching.
 *
 * Strict by design: throws `HOLO_AUTH_NO_ACTIVE_ORG` if neither
 * `session.activeOrganizationId` nor `user.organizationId` is set. A previous
 * version accepted a `defaultOrgId` fallback, which silently routed
 * workspace-scoped writes (invitations, audit events, connector tokens) to
 * the seeded `default` org for any user whose session drifted — wrong-tenant
 * data leakage waiting to happen once Holo is multi-tenant. The session
 * `create.before` hook in @holo/auth populates `activeOrganizationId` from
 * the user's home org, so this should always succeed for valid sessions.
 */
export function resolveActiveOrgId(session: SessionLike): string {
  const sessionRow = session.session as { activeOrganizationId?: string | null };
  const homeOrgId = (session.user as { organizationId?: string }).organizationId;
  const orgId = sessionRow.activeOrganizationId ?? homeOrgId;
  if (!orgId) {
    throw holoError({
      code: ErrorCode.HOLO_AUTH_NO_ACTIVE_ORG,
      problem: 'no active workspace on session',
      fix: 'Sign out and back in, or switch to a workspace.',
    });
  }
  return orgId;
}
