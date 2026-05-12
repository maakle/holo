/**
 * Stripe API response shapes — narrow projections of the v1 endpoints the
 * connector reads from. Stripe returns far more fields than we index; we
 * intentionally keep this surface small so the chunker stays predictable
 * and the embedding cost stays bounded.
 *
 * Timestamps are Unix seconds (Stripe convention); amounts are integer
 * minor units (cents for USD, sen for JPY, etc).
 */

export type StripeObjectType = 'customer' | 'subscription' | 'invoice' | 'charge';

export interface StripeList<T> {
  object: 'list';
  data: T[];
  has_more: boolean;
  url?: string;
}

export interface StripeAccount {
  id: string;
  email?: string | null;
  business_profile?: { name?: string | null } | null;
  settings?: { dashboard?: { display_name?: string | null } | null } | null;
}

export interface StripeCustomer {
  id: string;
  object: 'customer';
  created: number;
  email?: string | null;
  name?: string | null;
  description?: string | null;
  livemode: boolean;
  delinquent?: boolean | null;
  currency?: string | null;
  metadata?: Record<string, string> | null;
}

export interface StripePrice {
  id: string;
  object?: 'price';
  unit_amount?: number | null;
  currency?: string | null;
  nickname?: string | null;
  recurring?: { interval: 'day' | 'week' | 'month' | 'year'; interval_count: number } | null;
  product?: string | { id: string; name?: string | null } | null;
}

export interface StripeSubscriptionItem {
  id: string;
  quantity?: number | null;
  price?: StripePrice | null;
}

export interface StripeSubscription {
  id: string;
  object: 'subscription';
  created: number;
  status: string;
  customer: string | { id: string };
  livemode: boolean;
  start_date?: number | null;
  current_period_start?: number | null;
  current_period_end?: number | null;
  canceled_at?: number | null;
  cancel_at_period_end?: boolean | null;
  trial_end?: number | null;
  currency?: string | null;
  items?: { data?: StripeSubscriptionItem[] } | null;
  metadata?: Record<string, string> | null;
}

export interface StripeInvoice {
  id: string;
  object: 'invoice';
  created: number;
  number?: string | null;
  status?: string | null;
  customer?: string | { id: string } | null;
  customer_email?: string | null;
  subscription?: string | { id: string } | null;
  amount_due?: number | null;
  amount_paid?: number | null;
  amount_remaining?: number | null;
  currency?: string | null;
  period_start?: number | null;
  period_end?: number | null;
  paid?: boolean | null;
  livemode: boolean;
  hosted_invoice_url?: string | null;
}

export interface StripeCharge {
  id: string;
  object: 'charge';
  created: number;
  amount: number;
  amount_captured?: number | null;
  amount_refunded?: number | null;
  currency: string;
  status?: string | null;
  paid?: boolean | null;
  refunded?: boolean | null;
  captured?: boolean | null;
  customer?: string | { id: string } | null;
  description?: string | null;
  invoice?: string | { id: string } | null;
  receipt_email?: string | null;
  livemode: boolean;
  payment_method_details?: { type?: string | null } | null;
  failure_message?: string | null;
}

export type StripeAnyObject =
  | StripeCustomer
  | StripeSubscription
  | StripeInvoice
  | StripeCharge;
