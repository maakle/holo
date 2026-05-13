/**
 * `get_account_brief` — RFC-0006.
 *
 * Synthesize a five-section pre-call brief for a customer account, with
 * citation-anchored claims and per-provider freshness. Three callers share
 * this engine:
 *   1. MCP tool (this file's `runGetAccountBriefTool`).
 *   2. REST `GET /v1/accounts/:accountId/brief` (`apps/gateway`).
 *   3. Skill template `pre-call-brief` (`packages/skills/templates/`).
 *
 * The shape returned here is exactly what the web `/brief/<account-id>` page
 * renders — no per-surface massaging downstream.
 *
 * Section fan-out is per-section so each call's citation cardinality stays
 * bounded (~10 chunks per section, not ~50 across one mega-call) and so a
 * future streaming UI can render sections as they complete. Cache lookup is
 * keyed on (org, account, context, today) — same-day regenerates UPSERT.
 */
import { z } from 'zod';
import { and, eq, sql } from 'drizzle-orm';
import { schema, type DB } from '@holo/db';
import { searchWithCoverage, type SearchResult } from '@holo/retrieval-core';
import { citationToWire, toCitation, type WireCitation } from '../citations';

// ── Public types — used by REST + web + skill ────────────────────────────────

/**
 * Named context presets. `custom` is the escape hatch: callers supply
 * `custom_context` free-text and we use the `check-in` section ordering with
 * the custom prompt appended. See RFC-0006 open-question 2.
 */
export const BRIEF_CONTEXTS = [
  'renewal',
  'upsell',
  'check-in',
  'objection',
  'first-meeting',
  'custom',
] as const;
export type BriefContext = (typeof BRIEF_CONTEXTS)[number];

export const getAccountBriefInputSchema = z.object({
  account_id: z.uuid(),
  context: z.enum(BRIEF_CONTEXTS),
  custom_context: z.string().max(500).optional(),
});

/** Per-provider last-sync timestamps. Sourced from `connector_cursors` —
 * `null` means "not connected" rather than "stale". */
export interface BriefFreshness {
  /** Newest provider sync across the five providers below — convenient
   * one-glance freshness for the page header. */
  lastSyncedAt: string | null;
  perProvider: {
    pylon: string | null;
    grain: string | null;
    hubspot: string | null;
    notion: string | null;
    github: string | null;
  };
}

export interface BriefClaim {
  /** 1-2 sentence narrative. When the LLM is unavailable, falls back to the
   * raw chunk content trimmed to a sentence. */
  text: string;
  /** Section-local 1-based citation indices that ground this claim. */
  citationRefs: number[];
}

export interface BriefSection {
  /** Section-local citations (1-based). The web renderer reuses the
   * PR #188 chip component; section indices are independent so a "[1]" in
   * `issues` doesn't collide with a "[1]" in `lastConversation`. */
  citations: WireCitation[];
  claims: BriefClaim[];
  /** Freshness for *this* section's primary provider(s). Same shape as the
   * top-level freshness so chips can render uniformly across sections. */
  freshness: BriefFreshness;
}

/** Compact card data — pulled from `customer_accounts`, no synthesis. */
export interface BriefAtGlance extends BriefSection {
  displayName: string;
  /** Customer tier (`'T0' | 'T1' | …`) or null when HubSpot hasn't synced. */
  tier: string | null;
  /** Annual recurring revenue. `null` when unsynced — UI renders "—" with a
   * tooltip rather than "$0". */
  arr: { amount: string; currency: string } | null;
  owner: string | null;
  accountAgeDays: number | null;
  lastContactAt: string | null;
}

export interface BriefSections {
  atGlance: BriefAtGlance;
  issues: BriefSection;
  lastConversation: BriefSection;
  productAsks: BriefSection;
  contextSection: BriefSection;
}

export interface AccountBrief {
  accountId: string;
  context: BriefContext;
  customContext: string | null;
  sections: BriefSections;
  freshness: BriefFreshness;
  generatedAt: string;
  /** True when this payload was loaded from the cache table rather than
   * synthesized fresh. UI uses it to toggle the "Regenerate" affordance. */
  fromCache: boolean;
}

// ── Tool context ─────────────────────────────────────────────────────────────

