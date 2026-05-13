/**
 * Customer-account resolution at ingest time.
 *
 * The `customer_accounts` table is the "customer-of-the-tenant" entity: one
 * row per HubSpot Company / Pylon Account / Salesforce Account, scoped to a
 * Holo organization. Connectors don't talk to the DB directly — they emit
 * two flavours of hint on `chunk.metadata`, and the worker's embed-insert
 * path calls `resolveCustomerAccountsForBatch` to turn them into
 * `chunks.account_id` stamps in one pass.
 *
 * The hints:
 *
 *   metadata.customer_account_upsert: full row payload from the canonical
 *   source (a HubSpot company chunk, a Salesforce account chunk). The
 *   resolver upserts the row keyed by (organization_id, <source>_id) and
 *   stamps the resulting id on this chunk.
 *
 *   metadata.customer_account_hint: a tuple of weak identifiers
 *   (hubspot_company_id / salesforce_account_id / pylon_account_id / domain)
 *   on a *non-canonical* chunk (a deal, a ticket, an opportunity). The
 *   resolver looks up an existing row; on no match the chunk's account_id
 *   stays NULL.
 *
 * Both hint keys are stripped from metadata before the chunk is persisted —
 * they're a transport-layer convention, not durable data.
 */
import { holoError, ErrorCode } from '@holo/errors';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Sql = any;

/** Source of truth for an upserted customer account. */
export type CustomerAccountSource = 'hubspot' | 'salesforce' | 'pylon';

export interface CustomerAccountUpsertHint {
  source: CustomerAccountSource;
  /** HubSpot company id / Salesforce Account Id / Pylon account id. */
  externalId: string;
  displayName: string;
  primaryDomain?: string;
  domains?: string[];
  aliases?: string[];
  arrAmount?: number;
  arrCurrency?: string;
  tier?: string;
  ownerEmail?: string;
  lifecycleStage?: string;
  /** Free-form passthrough for fields the schema doesn't model. Merged into
   * the row's `metadata` jsonb. */
  rawProperties?: Record<string, unknown>;
}

export interface CustomerAccountResolveHint {
  hubspotCompanyId?: string;
  salesforceAccountId?: string;
  pylonAccountId?: string;
  /** Bare domain (e.g. 'skello.io'), no protocol. Matched against
   * `primary_domain` and the `domains` array. */
  domain?: string;
}

export const CUSTOMER_ACCOUNT_UPSERT_KEY = 'customer_account_upsert' as const;
export const CUSTOMER_ACCOUNT_HINT_KEY = 'customer_account_hint' as const;

interface InputRow {
  organizationId: string;
  metadata: Record<string, unknown> | null | undefined;
}

interface RowResolution {
  accountId: string | null;
}

/**
 * Walk a batch of chunk-shaped rows, upsert any customer_accounts rows
 * declared via `customer_account_upsert` hints, then resolve every row's
 * `customer_account_hint` (and `customer_account_upsert`) to an account id.
 *
 * Returns an array parallel to `rows` so callers can stamp `account_id`
 * inline before the bulk insert. Rows with no hints (or hints that don't
 * resolve to an existing row) get `{ accountId: null }`.
 */
