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
 *
 * `fallback` is **required**: pass `defaultOrgId` from getServerContext().
 * A previous version made it optional and defaulted to `''` if everything
 * was missing, which silently routed reads against the empty string while
 * writes hit the seeded default org — the dashboard then showed "Not
 * connected" forever after a successful connect. Keeping `fallback`
 * required catches the drift at compile time.
 */
export function resolveActiveOrgId(
  session: SessionLike,
  fallback: string,
): string {
  const sessionRow = session.session as { activeOrganizationId?: string | null };
  const homeOrgId = (session.user as { organizationId?: string }).organizationId;
  return sessionRow.activeOrganizationId ?? homeOrgId ?? fallback;
}
