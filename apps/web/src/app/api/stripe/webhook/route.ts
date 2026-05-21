import { handleStripeEvent, verifyStripeSignature } from '@holo/stripe';
import { billingEnabled } from '@holo/billing';
import { HoloError } from '@holo/errors';
import { getServerContext } from '@/lib/server-context';
import { captureOrgEvent } from '@/lib/posthog-server';

// Stripe needs the raw request body to compute the signature; running on
// Node lets us read it as a string without the Edge runtime's body-stream
// quirks.
export const runtime = 'nodejs';
// Webhooks must run on every request; never cache.
export const dynamic = 'force-dynamic';

/**
 * Stripe webhook receiver. Endpoint URL is configured in the Stripe
 * dashboard as `/api/stripe/webhook` on the public web origin.
 *
 * Contract (per Stripe docs):
 *   - Return 2xx within ~20s to acknowledge delivery.
 *   - Return 4xx on signature failure (stops retries — the request is malformed).
 *   - Return 5xx on transient errors so Stripe retries with exponential backoff.
 *
 * Idempotency is handled inside `handleStripeEvent` via the
 * `stripe_webhook_events` table (PK on Stripe event id).
 */
export async function POST(req: Request): Promise<Response> {
  if (!billingEnabled()) {
    // Self-hosted CE shouldn't run the webhook even if someone points Stripe
    // at it. Return 200 so Stripe doesn't retry.
    return new Response('billing disabled', { status: 200 });
  }

  const signature = req.headers.get('stripe-signature');
  if (!signature) {
    return new Response('missing stripe-signature header', { status: 400 });
  }
  const rawBody = await req.text();

  let event;
  try {
    event = verifyStripeSignature({ rawBody, signature });
  } catch (e) {
    if (e instanceof HoloError) {
      return new Response(e.problem, { status: 400 });
    }
    return new Response('signature verification failed', { status: 400 });
  }

  try {
    const { db } = await getServerContext();
    await handleStripeEvent(db, event);
    // Best-effort analytics on the key pricing-funnel events. Inspect the raw
    // event object since the handler doesn't return anything. Each branch
    // re-extracts org id from metadata so analytics emission is independent
    // of handler internals.
    try {
      emitFunnelEvent(event);
    } catch (analyticsErr) {
      // Never fail the webhook because analytics threw.
      console.warn('[api/stripe/webhook] funnel event emit failed', analyticsErr);
    }
    return new Response('ok', { status: 200 });
  } catch (e) {
    // Surface to Stripe as 5xx so it retries with backoff. The error is
    // already recorded on the `stripe_webhook_events` row by the handler.
    console.error('[api/stripe/webhook] handler error', e);
    return new Response('handler error', { status: 500 });
  }
}

/**
 * Emit posthog funnel events for the pricing-relevant Stripe webhook types.
 * RFC 0010 / ADR 0007. Best-effort and isolated from the handler — if posthog
 * is down, the webhook still succeeds.
 */
function emitFunnelEvent(event: { type: string; data: { object: unknown } }): void {
  const obj = event.data.object as {
    metadata?: { organization_id?: string; topup_package_slug?: string; plan_slug?: string };
    mode?: string;
    amount_total?: number;
    id?: string;
  };
  const organizationId = obj.metadata?.organization_id;
  if (!organizationId) return;

  if (event.type === 'checkout.session.completed') {
    if (obj.metadata?.topup_package_slug) {
      captureOrgEvent({
        organizationId,
        event: 'holo.topup.purchased',
        properties: {
          package_slug: obj.metadata.topup_package_slug,
          amount_cents: obj.amount_total ?? null,
          checkout_session_id: obj.id ?? null,
        },
      });
    } else if (obj.metadata?.plan_slug) {
      captureOrgEvent({
        organizationId,
        event: 'holo.subscription.first_payment',
        properties: {
          plan_slug: obj.metadata.plan_slug,
          checkout_session_id: obj.id ?? null,
        },
      });
    }
    return;
  }

  if (event.type === 'customer.subscription.created') {
    captureOrgEvent({
      organizationId,
      event: 'holo.subscription.created',
      properties: { plan_slug: obj.metadata?.plan_slug ?? null },
    });
    return;
  }

  if (event.type === 'customer.subscription.updated') {
    captureOrgEvent({
      organizationId,
      event: 'holo.subscription.updated',
      properties: { plan_slug: obj.metadata?.plan_slug ?? null },
    });
    return;
  }

  if (event.type === 'customer.subscription.deleted') {
    captureOrgEvent({
      organizationId,
      event: 'holo.subscription.canceled',
      properties: { plan_slug: obj.metadata?.plan_slug ?? null },
    });
    return;
  }
}