/** Optional LLM client. When omitted, sections fall back to raw chunk
 * snippets so the tool always returns *something*. Tests pass a scripted
 * client; production wires Anthropic. */
export interface BriefLLMClient {
  synthesize(args: {
    sectionId: keyof BriefSections;
    systemPrompt: string;
    userPrompt: string;
  }): Promise<string>;
}

export interface GetAccountBriefContext {
  db: DB;
  organizationId: string;
  userSubjects: string[];
  userId?: string;
  llm?: BriefLLMClient;
  /** Defaults to today (UTC). Injectable so tests can pin a cache day. */
  today?: () => string;
}

// ── Per-context prompt presets ──────────────────────────────────────────────

/**
 * What changes between contexts:
 *
 *   - Section *ordering* — for `renewal`, `contextSection` leads;
 *     for `check-in`, `lastConversation` leads.
 *   - The `contextSection` system prompt — "look for churn signals" vs
 *     "look for expansion hints" vs "look for prior history of the named
 *     objection".
 *
 * We *don't* change the underlying search queries for the other four
 * sections — those are pinned by section identity so freshness is
 * comparable across contexts.
 */
interface ContextPreset {
  /** Order in which the renderer should display sections. The structured
   * payload itself always carries all five sections. */
  sectionOrder: ReadonlyArray<keyof BriefSections>;
  contextSectionPrompt: string;
}

const PRESETS: Record<BriefContext, ContextPreset> = {
  renewal: {
    sectionOrder: ['atGlance', 'contextSection', 'issues', 'productAsks', 'lastConversation'],
    contextSectionPrompt:
      'Focus on renewal posture: contract terms if mentioned, recent escalations, churn signals (drop in usage, executive sponsor change, recent competitor mentions). Cite every claim.',
  },
  upsell: {
    sectionOrder: ['atGlance', 'contextSection', 'productAsks', 'lastConversation', 'issues'],
    contextSectionPrompt:
      'Focus on expansion: unmet asks across tickets and calls, new stakeholders introduced recently, mentions of additional seats / new use cases / new teams. Cite every claim.',
  },
  'check-in': {
    sectionOrder: ['atGlance', 'lastConversation', 'issues', 'productAsks', 'contextSection'],
    contextSectionPrompt:
      'Focus on recent friction and vibes: the last 30 days of tickets and calls, tone shifts, anything urgent the team mentioned. Cite every claim.',
  },
  objection: {
    sectionOrder: ['atGlance', 'contextSection', 'issues', 'lastConversation', 'productAsks'],
    contextSectionPrompt:
      "Focus on the named objection's prior history: every time this customer raised this concern before, the resolutions, and whether their stance has shifted. Cite every claim. If `custom_context` names the objection, treat that as the primary search anchor.",
  },
  'first-meeting': {
    sectionOrder: ['atGlance', 'contextSection', 'productAsks', 'issues', 'lastConversation'],
    contextSectionPrompt:
      'Focus on first-meeting framing: who the stakeholders are, the company business model in 1-2 lines, what they appear to use today, anything noteworthy about their industry. Cite every claim.',
  },
  custom: {
    sectionOrder: ['atGlance', 'lastConversation', 'contextSection', 'issues', 'productAsks'],
    contextSectionPrompt:
      'Use the operator-supplied free-text below as the synthesis anchor. Treat it like a chat user question — find the most-relevant evidence in the retrieved chunks and answer it specifically, citing each claim.',
  },
};

/** Public — REST/web consumers need this to render in the right order
 * without re-deriving from `context`. */
export function sectionOrderFor(context: BriefContext): ReadonlyArray<keyof BriefSections> {
  return PRESETS[context].sectionOrder;
}

// ── Tool entrypoint ─────────────────────────────────────────────────────────

