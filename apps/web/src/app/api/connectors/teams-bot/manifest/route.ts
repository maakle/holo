import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { schema } from '@holo/db';
import { holoError, ErrorCode, HoloError } from '@holo/errors';
import { getServerContext } from '@/lib/server-context';
import { resolveActiveOrgId } from '@/lib/active-org';
import {
  buildTeamsManifestZip,
  deriveManifestId,
} from '@/lib/teams-bot/manifest';

/**
 * Generate the per-org `holo-bot.zip` app package for sideloading via
 * Teams Admin Center → Manage apps → Upload custom app.
 *
 * The zip contains:
 *   - `manifest.json` — Teams app manifest v1.16 referencing the shared
 *     Holo bot's Microsoft App ID
 *   - `color.png` 192×192, `outline.png` 32×32 — placeholder brand icons
 *
 * The manifest's `id` is stable per (appId, organizationId) so re-
 * downloading produces the same `id` and Teams treats it as an in-place
 * update rather than a new app. Re-download bumps the `version` field
 * to a date-stamped value so admins can roll forward.
 *
 * Auth: signed-in user in the active org. We don't include any secret
 * material in the zip — the bot secret lives only on the worker, and
 * the manifest is happy with just the App ID.
 *
 * Why per-org `id` despite a single shared bot:
 *   - AppSource publishing later will require a published `id`; until
 *     then, distinct ids per tenant let an admin re-install without
 *     hitting "an app with this id already exists, please uninstall first."
 *   - The `botId` (= App ID) is what actually routes inbound traffic;
 *     `manifest.id` is just Teams' deduper.
 */
export async function GET() {
  try {
    const { env, db, auth } = await getServerContext();
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) {
      throw holoError({
        code: ErrorCode.HOLO_AUTH_NO_SESSION,
        problem: 'must be signed in',
        fix: 'Sign in first.',
      });
    }
    const orgId = resolveActiveOrgId(session);

    if (!env.TEAMS_BOT_APP_ID) {
      throw holoError({
        code: ErrorCode.HOLO_ENV_INVALID,
        problem: 'TEAMS_BOT_APP_ID is not configured on this deployment',
        fix: 'Register a multi-tenant Azure AD app + Azure Bot resource, then set TEAMS_BOT_APP_ID and TEAMS_BOT_APP_SECRET on the gateway/worker env. See docs/connectors/teams-bot.md.',
      });
    }

    const webPublicUrl = env.WEB_PUBLIC_URL ?? env.BETTER_AUTH_URL;

    // Surface the org's display name in the manifest's `developer.name`
    // so admins see a recognizable string when sideloading.
    const orgRow = await db
      .select({ name: schema.organization.name })
      .from(schema.organization)
      .where(eq(schema.organization.id, orgId))
      .limit(1);
    const organizationName = orgRow[0]?.name ?? 'Holo';

    const zip = await buildTeamsManifestZip({
      appId: env.TEAMS_BOT_APP_ID,
      manifestId: deriveManifestId(env.TEAMS_BOT_APP_ID, orgId),
      organizationName,
      webPublicUrl,
    });

    return new NextResponse(new Uint8Array(zip), {
      status: 200,
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': 'attachment; filename="holo-bot.zip"',
        'Content-Length': String(zip.length),
        // Tiny payload that incorporates the org id + date — don't cache.
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (e) {
    if (e instanceof HoloError) {
      return NextResponse.json({ problem: e.problem, fix: e.fix }, { status: 400 });
    }
    console.error(e);
    return NextResponse.json({ problem: 'internal error' }, { status: 500 });
  }
}
