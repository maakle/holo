/**
 * Stripe API helpers built on the framework's HttpClient.
 *
 * Pagination is `?starting_after=<id>&limit=100` — Stripe's universal
 * cursor scheme. We do NOT filter by `created` on incremental syncs even
 * though Stripe accepts it: subscriptions and invoices mutate (status,
 * cancel_at, amount_paid) without bumping `created`, so a `created`
 * watermark would miss updates. Instead the resource sync walks back
 * until it sees an id it already ingested this run, capping at a fixed
 * page budget for the daily cadence.
 *
 * `expand[]` is used sparingly: only on the subscription item / price
 * path so the chunker can render the plan nickname inline without a
 * second API call per record.
 */
import type { HttpClient } from '@holo/connector-framework';
import type {
  StripeAccount,
  StripeCharge,
  StripeCustomer,
  StripeInvoice,
  StripeList,
  StripeSubscription,
} from './types';

const PAGE_LIMIT = 100;

export interface ListPageOptions {
  startingAfter?: string;
  /** Unix seconds; only used on first-run full sweeps to cap how far back we go. */
  createdGt?: number;
}

function buildQuery(opts: ListPageOptions, extra: string = ''): string {
  const parts = [`limit=${PAGE_LIMIT}`];
  if (opts.startingAfter) parts.push(`starting_after=${encodeURIComponent(opts.startingAfter)}`);
  if (opts.createdGt !== undefined) {
    parts.push(`created%5Bgt%5D=${opts.createdGt}`);
  }
  if (extra) parts.push(extra);
  return parts.join('&');
}

export async function fetchAccount(api: HttpClient): Promise<StripeAccount> {
  return api.get<StripeAccount>('/v1/account');
}

export async function listCustomers(
  api: HttpClient,
  opts: ListPageOptions,
): Promise<StripeList<StripeCustomer>> {
  return api.get<StripeList<StripeCustomer>>(`/v1/customers?${buildQuery(opts)}`);
}

export async function listSubscriptions(
  api: HttpClient,
  opts: ListPageOptions,
): Promise<StripeList<StripeSubscription>> {
  // status=all surfaces canceled subscriptions too, which we need for churn
  // analytics. expand[]=data.items.data.price.product lets the chunker
  // render plan nicknames without a per-record fetch.
  const extra = 'status=all&expand%5B%5D=data.items.data.price.product';
  return api.get<StripeList<StripeSubscription>>(`/v1/subscriptions?${buildQuery(opts, extra)}`);
}

export async function listInvoices(
  api: HttpClient,
  opts: ListPageOptions,
): Promise<StripeList<StripeInvoice>> {
  return api.get<StripeList<StripeInvoice>>(`/v1/invoices?${buildQuery(opts)}`);
}

export async function listCharges(
  api: HttpClient,
  opts: ListPageOptions,
): Promise<StripeList<StripeCharge>> {
  return api.get<StripeList<StripeCharge>>(`/v1/charges?${buildQuery(opts)}`);
}