export async function runGetAccountBriefTool(
  ctx: GetAccountBriefContext,
  rawInput: unknown,
): Promise<AccountBrief> {
  const input = getAccountBriefInputSchema.parse(rawInput);
  const today = (ctx.today ?? defaultTodayUtc)();

  // 1. Load the account row. Org-scoped lookup — a stale UUID from a
  //    different tenant returns null and we treat it as "no access".
  const accountRows = await ctx.db
    .select()
    .from(schema.customerAccounts)
    .where(
      and(
        eq(schema.customerAccounts.id, input.account_id),
        eq(schema.customerAccounts.organizationId, ctx.organizationId),
      ),
    )
    .limit(1);
  const account = accountRows[0];
  if (!account) {
    // No org-scoped match: behave as 403 (don't reveal whether the row
    // exists elsewhere). REST layer maps this to a 403 response.
    return emptyBrief(input);
  }

  // 2. Cache read — (org, account, context, today). A hit returns the
  //    persisted payload verbatim with `fromCache: true`.
  const cached = await readCache(ctx.db, ctx.organizationId, account.id, input.context, today);
  if (cached) {
    return {
      accountId: account.id,
      context: input.context,
      customContext: cached.customContext,
      sections: cached.sections,
      freshness: cached.sections.atGlance.freshness,
      generatedAt: cached.generatedAt,
      fromCache: true,
    };
  }

  // 3. Freshness — one query for the whole brief; each section attaches
  //    the slice that's relevant to it.
  const freshness = await loadFreshness(ctx.db, ctx.organizationId);

  // 4. Per-section fan-out. The four synthesised sections run in parallel
  //    so the longest single search dominates rather than the sum.
  const sections = await synthesizeSections({
    ctx,
    account,
    context: input.context,
    customContext: input.custom_context ?? null,
    freshness,
  });

  // 5. Cache write. Best-effort — a write failure must not fail the read.
  try {
    await writeCache({
      db: ctx.db,
      organizationId: ctx.organizationId,
      accountId: account.id,
      context: input.context,
      customContext: input.custom_context ?? null,
      cacheDay: today,
      sections,
      generatedBy: ctx.userId ?? null,
    });
  } catch {
    // The cached read path is a perf optimization, not a correctness gate.
    // Surfacing the write failure to the user would block the brief over
    // a transient DB hiccup, which is the wrong tradeoff for a read tool.
  }

  return {
    accountId: account.id,
    context: input.context,
    customContext: input.custom_context ?? null,
    sections,
    freshness,
    generatedAt: new Date().toISOString(),
    fromCache: false,
  };
}

// ── Section synthesis ───────────────────────────────────────────────────────

interface SynthesizeArgs {
  ctx: GetAccountBriefContext;
  account: typeof schema.customerAccounts.$inferSelect;
  context: BriefContext;
  customContext: string | null;
  freshness: BriefFreshness;
}

async function synthesizeSections(args: SynthesizeArgs): Promise<BriefSections> {
  const [issues, lastConversation, productAsks, contextSection] = await Promise.all([
    sectionIssues(args),
    sectionLastConversation(args),
    sectionProductAsks(args),
    sectionContext(args),
  ]);

  return {
    atGlance: buildAtGlance(args),
    issues,
    lastConversation,
    productAsks,
    contextSection,
  };
}

function buildAtGlance(args: SynthesizeArgs): BriefAtGlance {
  const { account, freshness } = args;
  const accountAgeDays = account.createdAt
    ? Math.floor((Date.now() - account.createdAt.getTime()) / (1000 * 60 * 60 * 24))
    : null;
  // ARR is stored as a numeric — Drizzle returns it as a string. We pass it
  // through unchanged so the UI can format with full precision; missing
  // values render as "—".
  const arr =
    account.arrAmount && account.arrCurrency
      ? { amount: String(account.arrAmount), currency: account.arrCurrency }
      : null;

  return {
    displayName: account.displayName,
    tier: account.tier,
    arr,
    owner: account.ownerEmail,
    accountAgeDays,
    lastContactAt: null,
    freshness,
    citations: [],
    claims: [],
  };
}

async function sectionIssues(args: SynthesizeArgs): Promise<BriefSection> {
  const results = await searchForSection(args, 'open issues and recent tickets', 'pylon');
  return buildSection(args, 'issues', results, {
    intent:
      'Summarize the top open issues. Each bullet should name the issue, its status, and how recent it is.',
  });
}

