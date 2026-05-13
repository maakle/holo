import { describe, it, expect } from 'vitest';
import {
  requiresHardCitation,
  classifyClaim,
} from '../src/claims-classifier';

describe('requiresHardCitation', () => {
  describe('quantitative customer claims', () => {
    it('flags ARR mentions', () => {
      expect(requiresHardCitation('Acme has $1.2M ARR on the Enterprise plan.')).toBe(
        true,
      );
      expect(requiresHardCitation('Their ARR doubled last quarter.')).toBe(true);
    });

    it('flags MRR mentions', () => {
      expect(requiresHardCitation('Skello pays $45k MRR.')).toBe(true);
    });

    it('flags seat counts', () => {
      expect(requiresHardCitation('The customer has 120 seats provisioned.')).toBe(
        true,
      );
      expect(requiresHardCitation('Globex bought 45 users.')).toBe(true);
    });

    it('flags ticket counts', () => {
      expect(requiresHardCitation('They filed 300 tickets last month.')).toBe(true);
    });

    it('flags currency amounts with magnitude suffix', () => {
      expect(requiresHardCitation('Deal value is $250k.')).toBe(true);
      expect(requiresHardCitation('The expansion was worth €1.2M.')).toBe(true);
    });
  });

  describe('product-status claims', () => {
    it('flags "X is shipped"', () => {
      expect(requiresHardCitation('Skill labels is shipped.')).toBe(true);
      expect(
        requiresHardCitation('The new audit dashboard is launched in EE.'),
      ).toBe(true);
    });

    it('flags negated forms', () => {
      expect(requiresHardCitation("Bulk export isn't shipped yet.")).toBe(true);
      expect(requiresHardCitation('That feature is not launched.')).toBe(true);
    });

    it('flags roadmap claims', () => {
      expect(requiresHardCitation('Salesforce sync is on the roadmap.')).toBe(true);
      expect(requiresHardCitation('GDrive support is coming in Q3.')).toBe(true);
    });

    it('flags GA / beta / deprecated', () => {
      expect(requiresHardCitation('Pylon connector is generally available.')).toBe(
        true,
      );
      expect(requiresHardCitation('Web crawl is in beta.')).toBe(true);
      expect(requiresHardCitation('The legacy API is deprecated.')).toBe(true);
    });
  });

  describe('integration-status claims', () => {
    it('flags "integration is broken"', () => {
      expect(requiresHardCitation('The Slack integration is broken.')).toBe(true);
      expect(requiresHardCitation('Notion connector is offline.')).toBe(true);
    });

    it('flags "X works" / "X is healthy"', () => {
      expect(requiresHardCitation('Slack is working.')).toBe(true);
      expect(requiresHardCitation('GitHub is healthy.')).toBe(true);
      expect(requiresHardCitation('The sync is up.')).toBe(true);
    });

    it('flags named-provider status', () => {
      expect(requiresHardCitation('Salesforce is down.')).toBe(true);
      expect(requiresHardCitation('HubSpot is failing.')).toBe(true);
    });
  });

  describe('control negatives — should NOT trigger', () => {
    it('passes through ordinary descriptive sentences', () => {
      expect(requiresHardCitation('The team prefers async standups.')).toBe(false);
      expect(requiresHardCitation('Here is a list of available skills.')).toBe(false);
      expect(requiresHardCitation('You asked about onboarding flow.')).toBe(false);
    });

    it('does not flag generic numbers without a customer context', () => {
      // "5 results" or "3 items" — generic UI/result counts, not customer revenue.
      expect(requiresHardCitation('I found 5 results in your sources.')).toBe(false);
      expect(requiresHardCitation('There are 3 active skills.')).toBe(false);
    });

    it('does not flag conversational filler', () => {
      expect(requiresHardCitation("Sure — here's what I found.")).toBe(false);
      expect(requiresHardCitation('Let me know if you want details.')).toBe(false);
    });
  });

  it('returns false on empty / whitespace input', () => {
    expect(requiresHardCitation('')).toBe(false);
  });
});

describe('classifyClaim', () => {
  it('returns the matched category names', () => {
    expect(classifyClaim('Acme has $1.2M ARR.')).toContain('quantitative_customer');
    expect(classifyClaim('Skill labels is shipped.')).toContain('product_status');
    expect(classifyClaim('Slack is broken.')).toContain('integration_status');
  });

  it('returns an empty list for non-matching text', () => {
    expect(classifyClaim('The weather is nice today.')).toEqual([]);
  });
});
