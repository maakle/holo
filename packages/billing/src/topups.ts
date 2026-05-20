import { eq, asc } from 'drizzle-orm';
import { schema, type DB } from '@holo/db';

const { creditTopupPackages } = schema;

export interface TopupPackageRow {
  id: string;
  slug: string;
  name: string;
  credits: number;
  priceCents: number;
  /** Null until the worker boot has provisioned the Stripe Price. */
  stripePriceId: string | null;
  sortOrder: number;
}

/**
 * List active credit top-up packages for the settings/billing UI. Ordered by
 * `sort_order` so Small / Medium / Large render in a stable sequence.
 */
export async function listActiveTopupPackages(db: DB): Promise<TopupPackageRow[]> {
  const rows = await db
    .select()
    .from(creditTopupPackages)
    .where(eq(creditTopupPackages.isActive, true))
    .orderBy(asc(creditTopupPackages.sortOrder));

  return rows.map((row) => ({
    id: row.id,
    slug: row.slug,
    name: row.name,
    credits: Number(row.credits),
    priceCents: row.priceCents,
    stripePriceId: row.stripePriceId,
    sortOrder: row.sortOrder,
  }));
}
