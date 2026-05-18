import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { eq, and } from 'drizzle-orm';
import { schema } from '@holo/db';
import { holoError, ErrorCode, HoloError } from '@holo/errors';
import {
  createGoogleDriveSpec,
  createGoogleChatSpec,
  parseServiceAccountKey,
  mintDelegatedAccessToken,
  mintAppAccessToken,
  googleServiceAccountScopes,
  invalidateGoogleServiceAccountTokenCache,
  isGoogleServiceAccountProvider,
  type GoogleServiceAccountProvider,
} from '@holo/connectors';
import { createHttpClient } from '@holo/connector-framework';
import { emitAuditEvent } from '@holo/audit';
import { GOOGLE_CHAT_APP_SCOPES } from '@holo/sync-providers';
import { getServerContext } from '@/lib/server-context';
import { resolveActiveOrgId } from '@/lib/active-org';
import { enqueueInitialSync } from '@/lib/sync-queue';

interface RequestBody {
  keyJson?: string;
  /**
   * For `authMode: 'dwd'` (default): the Workspace user the SA impersonates.
   * Ignored when `authMode: 'app'` — app-mode acts as the SA itself.
   */
  impersonationEmail?: string;
  /**
   * Authentication mode for this connection. Defaults to 'dwd' to preserve
   * existing wizard behavior. 'app' is only supported for google-chat and
   * routes the install through the bot-in-space path (no impersonation;
   * requires Marketplace install + admin OAuth grant of chat.app.* scopes).
   */
  authMode?: 'dwd' | 'app';
}

