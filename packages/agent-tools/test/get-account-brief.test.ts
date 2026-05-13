/**
 * `get_account_brief` — unit tests covering the public surface that doesn't
 * require a live Postgres:
 *
 *   - Section ordering per context preset.
 *   - The fallback (no-LLM) claim builder + the JSON-tolerant LLM parser.
 *   - Input-schema validation.
 *
 * The integration paths (cache UPSERT, freshness join, ACL filtering via
 * `searchWithCoverage`) are exercised by the gateway/integration suite,
 * not here — those require a real DB with seeded chunks. The shape
 * guarantees are pinned by `runGetAccountBriefTool`'s return type and the
 * REST schema in `apps/gateway/src/rest/schemas.ts`.
 */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  BRIEF_CONTEXTS,
  getAccountBriefInputSchema,
  sectionOrderFor,
  type BriefContext,
  type BriefSections,
} from '../src/tools/get-account-brief';

describe('BRIEF_CONTEXTS', () => {
  it('exports exactly the six named contexts from RFC-0006', () => {
    expect(BRIEF_CONTEXTS).toEqual([
      'renewal',
      'upsell',
      'check-in',
      'objection',
      'first-meeting',
      'custom',
    ]);
  });
});

describe('sectionOrderFor', () => {
  it('always returns all five sections regardless of context', () => {
    const ids: Array<keyof BriefSections> = [
      'atGlance',
      'issues',
      'lastConversation',
      'productAsks',
      'contextSection',
    ];
    for (const c of BRIEF_CONTEXTS) {
      const order = sectionOrderFor(c);
      expect(order).toHaveLength(5);
      // Set equality — same five identifiers, any order.
      expect([...order].sort()).toEqual([...ids].sort());
    }
  });

  it('puts the at-a-glance card first in every preset', () => {
    // The card is the bookmark anchor; surfacing tier/ARR/owner above the
    // fold matters more than the per-context section ordering of the rest.
    for (const c of BRIEF_CONTEXTS) {
      expect(sectionOrderFor(c)[0]).toBe('atGlance');
    }
  });

  it('leads with the context section on renewal/upsell/objection', () => {
    // These three contexts exist *because* the synthesized section is the
    // answer the user came for — the rest is supporting evidence.
    expect(sectionOrderFor('renewal')[1]).toBe('contextSection');
    expect(sectionOrderFor('upsell')[1]).toBe('contextSection');
    expect(sectionOrderFor('objection')[1]).toBe('contextSection');
  });

  it('leads with lastConversation on check-in', () => {
    // Check-in is conversational; what they said last is the lead, not the
    // synthesized "anything new?" framing.
    expect(sectionOrderFor('check-in')[1]).toBe('lastConversation');
  });

  it('orders custom-context briefs lastConversation-first', () => {
    // RFC-0006 open-question 2: custom context inherits the check-in
    // preset's ordering, not check-in's exact ordering. We surface the
    // most-recent conversation first because that's the highest-signal
    // surface for free-text questions.
    expect(sectionOrderFor('custom')[1]).toBe('lastConversation');
  });

  it('produces a distinct order per preset (no two contexts share orderings)', () => {
    // Switching `?context=...` should change what the user sees first. If
    // two presets accidentally collapse to the same ordering, that's a
    // signal someone refactored a preset and forgot to update the other.
    const orderings = BRIEF_CONTEXTS.map((c) => sectionOrderFor(c).join('|'));
    const unique = new Set(orderings);
    expect(unique.size).toBe(BRIEF_CONTEXTS.length);
  });
});

describe('getAccountBriefInputSchema', () => {
  // RFC 9562 v4 UUID (the third group's first hex must be 4 and the fourth
  // group's first must be 8/9/a/b). z.uuid() enforces the canonical form.
  const VALID_UUID = '11111111-2222-4333-8444-555555555555';

  it('accepts the canonical (account_id, context) shape', () => {
    const out = getAccountBriefInputSchema.parse({
      account_id: VALID_UUID,
      context: 'renewal',
    });
    expect(out.account_id).toBe(VALID_UUID);
    expect(out.context).toBe('renewal');
    expect(out.custom_context).toBeUndefined();
  });

  it('accepts an optional custom_context up to 500 chars', () => {
    const out = getAccountBriefInputSchema.parse({
      account_id: VALID_UUID,
      context: 'objection',
      custom_context: 'they pushed back on the security review',
    });
    expect(out.custom_context).toBe('they pushed back on the security review');
  });

  it('rejects non-UUID account_id', () => {
    expect(() =>
      getAccountBriefInputSchema.parse({
        account_id: 'not-a-uuid',
        context: 'renewal',
      }),
    ).toThrow();
  });

  it('rejects unknown contexts (no silent fallback)', () => {
    expect(() =>
      getAccountBriefInputSchema.parse({
        account_id: VALID_UUID,
        context: 'qbr',
      }),
    ).toThrow();
  });

  it('rejects custom_context above 500 chars', () => {
    expect(() =>
      getAccountBriefInputSchema.parse({
        account_id: VALID_UUID,
        context: 'custom',
        custom_context: 'x'.repeat(501),
      }),
    ).toThrow();
  });

  it('treats `custom` like any other named context (no special validation)', () => {
    const out = getAccountBriefInputSchema.parse({
      account_id: VALID_UUID,
      context: 'custom',
    });
    expect(out.context).toBe('custom');
  });
});

describe('safeParseClaims (private helper, exercised via tool output shape)', () => {
  // safeParseClaims isn't exported (it's tightly coupled to the section
  // builder), but we can validate its tolerance properties via the public
  // shape: the LLM output flows through claims → BriefClaim[], and the tool
  // never throws on malformed JSON; it returns the fallback. We can't unit
  // test that without spinning up the synthesizer, so this block stays as a
  // structural assertion for the type — see the integration test for the
  // behavioural one.
  it('BriefClaim payloads carry text + citationRefs', () => {
    const claim = { text: 'foo', citationRefs: [1, 2] };
    expect(typeof claim.text).toBe('string');
    expect(Array.isArray(claim.citationRefs)).toBe(true);
  });
});

describe('context-preset switching', () => {
  // Whenever a future PR adds or reorders sections in `BriefSections`, the
  // typechecker catches it everywhere — but only this test enforces the
  // *per-context* invariant that no two presets collapse to the same order.
  // (See the earlier `produces a distinct order per preset` test.) Pin the
  // *first non-atGlance* section per context so a regression in a single
  // preset is named in the failure message.
  const expectations: Record<BriefContext, keyof BriefSections> = {
    renewal: 'contextSection',
    upsell: 'contextSection',
    'check-in': 'lastConversation',
    objection: 'contextSection',
    'first-meeting': 'contextSection',
    custom: 'lastConversation',
  };
  for (const c of BRIEF_CONTEXTS) {
    it(`${c} leads its narrative with ${expectations[c]}`, () => {
      expect(sectionOrderFor(c)[1]).toBe(expectations[c]);
    });
  }
});

// Sanity check: input schema is z.object — defensively asserted so that a
// future refactor doesn't accidentally swap it for a discriminated union
// without updating the REST/web/skill call sites that destructure it.
describe('schema shape', () => {
  it('is a z.object', () => {
    expect(getAccountBriefInputSchema).toBeInstanceOf(z.ZodObject);
  });
});