export async function resolveCustomerAccountsForBatch(
  sql: Sql,
  rows: ReadonlyArray<InputRow>,
): Promise<RowResolution[]> {
  if (rows.length === 0) return [];

  // 1. Collect upserts per (orgId, source, externalId). One row in
  //    `customer_accounts` per such tuple — within a batch we dedupe so the
  //    SQL upsert hits each row once.
  type UpsertKey = string; // `${orgId}|${source}|${externalId}`
  const upserts = new Map<UpsertKey, { orgId: string; hint: CustomerAccountUpsertHint }>();
  for (const row of rows) {
    const upsert = readUpsertHint(row.metadata);
    if (!upsert) continue;
    const key = `${row.organizationId}|${upsert.source}|${upsert.externalId}`;
    if (!upserts.has(key)) upserts.set(key, { orgId: row.organizationId, hint: upsert });
  }

  // Execute upserts. Each source has its own partial-unique index, so we
  // dispatch per source and rely on ON CONFLICT to merge.
  const upsertedIdByKey = new Map<UpsertKey, string>();
  for (const source of ['hubspot', 'salesforce', 'pylon'] as const) {
    const entries = [...upserts.entries()].filter(([, v]) => v.hint.source === source);
    if (entries.length === 0) continue;
    const ids = await upsertCustomerAccounts(sql, source, entries.map(([, v]) => v));
    entries.forEach(([key], i) => {
      const id = ids[i];
      if (id) upsertedIdByKey.set(key, id);
    });
  }

  // 2. Collect resolution lookups. We bulk-query by each identity kind so the
  //    cost is O(distinct hints), not O(rows).
  const hubspotIds = new Set<string>();
  const salesforceIds = new Set<string>();
  const pylonIds = new Set<string>();
  const domains = new Set<string>(); // lower-cased
  const orgIds = new Set<string>();
  for (const row of rows) {
    orgIds.add(row.organizationId);
    const resolve = readResolveHint(row.metadata);
    if (!resolve) continue;
    if (resolve.hubspotCompanyId) hubspotIds.add(resolve.hubspotCompanyId);
    if (resolve.salesforceAccountId) salesforceIds.add(resolve.salesforceAccountId);
    if (resolve.pylonAccountId) pylonIds.add(resolve.pylonAccountId);
    if (resolve.domain) domains.add(resolve.domain.toLowerCase());
  }

  // The lookup tables are keyed by (orgId, identityValue) because the same
  // HubSpot company id could theoretically belong to two different Holo
  // tenants. In practice it won't, but the schema doesn't forbid it.
  const lookupByOrg = new Map<string, ResolvedLookups>();
  for (const orgId of orgIds) {
    lookupByOrg.set(orgId, await loadLookups(sql, orgId, {
      hubspotIds,
      salesforceIds,
      pylonIds,
      domains,
    }));
  }

  // 3. Per-row resolution. Upsert hints win over resolve hints (the canonical
  //    source dictates the row's identity). Resolve order across identity
  //    kinds: hubspot → salesforce → pylon → domain. Most specific first.
  return rows.map((row) => {
    const upsert = readUpsertHint(row.metadata);
    if (upsert) {
      const key = `${row.organizationId}|${upsert.source}|${upsert.externalId}`;
      const id = upsertedIdByKey.get(key);
      return { accountId: id ?? null };
    }
    const resolve = readResolveHint(row.metadata);
    if (!resolve) return { accountId: null };
    const lookups = lookupByOrg.get(row.organizationId);
    if (!lookups) return { accountId: null };
    if (resolve.hubspotCompanyId) {
      const id = lookups.byHubspot.get(resolve.hubspotCompanyId);
      if (id) return { accountId: id };
    }
    if (resolve.salesforceAccountId) {
      const id = lookups.bySalesforce.get(resolve.salesforceAccountId);
      if (id) return { accountId: id };
    }
    if (resolve.pylonAccountId) {
      const id = lookups.byPylon.get(resolve.pylonAccountId);
      if (id) return { accountId: id };
    }
    if (resolve.domain) {
      const id = lookups.byDomain.get(resolve.domain.toLowerCase());
      if (id) return { accountId: id };
    }
    return { accountId: null };
  });
}

/** Strip the transport-layer hint keys so they don't leak into chunk metadata. */
export function stripCustomerAccountHints(
  metadata: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  if (!metadata || typeof metadata !== 'object') return {};
  if (!(CUSTOMER_ACCOUNT_UPSERT_KEY in metadata) && !(CUSTOMER_ACCOUNT_HINT_KEY in metadata)) {
    return metadata;
  }
  const out = { ...metadata };
  delete out[CUSTOMER_ACCOUNT_UPSERT_KEY];
  delete out[CUSTOMER_ACCOUNT_HINT_KEY];
  return out;
}

/** Extract a possibly-malformed hint without throwing — bad hints just
 *  resolve to "no account". */
function readUpsertHint(
  metadata: Record<string, unknown> | null | undefined,
): CustomerAccountUpsertHint | null {
  if (!metadata || typeof metadata !== 'object') return null;
  const raw = metadata[CUSTOMER_ACCOUNT_UPSERT_KEY];
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Partial<CustomerAccountUpsertHint>;
  if (!r.source || !r.externalId || !r.displayName) return null;
  if (r.source !== 'hubspot' && r.source !== 'salesforce' && r.source !== 'pylon') return null;
  return r as CustomerAccountUpsertHint;
}

