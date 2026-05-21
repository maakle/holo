import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { schema } from '@holo/db';
import { writeLedgerEntry, billingEnabled } from '@holo/billing';
import { holoError, ErrorCode, HoloError } from '@holo/errors';
import { getServerContext } from '@/lib/server-context';
import { captureOrgEvent } from '@/lib/posthog-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  organizationId: z.string().uuid(),
  /** Bonus credits to grant. Default 250,000 (≈ 1,250 chats post-redenom). */
  additionalCredits: z.number().int().positive().max(50_000_000).optional(),
  /** Extra days to push `trial_ends_at` out by. Default 7. */
  additionalDays: z.number().int().positive().max(90).optional(),
  /** Free-text note for the audit log. */
  reason: z.string().max(500).optional(),
});

/**
 * CS-triggered trial extension (RFC 0010 / ADR 0007 — T2).
 *
 * Auth: `x-admin-token` header must match `HOLO_CS_ADMIN_TOKEN`. Anything
 * else (missing token, mismatch) returns 401. Intentionally simple — this is
 * an internal CS tool, not a public surface.
 *
 * Behavior: extends `trial_ends_at` by `additionalDays` (default 7) and
 * grants `additionalCredits` (default 250K) via the ledger. Idempotency key
 * `trial-extend:<org_id>:<floor(now/day)>` ensures the same operator can't
 * accidentally credit twice the same day. To extend more than once, vary
 * the day or pass a unique `reason` query param via a follow-up enhancement.
 */
export async function POST(req: Request): Promise<Response> {
  try {
    if (!billingEnabled()) {
      throw holoError({
        code: ErrorCode.HOLO_ENV_INVALID,
        problem: 'billing is disabled on this installation',
        fix: 'Set HOLO_BILLING_ENABLED=true to enable trial-extension administration.',
      });
    }

    const expected = process.env.HOLO_CS_ADMIN_TOKEN;
    const provided = req.headers.get('x-admin-token');
    if (!expected || !provided || provided !== expected) {
      return new Response(
        JSON.stringify({ code: 'HOLO_AUTH_FORBIDDEN', problem: 'admin token required' }),
        { status: 401, headers: { 'content-type': 'application/json' } },
      );
    }

    const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      throw holoError({
        code: ErrorCode.HOLO_INVALID_INPUT,
        problem: `invalid request: ${parsed.error.message}`,
        fix: 'Send { organizationId: uuid, additionalCredits?, additionalDays?, reason? }.',
      });
    }

    const additionalCredits = parsed.data.additionalCredits ?? 250_000;
    const additionalDays = parsed.data.additionalDays ?? 7;

    const { db } = await getServerContext();
    const subRows = await db
      .select()
      .from(schema.organizationSubscriptions)
      .where(eq(schema.organizationSubscriptions.organizationId, parsed.data.organizationId))
      .limit(1);
    const sub = subRows[0];
    if (!sub) {
      throw holoError({
        code: ErrorCode.HOLO_NOT_FOUND,
        problem: `no subscription found for org ${parsed.data.organizationId}`,
        fix: 'Confirm the organization id is correct.',
      });
    }

    const now = new Date();
    const dayKey = Math.floor(now.getTime() / (24 * 60 * 60 * 1000));
    const idempotencyKey = `trial-extend:${parsed.data.organizationId}:${dayKey}`;

    const baseTrialEnd =
      sub.trialEndsAt && sub.trialEndsAt > now ? sub.trialEndsAt : now;
    const newTrialEnd = new Date(
      baseTrialEnd.getTime() + additionalDays * 24 * 60 * 60 * 1000,
    );

    await db
      .update(schema.organizationSubscriptions)
      .set({ trialEndsAt: newTrialEnd, updatedAt: now })
      .where(eq(schema.organizationSubscriptions.organizationId, parsed.data.organizationId));

    await writeLedgerEntry(db, {
      organizationId: parsed.data.organizationId,
      kind: 'topup',
      credits: additionalCredits,
      reason: 'manual',
      referenceKind: 'manual',
      referenceId: idempotencyKey,
      idempotencyKey,
      metadata: {
        source: 'cs_trial_extension',
        additional_days: additionalDays,
        new_trial_ends_at: newTrialEnd.toISOString(),
        ...(parsed.data.reason ? { note: parsed.data.reason } : {}),
      },
    });

    captureOrgEvent({
      organizationId: parsed.data.organizationId,
      event: 'holo.trial.extended',
      properties: {
        additional_credits: additionalCredits,
        additional_days: additionalDays,
        new_trial_ends_at: newTrialEnd.toISOString(),
        ...(parsed.data.reason ? { reason: parsed.data.reason } : {}),
      },
    });

    return Response.json({
      ok: true,
      trialEndsAt: newTrialEnd.toISOString(),
      creditsGranted: additionalCredits,
    });
  } catch (e) {
    if (e instanceof HoloError) {
      const status =
        e.code === 'HOLO_INVALID_INPUT' || e.code === 'HOLO_NOT_FOUND'
          ? 400
          : e.code === 'HOLO_ENV_INVALID'
            ? 503
            : 500;
      return Response.json(e.toJSON(), { status });
    }
    console.error('[api/admin/trial/extend] unexpected', e);
    return Response.json(
      { code: 'HOLO_INTERNAL', problem: 'unexpected error', fix: 'Try again.' },
      { status: 500 },
    );
  }
}