async function sectionLastConversation(args: SynthesizeArgs): Promise<BriefSection> {
  const results = await searchForSection(args, 'most recent call summary takeaways', 'grain');
  return buildSection(args, 'lastConversation', results, {
    intent:
      'Summarize the most recent call: one line summary, then up to three takeaways. Cite each takeaway.',
  });
}

async function sectionProductAsks(args: SynthesizeArgs): Promise<BriefSection> {
  // No provider filter here on purpose — product asks live in tickets, calls,
  // and Notion notes; constraining to one provider would miss the others.
  const results = await searchForSection(args, 'feature requests product asks unmet needs');
  return buildSection(args, 'productAsks', results, {
    intent:
      'Cluster open product asks into 2-4 themes. For each theme list 1-2 specific examples with citations.',
  });
}

async function sectionContext(args: SynthesizeArgs): Promise<BriefSection> {
  const preset = PRESETS[args.context];
  const query = buildContextQuery(args);
  const results = await searchForSection(args, query);
  return buildSection(args, 'contextSection', results, {
    intent: preset.contextSectionPrompt,
    customContext: args.customContext,
  });
}

function buildContextQuery(args: SynthesizeArgs): string {
  if (args.customContext) return args.customContext;
  switch (args.context) {
    case 'renewal':
      return 'renewal contract churn signals usage decline';
    case 'upsell':
      return 'expansion seats new use cases new stakeholders';
    case 'check-in':
      return 'recent friction urgency mood last 30 days';
    case 'objection':
      return 'prior objection concern pushback';
    case 'first-meeting':
      return 'company business model stakeholders industry overview';
    case 'custom':
      return args.account.displayName;
  }
}

async function searchForSection(
  args: SynthesizeArgs,
  query: string,
  provider?: 'pylon' | 'grain' | 'github' | 'slack' | 'notion',
): Promise<SearchResult[]> {
  const envelope = await searchWithCoverage({
    db: args.ctx.db,
    organizationId: args.ctx.organizationId,
    q: query,
    topK: 8,
    accountId: args.account.id,
    userSubjects: args.ctx.userSubjects,
    ...(provider ? { provider } : {}),
  });
  return envelope.results;
}

interface BuildSectionOpts {
  intent: string;
  customContext?: string | null;
}

async function buildSection(
  args: SynthesizeArgs,
  sectionId: keyof BriefSections,
  results: SearchResult[],
  opts: BuildSectionOpts,
): Promise<BriefSection> {
  const citations = results.map((r, i) => citationToWire(toCitation(r, i + 1)));
  const freshness = args.freshness;

  if (results.length === 0) {
    // Per RFC-0006: render "No signal in the last 30 days" rather than
    // hiding the section. The web layer reads `claims.length === 0` and
    // renders the empty state.
    return { citations: [], claims: [], freshness };
  }

  const claims = args.ctx.llm
    ? await synthesizeClaimsWithLlm({
        llm: args.ctx.llm,
        sectionId,
        intent: opts.intent,
        customContext: opts.customContext ?? null,
        results,
        accountName: args.account.displayName,
      })
    : fallbackClaims(results);

  return { citations, claims, freshness };
}

async function synthesizeClaimsWithLlm(args: {
  llm: BriefLLMClient;
  sectionId: keyof BriefSections;
  intent: string;
  customContext: string | null;
  results: SearchResult[];
  accountName: string;
}): Promise<BriefClaim[]> {
  const systemPrompt = [
    `You are drafting one section of a pre-call brief for ${args.accountName}.`,
    args.intent,
    'Output strict JSON: an array of {"text": string, "citationRefs": number[]}.',
    'citationRefs are 1-based indices into the search results provided below; never invent indices.',
    'Each claim must cite at least one result. Keep claims tight — one or two sentences each.',
  ].join(' ');

  const evidence = args.results
    .map(
      (r, i) =>
        `[${i + 1}] (${r.source.provider}/${r.source.artifactKind}) ${r.content
          .replace(/\s+/g, ' ')
          .slice(0, 600)}`,
    )
    .join('\n\n');

  const userPrompt = [
    args.customContext ? `Operator note: ${args.customContext}\n` : '',
    'Search results:\n',
    evidence,
    '\n\nReturn the JSON array now.',
  ].join('');

  const raw = await args.llm.synthesize({ sectionId: args.sectionId, systemPrompt, userPrompt });
  const parsed = safeParseClaims(raw);
  if (parsed) return parsed.filter((c) => c.citationRefs.length > 0);
  return fallbackClaims(args.results);
}