function readResolveHint(
  metadata: Record<string, unknown> | null | undefined,
): CustomerAccountResolveHint | null {
  if (!metadata || typeof metadata !== 'object') return null;
  const raw = metadata[CUSTOMER_ACCOUNT_HINT_KEY];
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as CustomerAccountResolveHint;
  if (!r.hubspotCompanyId && !r.salesforceAccountId && !r.pylonAccountId && !r.domain) {
    return null;
  }
  return r;
}

interface ResolvedLookups {
  byHubspot: Map<string, string>;
  bySalesforce: Map<string, string>;
  byPylon: Map<string, string>;
  byDomain: Map<string, string>; // lower-cased domain → account id
}

async function loadLookups(
  sql: Sql,
  organizationId: string,
  hints: {
    hubspotIds: Set<string>;
    salesforceIds: Set<string>;
    pylonIds: Set<string>;
    domains: Set<string>;
  },
): Promise<ResolvedLookups> {
  const byHubspot = new Map<string, string>();
  const bySalesforce = new Map<string, string>();
  const byPylon = new Map<string, string>();
  const byDomain = new Map<string, string>();

  if (hints.hubspotIds.size > 0) {
    const ids = [...hints.hubspotIds];
    const rows = await sql<{ id: string; hubspot_company_id: string }[]>`
      SELECT id, hubspot_company_id
      FROM customer_accounts
      WHERE organization_id = ${organizationId}
        AND hubspot_company_id = ANY(${ids}::text[])
    `;
    for (const r of rows) byHubspot.set(r.hubspot_company_id, r.id);
  }
  if (hints.salesforceIds.size > 0) {
    const ids = [...hints.salesforceIds];
    const rows = await sql<{ id: string; salesforce_account_id: string }[]>`
      SELECT id, salesforce_account_id
      FROM customer_accounts
      WHERE organization_id = ${organizationId}
        AND salesforce_account_id = ANY(${ids}::text[])
    `;
    for (const r of rows) bySalesforce.set(r.salesforce_account_id, r.id);
  }
  if (hints.pylonIds.size > 0) {
    const ids = [...hints.pylonIds];
    const rows = await sql<{ id: string; pylon_account_id: string }[]>`
      SELECT id, pylon_account_id
      FROM customer_accounts
      WHERE organization_id = ${organizationId}
        AND pylon_account_id = ANY(${ids}::text[])
    `;
    for (const r of rows) byPylon.set(r.pylon_account_id, r.id);
  }
  if (hints.domains.size > 0) {
    const ds = [...hints.domains];
    // Match primary_domain OR any entry in the `domains` text[] array.
    const rows = await sql<{ id: string; primary_domain: string | null; domains: string[] }[]>`
      SELECT id, primary_domain, domains
      FROM customer_accounts
      WHERE organization_id = ${organizationId}
        AND (
          LOWER(primary_domain) = ANY(${ds}::text[])
          OR domains && ${ds}::text[]
        )
    `;
    for (const r of rows) {
      if (r.primary_domain) {
        byDomain.set(r.primary_domain.toLowerCase(), r.id);
      }
      for (const d of r.domains ?? []) {
        byDomain.set(d.toLowerCase(), r.id);
      }
    }
  }

  return { byHubspot, bySalesforce, byPylon, byDomain };
}

/**
 * Upsert one source's batch of customer_accounts rows. Returns ids in the
 * same order as `entries`. We can't rely on RETURNING order matching the
 * VALUES order across ON CONFLICT DO UPDATE, so we round-trip via the
 * per-source external id (which is what the partial-unique index pins).
 */
