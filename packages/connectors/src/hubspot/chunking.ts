/**
 * HubSpot record → chunk projection.
 *
 * A record's "body" (contact / deal / company) and its engagement timeline
 * (notes / calls / emails / meetings / tasks) all share one source-artifacts
 * row keyed by the parent record. Chunk `kind` differs (hubspot-engagement
 * vs the per-record kind) so retrieval can filter by activity.
 */
import {
  hubspotRecordChunker,
  type HubspotRecordInput,
  type HubspotRecordType,
} from '@holo/chunker';
import type { ResourceSyncContext } from '@holo/connector-framework';
import {
  CUSTOMER_ACCOUNT_HINT_KEY,
  CUSTOMER_ACCOUNT_UPSERT_KEY,
  type CustomerAccountResolveHint,
  type CustomerAccountUpsertHint,
} from '../shared/customer-accounts';
import { fetchEngagementsForRecord } from './api';
import type { HubspotEngagement, HubspotObjectType, HubspotRecord } from './types';

const OBJECT_TO_RECORD_TYPE: Record<HubspotObjectType, HubspotRecordType> = {
  contacts: 'contact',
  deals: 'deal',
  companies: 'company',
};

function deriveDisplayName(
  recordType: HubspotRecordType,
  props: Record<string, string | null>,
): string {
  if (recordType === 'contact') {
    const first = props['firstname'] ?? '';
    const last = props['lastname'] ?? '';
    const joined = `${first} ${last}`.trim();
    if (joined) return joined;
    return props['email'] ?? 'Contact';
  }
  if (recordType === 'deal') return props['dealname'] ?? 'Deal';
  return props['name'] ?? props['domain'] ?? 'Company';
}

function nonEmptyProps(
  props: Record<string, string | null>,
): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const [k, v] of Object.entries(props)) {
    if (v === null || v === undefined || v === '') continue;
    out[k] = v;
  }
  return out;
}

function emailDomain(email: string | null | undefined): string | undefined {
  if (!email) return undefined;
  const at = email.lastIndexOf('@');
  if (at < 0 || at === email.length - 1) return undefined;
  const domain = email.slice(at + 1).trim().toLowerCase();
  return domain || undefined;
}

function parseArr(raw: string | null | undefined): number | undefined {
  if (!raw) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Build the customer-account hint(s) that apply to every chunk produced for
 * one HubSpot record. Companies get an upsert hint (canonical source); deals
 * and contacts get a resolve hint when we can derive one without an extra
 * association API call. HubSpot company<->deal/contact associations are an
 * extra API hop per record — punted to a follow-up; for v1 we resolve deal /
 * contact chunks by domain when their email/website is populated.
 */
function buildCustomerAccountHints(
  recordType: HubspotRecordType,
  record: HubspotRecord,
  displayName: string,
): {
  [CUSTOMER_ACCOUNT_UPSERT_KEY]?: CustomerAccountUpsertHint;
  [CUSTOMER_ACCOUNT_HINT_KEY]?: CustomerAccountResolveHint;
} {
  const props = record.properties ?? {};
  if (recordType === 'company') {
    const domain = (props['domain'] ?? props['website'] ?? '')
      .replace(/^https?:\/\//, '')
      .replace(/\/.*$/, '')
      .trim()
      .toLowerCase();
    const upsert: CustomerAccountUpsertHint = {
      source: 'hubspot',
      externalId: record.id,
      displayName,
      ...(domain ? { primaryDomain: domain, domains: [domain] } : {}),
      ...(props['hubspot_owner_id'] ? { ownerEmail: props['hubspot_owner_id'] } : {}),
      ...(props['lifecyclestage'] ? { lifecycleStage: props['lifecyclestage'] } : {}),
      ...(parseArr(props['annualrevenue']) !== undefined
        ? { arrAmount: parseArr(props['annualrevenue']) }
        : {}),
    };
    return { [CUSTOMER_ACCOUNT_UPSERT_KEY]: upsert };
  }
  if (recordType === 'contact') {
    const domain = emailDomain(props['email']);
    if (!domain) return {};
    return { [CUSTOMER_ACCOUNT_HINT_KEY]: { domain } };
  }
  // Deals: no domain/email property is reliably populated. Skipped for v1;
  // proper resolution needs the company-association API which we don't fetch
  // today. Engagement chunks inherit whatever the parent record produced.
  return {};
}

function mapEngagement(e: HubspotEngagement): HubspotRecordInput['engagements'][number] {
  return {
    id: e.id,
    type: e.engagementType,
    createdAt: new Date(e.createdAt),
    body: e.body,
    subject: e.subject,
    ownerName: e.ownerId,
    callOutcome: e.callOutcome,
    callDurationSec: e.callDurationSec,
  };
}

/**
 * Index one HubSpot record: pull its engagement timeline, run through the
 * existing hubspotRecordChunker, and emit each chunk via ctx.upsert. All
 * chunks share `sourceArtifactId = 'hubspot-${recordType}:<id>'`.
 */
export async function processRecord(
  ctx: ResourceSyncContext<unknown>,
  objectType: HubspotObjectType,
  record: HubspotRecord,
): Promise<void> {
  const recordType = OBJECT_TO_RECORD_TYPE[objectType];

  // Engagement-fetch failures shouldn't abort the record — its body can
  // still be indexed alone. Mirrors legacy behavior.
  let engagements: HubspotEngagement[] = [];
  try {
    engagements = await fetchEngagementsForRecord(ctx.api, objectType, record.id);
  } catch {
    /* skip engagements for this record */
  }

  const recordInput: HubspotRecordInput = {
    recordType,
    recordId: record.id,
    displayName: deriveDisplayName(recordType, record.properties ?? {}),
    properties: nonEmptyProps(record.properties ?? {}),
    createdAt: new Date(record.createdAt),
    updatedAt: new Date(record.updatedAt),
    engagements: engagements.map(mapEngagement),
  };

  const sourceArtifactId = `hubspot-${recordType}:${record.id}`;
  const rawChunks = await hubspotRecordChunker.chunk(recordInput, {
    organizationId: ctx.organizationId,
    sourceId: ctx.sourceId,
    sourceArtifactId,
  });

  const accountHints = buildCustomerAccountHints(
    recordType,
    record,
    recordInput.displayName,
  );

  for (const c of rawChunks) {
    // The chunker tags engagement chunks via metadata.chunk_role. Engagements
    // get their own kind so retrieval can filter by activity type, but they
    // share the parent record's source-artifact id.
    const role = c.metadata['chunk_role'];
    const kind: 'hubspot-contact' | 'hubspot-deal' | 'hubspot-company' | 'hubspot-engagement' =
      role === 'engagement'
        ? 'hubspot-engagement'
        : recordType === 'contact'
          ? 'hubspot-contact'
          : recordType === 'deal'
            ? 'hubspot-deal'
            : 'hubspot-company';
    await ctx.upsert({
      externalId: record.id,
      kind,
      content: c.content,
      metadata: { ...c.metadata, ...accountHints },
      aclSubjects: c.aclSubjects,
      sourceArtifactId,
    });
  }
}