function safeParseClaims(raw: string): BriefClaim[] | null {
  // Tolerant to LLMs that wrap JSON in ```json fences or sprinkle prose
  // around it. We grab the first `[...]` and try to parse; on failure
  // return null and the caller falls back to raw chunks.
  const match = raw.match(/\[[\s\S]*\]/);
  if (!match) return null;
  try {
    const arr = JSON.parse(match[0]) as unknown;
    if (!Array.isArray(arr)) return null;
    const out: BriefClaim[] = [];
    for (const item of arr) {
      if (!item || typeof item !== 'object') continue;
      const o = item as { text?: unknown; citationRefs?: unknown };
      if (typeof o.text !== 'string') continue;
      if (!Array.isArray(o.citationRefs)) continue;
      const refs = o.citationRefs.filter(
        (n): n is number => typeof n === 'number' && Number.isFinite(n),
      );
      out.push({ text: o.text, citationRefs: refs });
    }
    return out;
  } catch {
    return null;
  }
}

function fallbackClaims(results: SearchResult[]): BriefClaim[] {
  // No LLM available — surface the first sentence of each top chunk as a
  // claim. Not great copy, but deterministic and citation-anchored, which
  // is what tests and self-hosters without a Claude key need.
  return results.slice(0, 5).map((r, i) => ({
    text: firstSentence(r.content),
    citationRefs: [i + 1],
  }));
}

function firstSentence(s: string): string {
  const trimmed = s.trim().replace(/\s+/g, ' ');
  const m = trimmed.match(/^([^.!?]{1,240}[.!?])/);
  return m ? m[1]! : trimmed.slice(0, 240);
}

// ── Freshness ───────────────────────────────────────────────────────────────

const RELEVANT_PROVIDERS: ReadonlyArray<keyof BriefFreshness['perProvider']> = [
  'pylon',
  'grain',
  'hubspot',
  'notion',
  'github',
];

async function loadFreshness(db: DB, organizationId: string): Promise<BriefFreshness> {
  const rows = await db
    .select({
      provider: schema.sources.provider,
      lastRunAt: sql<Date | null>`MAX(${schema.connectorCursors.lastRunAt})`,
    })
    .from(schema.connectorCursors)
    .innerJoin(schema.sources, eq(schema.connectorCursors.sourceId, schema.sources.id))
    .where(eq(schema.connectorCursors.organizationId, organizationId))
    .groupBy(schema.sources.provider);

  const perProvider: BriefFreshness['perProvider'] = {
    pylon: null,
    grain: null,
    hubspot: null,
    notion: null,
    github: null,
  };
  for (const r of rows) {
    if (!RELEVANT_PROVIDERS.includes(r.provider as keyof BriefFreshness['perProvider'])) continue;
    if (!r.lastRunAt) continue;
    perProvider[r.provider as keyof BriefFreshness['perProvider']] = r.lastRunAt.toISOString();
  }

  const lastSyncedAt =
    Object.values(perProvider)
      .filter((v): v is string => v !== null)
      .sort()
      .pop() ?? null;

  return { lastSyncedAt, perProvider };
}

// ── Cache ───────────────────────────────────────────────────────────────────

interface CachedBrief {
  sections: BriefSections;
  customContext: string | null;
  generatedAt: string;
}

async function readCache(
  db: DB,
  organizationId: string,
  accountId: string,
  context: BriefContext,
  cacheDay: string,
): Promise<CachedBrief | null> {
  const rows = await db
    .select({
      sections: schema.accountBriefCache.sectionsJsonb,
      customContext: schema.accountBriefCache.customContext,
      generatedAt: schema.accountBriefCache.generatedAt,
    })
    .from(schema.accountBriefCache)
    .where(
      and(
        eq(schema.accountBriefCache.organizationId, organizationId),
        eq(schema.accountBriefCache.accountId, accountId),
        eq(schema.accountBriefCache.context, context),
        eq(schema.accountBriefCache.cacheDay, cacheDay),
      ),
    )
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return {
    sections: row.sections as unknown as BriefSections,
    customContext: row.customContext,
    generatedAt: row.generatedAt.toISOString(),
  };
}

