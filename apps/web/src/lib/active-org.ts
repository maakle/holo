import 'server-only';

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
 */
export function resolveActiveOrgId(
  session: SessionLike,
  fallback?: string,
): string {
  const sessionRow = session.session as { activeOrganizationId?: string | null };
  const homeOrgId = (session.user as { organizationId?: string }).organizationId;
  return sessionRow.activeOrganizationId ?? homeOrgId ?? fallback ?? '';
}
