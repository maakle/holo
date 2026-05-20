import { headers } from 'next/headers';
import { createCustomerPortalSession } from '@holo/stripe';
import { billingEnabled } from '@holo/billing';
import { holoError, ErrorCode, HoloError } from '@holo/errors';
import { getServerContext } from '@/lib/server-context';
import { resolveActiveOrgId } from '@/lib/active-org';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Open the Stripe Customer Portal for the active org. Stripe-hosted UI;
 * users can update card, change plan, cancel, view invoices. Returns
 * `{ url }` for client-side redirect.
 *
 * Only available for orgs that have completed Checkout at least once
 * (i.e. have a `stripe_customer_id`). The portal CTA in
 * `/settings/billing` is hidden otherwise.
 */
export async function POST(): Promise<Response> {
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
    const organizationId = resolveActiveOrgId(session);
    const origin = env.BETTER_AUTH_URL.replace(/\/+$/, '');
    const { url } = await createCustomerPortalSession({
      db,
      organizationId,
      returnUrl: `${origin}/settings/billing`,
    });
    return Response.json({ url });
  } catch (e) {
    if (e instanceof HoloError) {
      const status =
        e.code === 'HOLO_AUTH_NO_SESSION'
          ? 401
          : e.code === 'HOLO_NOT_FOUND'
            ? 404
            : e.code === 'HOLO_INVALID_INPUT'
              ? 400
              : 500;
      return Response.json(e.toJSON(), { status });
    }
    console.error('[api/stripe/portal] unexpected', e);
    return Response.json(
      { code: 'HOLO_INTERNAL', problem: 'unexpected error', fix: 'Try again.' },
      { status: 500 },
    );
  }
}
