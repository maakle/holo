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
  googleServiceAccountScopes,
  invalidateGoogleServiceAccountTokenCache,
  isGoogleServiceAccountProvider,
  type GoogleServiceAccountProvider,
} from '@holo/connectors';
import { createHttpClient } from '@holo/connector-framework';
import { emitAuditEvent } from '@holo/audit';
import { getServerContext } from '@/lib/server-context';
import { resolveActiveOrgId } from '@/lib/active-org';
import { enqueueInitialSync } from '@/lib/sync-queue';

interface RequestBody {
  keyJson?: string;
  impersonationEmail?: string;
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
    const impersonationEmail = body.impersonationEmail?.trim().toLowerCase();
    if (!keyJsonRaw) {
      throw holoError({
        code: ErrorCode.HOLO_INVALID_INPUT,
        problem: 'keyJson is required',
        fix: 'Paste the full service account JSON key in the wizard.',
      });
    }
    if (!impersonationEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(impersonationEmail)) {
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
    if (impersonationEmail.endsWith('.iam.gserviceaccount.com')) {
      throw holoError({
        code: ErrorCode.HOLO_INVALID_INPUT,
        problem: 'impersonationEmail must be a Workspace user, not the service account itself',
        fix: 'Enter a real Workspace user email (e.g. yours or admin@yourcompany.com). Holo will only see what that user can see.',
      });
    }

    // Step 1: parse + validate the JSON shape (throws HoloError on bad input).
    const key = parseServiceAccountKey(keyJsonRaw);

    // Step 2: prove the SA + DWD + impersonation actually works by minting
    // a real token. If DWD isn't set up or the impersonation user doesn't
    // exist, Google returns invalid_grant — surface that here, before we
    // store anything.
    const minted = await mintDelegatedAccessToken({
      key,
      impersonationEmail,
      scopes: googleServiceAccountScopes(provider),
    });

    // Step 3: probe the connector to capture identity for the sources row.
    const spec =
      provider === 'googledrive' ? createGoogleDriveSpec() : createGoogleChatSpec();
    const tokens = { accessToken: minted.accessToken, expiresAt: minted.expiresAt };
    const api = createHttpClient({ config: spec.http!, auth: spec.auth, tokens });
    const ident = await spec.testConnection({ api, tokens });

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
    await db
      .insert(schema.sources)
      .values({
        organizationId: orgId,
        provider,
        externalId: ident.externalId,
        name: ident.name,
        metadata: {
          impersonation_email: impersonationEmail,
          service_account_email: key.client_email,
        },
      })
      .onConflictDoUpdate({
        target: [
          schema.sources.organizationId,
          schema.sources.provider,
          schema.sources.externalId,
        ],
        set: {
          name: ident.name,
          metadata: {
            impersonation_email: impersonationEmail,
            service_account_email: key.client_email,
          },
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
        externalId: ident.externalId,
        name: ident.name,
        serviceAccountEmail: key.client_email,
        impersonationEmail,
      },
    });

    return NextResponse.json({
      ok: true,
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