/**
 * POST /api/connectors/<google-chat|googledrive>/service-account
 *
 * Workspace-scoped install for the Google connectors. The admin pastes the
 * full JSON key from Google Cloud Console plus the email of the Workspace
 * user the SA should impersonate via domain-wide delegation. We:
 *   1. Validate the JSON key shape.
 *   2. Mint a delegated access token to prove the install actually works
 *      (catches DWD misconfigs at setup time, not mid-sync).
 *   3. Probe the connector's testConnection to capture the workspace identity.
 *   4. Upsert connector_service_accounts + sources, enqueue first sync.
 *
 * Per-org, not per-user — the row replaces per-user OAuth credentials
 * entirely. Re-installing overwrites the existing row.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ provider: string }> },
) {
  try {
    const { provider: rawProvider } = await params;
    if (!isGoogleServiceAccountProvider(rawProvider)) {
      throw holoError({
        code: ErrorCode.HOLO_CONNECTOR_NOT_IMPLEMENTED,
        problem: `${rawProvider} does not use the service-account install flow`,
        fix: 'Service-account install is for Google connectors (googledrive, google-chat). Use the OAuth or API-key route for other providers.',
      });
    }
    const provider: GoogleServiceAccountProvider = rawProvider;

    const { auth, db } = await getServerContext();
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) {
      throw holoError({
        code: ErrorCode.HOLO_AUTH_NO_SESSION,
        problem: 'must be signed in to connect a connector',
        fix: 'Sign in first.',
      });
    }
    const orgId = resolveActiveOrgId(session);
    const userId = session.user.id;

    const body = (await req.json().catch(() => ({}))) as RequestBody;
    const keyJsonRaw = body.keyJson?.trim();
    const impersonationEmailRaw = body.impersonationEmail?.trim().toLowerCase();
    const authMode: 'dwd' | 'app' = body.authMode === 'app' ? 'app' : 'dwd';

    if (!keyJsonRaw) {
      throw holoError({
        code: ErrorCode.HOLO_INVALID_INPUT,
        problem: 'keyJson is required',
        fix: 'Paste the full service account JSON key in the wizard.',
      });
    }

    // app-mode is Chat-only — Drive scopes are user-context (no drive.app.*)
    // and require impersonation. Reject the combination at install time so
    // we don't ship a token loader that throws mid-sync.
    if (authMode === 'app' && provider !== 'google-chat') {
      throw holoError({
        code: ErrorCode.HOLO_INVALID_INPUT,
        problem: `authMode='app' is only supported for google-chat, not ${provider}`,
        fix: 'Use authMode=dwd for googledrive — Drive scopes require user impersonation.',
      });
    }

    let impersonationEmail: string | null = null;
    if (authMode === 'dwd') {
      if (!impersonationEmailRaw || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(impersonationEmailRaw)) {
        throw holoError({
          code: ErrorCode.HOLO_INVALID_INPUT,
          problem: 'impersonationEmail must be a valid email address',
          fix: 'Enter the Workspace user the service account should act as.',
        });
      }
      // Block the common footgun: pasting the service account's own email
      // as the impersonation user. Google returns a SA-only token for that
      // case (no `invalid_grant`), and downstream API calls then run as the
      // bot — which is in zero spaces / sees zero files. Fail loudly here.
      if (impersonationEmailRaw.endsWith('.iam.gserviceaccount.com')) {
        throw holoError({
          code: ErrorCode.HOLO_INVALID_INPUT,
          problem:
            'impersonationEmail must be a Workspace user, not the service account itself',
          fix: 'Enter a real Workspace user email (e.g. yours or admin@yourcompany.com). Holo will only see what that user can see.',
        });
      }
      impersonationEmail = impersonationEmailRaw;
    }

    // Step 1: parse + validate the JSON shape (throws HoloError on bad input).
    const key = parseServiceAccountKey(keyJsonRaw);

    // Step 2: prove the SA works by minting a real token. Different mint
    // call per auth mode — DWD mints a delegated token (catches DWD
    // misconfigs), app mode mints an app-level token (catches SA key /
    // Chat-API-enablement misconfigs). App-mode token successfully minting
    // is necessary but not sufficient — `chat.app.*` scope grants from the
    // Marketplace install can propagate slowly, so we don't gate install
    // on a downstream API call working.
    const minted =
      authMode === 'app'
        ? await mintAppAccessToken({
            key,
            scopes: GOOGLE_CHAT_APP_SCOPES,
          })
        : await mintDelegatedAccessToken({
            key,
            impersonationEmail: impersonationEmail!,
            scopes: googleServiceAccountScopes(provider),
          });

    // Step 3: probe the connector to capture identity for the sources row.
    // DWD-mode tests connection (impersonation + scope check), app-mode
    // skips the probe because `spaces.list` may 403 until the Marketplace
    // scope grant fully propagates (Phase 0 verification notes). We
    // synthesize an identity from the SA email instead — once an actual
    // sync runs, the workspace identity gets enriched by the per-space
    // membership state.
    let ident: { externalId: string; name: string };
    if (authMode === 'app') {
      ident = {
        externalId: `app:${key.project_id}`,
        name: `Google Chat (Holo app — project ${key.project_id})`,
      };
    } else {
      const spec =
        provider === 'googledrive' ? createGoogleDriveSpec() : createGoogleChatSpec();
      const tokens = { accessToken: minted.accessToken, expiresAt: minted.expiresAt };
      const api = createHttpClient({ config: spec.http!, auth: spec.auth, tokens });
      ident = await spec.testConnection({ api, tokens });
    }

    // Step 4a: upsert the SA row (per org+provider, no userId).
    const existing = await db
      .select({ id: schema.connectorServiceAccounts.id })
      .from(schema.connectorServiceAccounts)
      .where(
        and(
          eq(schema.connectorServiceAccounts.organizationId, orgId),
          eq(schema.connectorServiceAccounts.provider, provider),
        ),
      )
      .limit(1);
    if (existing[0]) {
      await db
        .update(schema.connectorServiceAccounts)
        .set({
          keyJson: keyJsonRaw,
          impersonationEmail,
          authMode,
          serviceAccountEmail: key.client_email,
          serviceAccountClientId: key.client_id,
          status: 'active',
          installedByUserId: userId,
          lastValidatedAt: new Date(),
        })
        .where(eq(schema.connectorServiceAccounts.id, existing[0].id));
    } else {
      await db.insert(schema.connectorServiceAccounts).values({
        organizationId: orgId,
        provider,
        keyJson: keyJsonRaw,
        impersonationEmail,
        authMode,
        serviceAccountEmail: key.client_email,
        serviceAccountClientId: key.client_id,
        installedByUserId: userId,
        lastValidatedAt: new Date(),
      });
    }

    // Drop the cached delegated token for this (org, provider) pair so the
    // next call to loadGoogleServiceAccountToken mints a fresh one against
    // the just-saved row. Without this, a reconnect that changes the
    // impersonation email or rotates the key keeps handing back the
    // previous token until natural expiry (~50 min) — and any picker /
    // sync call in that window runs as the old identity, returning empty
    // results that look like a permissions bug.
    invalidateGoogleServiceAccountTokenCache(orgId, provider);

    // Step 4b: upsert the source row so sync queues have a target.
    const sourceMetadata = {
      auth_mode: authMode,
      impersonation_email: impersonationEmail,
      service_account_email: key.client_email,
    };
    await db
      .insert(schema.sources)
      .values({
        organizationId: orgId,
        provider,
        externalId: ident.externalId,
        name: ident.name,
        metadata: sourceMetadata,
      })
      .onConflictDoUpdate({
        target: [
          schema.sources.organizationId,
          schema.sources.provider,
          schema.sources.externalId,
        ],
        set: {
          name: ident.name,
          metadata: sourceMetadata,
          updatedAt: new Date(),
        },
      });

    await enqueueInitialSync(db, orgId, provider).catch(() => {});

    emitAuditEvent({
      db,
      organizationId: orgId,
      userId,
      eventType: 'connector.connected',
      resourceType: 'connector',
      resourceId: provider,
      meta: {
        provider,
        authMode,
        externalId: ident.externalId,
        name: ident.name,
        serviceAccountEmail: key.client_email,
        impersonationEmail,
      },
    });

    return NextResponse.json({
      ok: true,
      authMode,
      connectedAs: ident.name,
      externalId: ident.externalId,
    });
  } catch (e) {
    if (e instanceof HoloError) {
      const status =
        e.code === ErrorCode.HOLO_AUTH_NO_SESSION
          ? 401
          : e.code === ErrorCode.HOLO_CONNECTOR_NOT_IMPLEMENTED
            ? 501
            : 400;
      return NextResponse.json(e.toJSON(), { status });
    }
    console.error(e);
    return NextResponse.json(
      { code: 'HOLO_INTERNAL', problem: 'unexpected error', fix: 'check server logs' },
      { status: 500 },
    );
  }
}
