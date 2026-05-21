import { headers } from 'next/headers';
import { z } from 'zod';
import { createCheckoutSessionForTopup } from '@holo/stripe';
import { billingEnabled } from '@holo/billing';
import { holoError, ErrorCode, HoloError } from '@holo/errors';
import { getServerContext } from '@/lib/server-context';
import { resolveActiveOrgId } from '@/lib/active-org';
import { captureOrgEvent } from '@/lib/posthog-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  packageSlug: z.enum(['topup-small', 'topup-medium', 'topup-large']),
});

/**
 * Initiate a Stripe Checkout session for purchasing a one-shot credit top-up.
 * Available on every tier — including the free / trial tier — so customers
 * can buy more credits any time without committing to a higher subscription.
 * Returns `{ url }` for the client to redirect to.
 */
export async function POST(req: Request): Promise<Response> {
  try {
    if (!billingEnabled()) {
      throw holoError({
        code: ErrorCode.HOLO_ENV_INVALID,
        problem: 'billing is disabled on this installation',
        fix: 'Set HOLO_BILLING_ENABLED=true on the web + worker processes.',
      });
    }

    const { auth, db, env } = await getServerContext();
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) {
      throw holoError({
        code: ErrorCode.HOLO_AUTH_NO_SESSION,
        problem: 'must be signed in',
        fix: 'Sign in and retry.',
      });
    }

    const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      throw holoError({
        code: ErrorCode.HOLO_INVALID_INPUT,
        problem: `invalid request: ${parsed.error.message}`,
        fix: 'Send { packageSlug: "topup-small" | "topup-medium" | "topup-large" }.',
      });
    }

    const organizationId = resolveActiveOrgId(session);
    const ownerEmail = session.user.email;
    if (!ownerEmail) {
      throw holoError({
        code: ErrorCode.HOLO_INVALID_INPUT,
        problem: 'user has no email on file',
        fix: 'Sign in with an account that has a verified email address.',
      });
    }

    const origin = env.BETTER_AUTH_URL.replace(/\/+$/, '');
    const result = await createCheckoutSessionForTopup({
      db,
      organizationId,
      packageSlug: parsed.data.packageSlug,
      ownerEmail,
      successUrl: `${origin}/settings/billing?topup=success`,
      cancelUrl: `${origin}/settings/billing?topup=cancel`,
    });

    captureOrgEvent({
      organizationId,
      event: 'holo.checkout.started',
      properties: {
        surface: 'web',
        kind: 'topup',
        package_slug: parsed.data.packageSlug,
        checkout_session_id: result.sessionId,
      },
    });

    return Response.json({ url: result.url });
  } catch (e) {
    if (e instanceof HoloError) {
      const status =
        e.code === 'HOLO_AUTH_NO_SESSION'
          ? 401
          : e.code === 'HOLO_INVALID_INPUT' || e.code === 'HOLO_NOT_FOUND'
            ? 400
            : 500;
      return Response.json(e.toJSON(), { status });
    }
    console.error('[api/stripe/topup/checkout] unexpected', e);
    return Response.json(
      { code: 'HOLO_INTERNAL', problem: 'unexpected error', fix: 'Try again.' },
      { status: 500 },
    );
  }
}
