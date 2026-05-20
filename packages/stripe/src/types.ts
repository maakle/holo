import StripeImport from 'stripe';

/**
 * Type aliases for Stripe SDK resources that work under any `moduleResolution`.
 *
 * Stripe SDK v22 has a quirk in its CJS typings: `cjs/stripe.cjs.node.d.ts`
 * uses `export = StripeConstructor` where `StripeConstructor` is both a const
 * (the callable) and a namespace (with one member `type Stripe`). Under
 * `moduleResolution: "Node"` (our NestJS worker), `import Stripe from 'stripe'`
 * resolves the bare `Stripe` type to the namespace — and a namespace can't be
 * used as a type. The ESM d.ts works fine because it `export default Stripe`s
 * the merged class, so bundler-resolution consumers don't see this.
 *
 * Workaround:
 *   - For the client type: `InstanceType<typeof StripeImport>` — works in both
 *     resolutions because the v22 CJS shape includes a `new(...): Stripe`
 *     signature on the value side, and ESM's default is the class itself.
 *   - For resource types: infer from client method signatures. `Unwrap`
 *     strips the SDK's `Response<T>` envelope (just a `lastResponse` field we
 *     never read) so handlers see the same plain-object shape that webhook
 *     payloads carry.
 */
export type StripeClient = InstanceType<typeof StripeImport>;
type Unwrap<T> = T extends { lastResponse: unknown } ? Omit<T, 'lastResponse'> : T;

// `constructEvent` is a local parse, not an API call — returns raw Event.
export type StripeEvent = ReturnType<StripeClient['webhooks']['constructEvent']>;
export type StripeSubscription = Unwrap<
  Awaited<ReturnType<StripeClient['subscriptions']['retrieve']>>
>;
export type StripeCheckoutSession = Unwrap<
  Awaited<ReturnType<StripeClient['checkout']['sessions']['retrieve']>>
>;
export type StripeInvoice = Unwrap<
  Awaited<ReturnType<StripeClient['invoices']['retrieve']>>
>;
