import { headers } from 'next/headers';
import { z } from 'zod';
import { createCheckoutSessionForPlan } from '@holo/stripe';
import { billingEnabled } from '@holo/billing';
import { holoError, ErrorCode, HoloError } from '@holo/errors';
import { getServerContext } from '@/lib/server-context';
import { resolveActiveOrgId } from '@/lib/active-org';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  planSlug: z.enum(['starter', 'team', 'business']),
});

/**
 * Initiate a Stripe Checkout session for upgrading the active org to a paid
 * plan. Returns `{ url }` — the client redirects the browser there. Stripe
 * handles card entry; on completion the user is redirected back to
 * `/settings/billing?checkout=success`, and the webhook handler updates our
 * cache + writes the first grant.
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
        fix: 'Send { planSlug: "starter" | "team" | "business" }.',
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
    const result = await createCheckoutSessionForPlan({
      db,
      organizationId,
      planSlug: parsed.data.planSlug,
      ownerEmail,
      successUrl: `${origin}/settings/billing?checkout=success`,
      cancelUrl: `${origin}/settings/billing?checkout=cancel`,
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
    console.error('[api/stripe/checkout] unexpected', e);
    return Response.json(
      { code: 'HOLO_INTERNAL', problem: 'unexpected error', fix: 'Try again.' },
      { status: 500 },
    );
  }
}
