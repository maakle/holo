/**
 * GitHub App webhook intake.
 *
 * Receives every event GitHub delivers for the holo App. Verifies the
 * HMAC-SHA256 signature, parses the JSON, and dispatches by event type:
 *
 *   - installation.*                  → upsert / soft-suspend the installation row
 *   - installation_repositories.*     → log only (the runner reads live from
 *                                        GitHub via /installation/repositories)
 *   - push / pull_request / issues /  → enqueue an incremental sync. Per-resource
 *     pull_request_review / etc.        fast-path is intentionally deferred.
 *
 * The body must be read as raw text *before* JSON parsing — GitHub's
 * signature is over the literal bytes, so any reformatting breaks it.
 */
import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { and, eq } from 'drizzle-orm';
import { schema } from '@holo/db';
import {
  verifyGithubWebhookSignature,
  isHandledEvent,
} from '@holo/connectors';
import { getServerContext } from '@/lib/server-context';
import { enqueueResync } from '@/lib/sync-queue';

interface InstallationEventPayload {
  action: 'created' | 'deleted' | 'suspend' | 'unsuspend' | 'new_permissions_accepted';
  installation: {
    id: number;
    account: { login: string; id: number; type: 'User' | 'Organization' };
    repository_selection: 'all' | 'selected';
    suspended_at: string | null;
  };
}

interface InstallationRepositoriesEventPayload {
  action: 'added' | 'removed';
  installation: { id: number };
}

interface ContentEventPayload {
  installation?: { id: number };
}

export async function POST(req: Request) {
  const event = (await headers()).get('x-github-event') ?? '';
  const signatureHeader = (await headers()).get('x-hub-signature-256');
  const deliveryId = (await headers()).get('x-github-delivery') ?? 'unknown';

  // Always read the raw body first — JSON.parse(req.json()) would normalize
  // whitespace and corrupt the signature input.
  const rawBody = await req.text();

  const { env, db } = await getServerContext();
  if (!env.GITHUB_APP_WEBHOOK_SECRET) {
    // Misconfiguration: a webhook arrived but the secret isn't set. Return
    // 503 so GitHub retries (rather than 200, which would silently swallow).
    console.error(
      `[webhooks/github] received delivery ${deliveryId} but GITHUB_APP_WEBHOOK_SECRET is not set`,
    );
    return NextResponse.json(
      { problem: 'webhook secret not configured' },
      { status: 503 },
    );
  }

  const verify = verifyGithubWebhookSignature({
    rawBody,
    signatureHeader,
    secret: env.GITHUB_APP_WEBHOOK_SECRET,
  });
  if (!verify.ok) {
    return NextResponse.json(
      { problem: `signature ${verify.reason}` },
      { status: 401 },
    );
  }

  // Drop quickly for events we don't process. GitHub's `ping` is also
  // delivered after registration; it's harmless to ack with 200.
  if (event === 'ping') {
    return NextResponse.json({ ok: true, ping: true });
  }
  if (!isHandledEvent(event)) {
    return NextResponse.json({ ok: true, ignored: event });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ problem: 'invalid JSON' }, { status: 400 });
  }

  try {
    if (event === 'installation') {
      await handleInstallation(db, payload as InstallationEventPayload);
    } else if (event === 'installation_repositories') {
      // The runner reads /installation/repositories live, so we don't need
      // to mutate state — but we log so operators can see add/remove flow.
      const p = payload as InstallationRepositoriesEventPayload;
      console.log(
        `[webhooks/github] ${deliveryId} installation_repositories.${p.action} for installation ${p.installation.id}`,
      );
    } else {
      // Content events (push / pull_request / issues / etc.) — enqueue an
      // incremental sync for the matching org. Per-resource fast paths
      // (only re-index the one PR that was edited) come later.
      await enqueueIncrementalForInstallation(
        db,
        (payload as ContentEventPayload).installation?.id,
        deliveryId,
        event,
      );
    }
  } catch (err) {
    console.error(`[webhooks/github] ${deliveryId} ${event} handler failed:`, err);
    // Return 500 so GitHub will retry; transient DB / Redis blips shouldn't
    // permanently drop a state-changing event.
    return NextResponse.json({ problem: 'handler failed' }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

async function handleInstallation(
  db: Awaited<ReturnType<typeof getServerContext>>['db'],
  payload: InstallationEventPayload,
): Promise<void> {
  const inst = payload.installation;

  if (payload.action === 'deleted') {
    // Admin uninstalled on GitHub's side — clear our local state. We don't
    // know which org installed it without the existing row, so look up
    // by installation_id.
    await db
      .delete(schema.githubInstallations)
      .where(eq(schema.githubInstallations.installationId, inst.id));
    return;
  }

  // For created / suspend / unsuspend / new_permissions_accepted, upsert by
  // (org-anchor, installation_id). We look up the existing row by
  // installation_id to find its org since GitHub doesn't tell us our org
  // mapping; the install-callback wrote the row originally with the
  // organization_id from the state JWT.
  const existing = await db
    .select({
      id: schema.githubInstallations.id,
      organizationId: schema.githubInstallations.organizationId,
    })
    .from(schema.githubInstallations)
    .where(eq(schema.githubInstallations.installationId, inst.id))
    .limit(1);

  if (!existing[0]) {
    // We received an event for an installation we have no record of. Most
    // likely a delivery for a stale install that predates our cutover.
    // Acknowledge silently; we can't reasonably create a row without org.
    console.warn(
      `[webhooks/github] ${payload.action} event for unknown installation ${inst.id}`,
    );
    return;
  }

  await db
    .update(schema.githubInstallations)
    .set({
      accountLogin: inst.account.login,
      accountType: inst.account.type,
      accountId: inst.account.id,
      repositorySelection: inst.repository_selection,
      suspendedAt: inst.suspended_at ? new Date(inst.suspended_at) : null,
    })
    .where(eq(schema.githubInstallations.id, existing[0].id));
}

async function enqueueIncrementalForInstallation(
  db: Awaited<ReturnType<typeof getServerContext>>['db'],
  installationId: number | undefined,
  deliveryId: string,
  event: string,
): Promise<void> {
  if (!installationId) {
    console.warn(
      `[webhooks/github] ${deliveryId} ${event} arrived without installation.id; skipping`,
    );
    return;
  }
  const rows = await db
    .select({ organizationId: schema.githubInstallations.organizationId })
    .from(schema.githubInstallations)
    .where(eq(schema.githubInstallations.installationId, installationId))
    .limit(1);
  const orgId = rows[0]?.organizationId;
  if (!orgId) {
    console.warn(
      `[webhooks/github] ${deliveryId} ${event} for unknown installation ${installationId}; skipping`,
    );
    return;
  }

  const sources = await db
    .select({ id: schema.sources.id })
    .from(schema.sources)
    .where(
      and(
        eq(schema.sources.organizationId, orgId),
        eq(schema.sources.provider, 'github'),
      ),
    );
  for (const src of sources) {
    await enqueueResync('github', { sourceId: src.id, organizationId: orgId });
  }
}