interface WriteCacheArgs {
  db: DB;
  organizationId: string;
  accountId: string;
  context: BriefContext;
  customContext: string | null;
  cacheDay: string;
  sections: BriefSections;
  generatedBy: string | null;
}

async function writeCache(args: WriteCacheArgs): Promise<void> {
  // UPSERT on the unique tuple. Regenerate replaces in-place via
  // ON CONFLICT DO UPDATE so consumers see the new payload immediately.
  await args.db
    .insert(schema.accountBriefCache)
    .values({
      organizationId: args.organizationId,
      accountId: args.accountId,
      context: args.context,
      customContext: args.customContext,
      cacheDay: args.cacheDay,
      sectionsJsonb: args.sections as unknown as Record<string, unknown>,
      // Citations live inside each section's `citations` array — we duplicate
      // the flat list here so future cross-brief analytics can scan citations
      // without parsing the section blob.
      citationsJsonb: flattenCitations(args.sections) as unknown as Record<string, unknown>,
      ...(args.generatedBy ? { generatedBy: args.generatedBy } : {}),
    })
    .onConflictDoUpdate({
      target: [
        schema.accountBriefCache.organizationId,
        schema.accountBriefCache.accountId,
        schema.accountBriefCache.context,
        schema.accountBriefCache.cacheDay,
      ],
      set: {
        customContext: args.customContext,
        sectionsJsonb: args.sections as unknown as Record<string, unknown>,
        citationsJsonb: flattenCitations(args.sections) as unknown as Record<string, unknown>,
        generatedAt: new Date(),
        ...(args.generatedBy ? { generatedBy: args.generatedBy } : {}),
      },
    });
}

/** Invalidate the cached row for (org, account, context, today). The next
 * `runGetAccountBriefTool` call falls through to fresh synthesis. */
export async function invalidateAccountBriefCache(args: {
  db: DB;
  organizationId: string;
  accountId: string;
  context: BriefContext;
  today?: () => string;
}): Promise<void> {
  const cacheDay = (args.today ?? defaultTodayUtc)();
  await args.db
    .delete(schema.accountBriefCache)
    .where(
      and(
        eq(schema.accountBriefCache.organizationId, args.organizationId),
        eq(schema.accountBriefCache.accountId, args.accountId),
        eq(schema.accountBriefCache.context, args.context),
        eq(schema.accountBriefCache.cacheDay, cacheDay),
      ),
    );
}

function flattenCitations(sections: BriefSections): WireCitation[] {
  // The cached `citations_jsonb` is a flat union for cross-section analytics
  // and Notion-export later. Section-local arrays remain inside `sectionsJsonb`.
  const out: WireCitation[] = [];
  for (const id of Object.keys(sections) as Array<keyof BriefSections>) {
    out.push(...sections[id].citations);
  }
  return out;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function defaultTodayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

function emptyBrief(input: z.infer<typeof getAccountBriefInputSchema>): AccountBrief {
  // Used when the account doesn't exist or isn't accessible to this org.
  // We return the shape rather than throwing so MCP callers can render a
  // user-facing "no access" rather than a tool-error red banner.
  const freshness: BriefFreshness = {
    lastSyncedAt: null,
    perProvider: { pylon: null, grain: null, hubspot: null, notion: null, github: null },
  };
  const empty: BriefSection = { citations: [], claims: [], freshness };
  return {
    accountId: input.account_id,
    context: input.context,
    customContext: input.custom_context ?? null,
    sections: {
      atGlance: {
        displayName: '',
        tier: null,
        arr: null,
        owner: null,
        accountAgeDays: null,
        lastContactAt: null,
        freshness,
        citations: [],
        claims: [],
      },
      issues: empty,
      lastConversation: empty,
      productAsks: empty,
      contextSection: empty,
    },
    freshness,
    generatedAt: new Date().toISOString(),
    fromCache: false,
  };
}

// Re-export so non-tool callers (REST handler, skill template loader) can
// reuse helpers without depending on the tool entrypoint.
export { defaultTodayUtc };