async function upsertCustomerAccounts(
  sql: Sql,
  source: CustomerAccountSource,
  entries: ReadonlyArray<{ orgId: string; hint: CustomerAccountUpsertHint }>,
): Promise<(string | undefined)[]> {
  const externalIdColumn = externalIdColumnFor(source);
  const conflictTarget = conflictTargetFor(source);

  const rows = entries.map(({ orgId, hint }) => ({
    organization_id: orgId,
    display_name: hint.displayName,
    primary_domain: hint.primaryDomain ?? null,
    domains: hint.domains ?? [],
    aliases: hint.aliases ?? [],
    hubspot_company_id: source === 'hubspot' ? hint.externalId : null,
    salesforce_account_id: source === 'salesforce' ? hint.externalId : null,
    pylon_account_id: source === 'pylon' ? hint.externalId : null,
    arr_amount: hint.arrAmount ?? null,
    arr_currency: hint.arrCurrency ?? null,
    tier: hint.tier ?? null,
    owner_email: hint.ownerEmail ?? null,
    lifecycle_stage: hint.lifecycleStage ?? null,
    metadata: JSON.stringify(hint.rawProperties ?? {}),
  }));

  // ON CONFLICT (organization_id, <source>_id) DO UPDATE — refresh the
  // facets that come from the canonical source on every sync. The partial
  // unique index only matches rows where the source id is not null, which
  // is always true for rows we're upserting here (we just set it above).
  await sql`
    INSERT INTO customer_accounts ${sql(
      rows,
      'organization_id',
      'display_name',
      'primary_domain',
      'domains',
      'aliases',
      'hubspot_company_id',
      'salesforce_account_id',
      'pylon_account_id',
      'arr_amount',
      'arr_currency',
      'tier',
      'owner_email',
      'lifecycle_stage',
      'metadata',
    )}
    ON CONFLICT ${sql.unsafe(conflictTarget)}
    DO UPDATE SET
      display_name = EXCLUDED.display_name,
      primary_domain = COALESCE(EXCLUDED.primary_domain, customer_accounts.primary_domain),
      domains = (
        SELECT ARRAY(SELECT DISTINCT unnest(customer_accounts.domains || EXCLUDED.domains))
      ),
      aliases = (
        SELECT ARRAY(SELECT DISTINCT unnest(customer_accounts.aliases || EXCLUDED.aliases))
      ),
      arr_amount = COALESCE(EXCLUDED.arr_amount, customer_accounts.arr_amount),
      arr_currency = COALESCE(EXCLUDED.arr_currency, customer_accounts.arr_currency),
      tier = COALESCE(EXCLUDED.tier, customer_accounts.tier),
      owner_email = COALESCE(EXCLUDED.owner_email, customer_accounts.owner_email),
      lifecycle_stage = COALESCE(EXCLUDED.lifecycle_stage, customer_accounts.lifecycle_stage),
      metadata = customer_accounts.metadata || EXCLUDED.metadata,
      updated_at = NOW()
  `;

  // Round-trip the ids by (org, externalId).
  const orgIds = [...new Set(entries.map((e) => e.orgId))];
  const externalIds = entries.map((e) => e.hint.externalId);
  const lookup = await sql<{ id: string; org: string; ext: string }[]>`
    SELECT id, organization_id AS org, ${sql.unsafe(externalIdColumn)} AS ext
    FROM customer_accounts
    WHERE organization_id = ANY(${orgIds}::uuid[])
      AND ${sql.unsafe(externalIdColumn)} = ANY(${externalIds}::text[])
  `;
  const idByKey = new Map<string, string>();
  for (const r of lookup) idByKey.set(`${r.org}|${r.ext}`, r.id);

  return entries.map((e) => idByKey.get(`${e.orgId}|${e.hint.externalId}`));
}

function externalIdColumnFor(source: CustomerAccountSource): string {
  switch (source) {
    case 'hubspot': return 'hubspot_company_id';
    case 'salesforce': return 'salesforce_account_id';
    case 'pylon': return 'pylon_account_id';
    default:
      throw holoError({
        code: ErrorCode.HOLO_INTERNAL,
        problem: `Unknown customer-account source: ${source as string}`,
        fix: 'Add it to CustomerAccountSource and the upsert dispatch.',
      });
  }
}

function conflictTargetFor(source: CustomerAccountSource): string {
  // Partial unique indexes are NOT constraints — `ON CONFLICT ON CONSTRAINT`
  // doesn't see them. The column-and-predicate form lets Postgres infer the
  // correct partial index. The predicate must match the index's WHERE clause
  // verbatim (modulo whitespace) for inference to succeed.
  switch (source) {
    case 'hubspot':
      return '(organization_id, hubspot_company_id) WHERE hubspot_company_id IS NOT NULL';
    case 'salesforce':
      return '(organization_id, salesforce_account_id) WHERE salesforce_account_id IS NOT NULL';
    case 'pylon':
      return '(organization_id, pylon_account_id) WHERE pylon_account_id IS NOT NULL';
    default:
      throw holoError({
        code: ErrorCode.HOLO_INTERNAL,
        problem: `Unknown customer-account source: ${source as string}`,
        fix: 'Add it to CustomerAccountSource and the upsert dispatch.',
      });
  }
}
