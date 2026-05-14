import { describe, it, expect } from 'vitest';
import { computePath, hasPathFn, pathFns } from '../src/path-fn';

describe('path-fn registry', () => {
  it('every registered kind round-trips to a leading-slash path', () => {
    for (const kind of Object.keys(pathFns)) {
      const path = computePath({
        kind,
        externalId: 'ext-id',
        metadata: {
          // A grab-bag of fields covering the union of what chunkers emit.
          // Each path-fn ignores keys it doesn't use; missing fields fall
          // back to deterministic sentinels.
          channel_name: 'engineering',
          channel_id: 'C012',
          thread_ts: '1715000000.000100',
          space_display_name: 'Eng Space',
          space_name: 'spaces/abc',
          thread_name: 'thread-1',
          repo_full_name: 'acme/api',
          pr_number: 42,
          issue_number: 7,
          file_path: 'src/index.ts',
          notion_page_id: 'pg-1',
          breadcrumb: 'Engineering / Roadmap',
          recording_id: 'rec-1',
          title: 'Quarterly Review',
          started_at: '2026-05-14T10:00:00Z',
          ticket_id: 'tk-9',
          record_type: 'company',
          record_id: 'r-1',
          display_name: 'Acme Corp',
          path: '/docs/intro',
          api_title: 'Holo API',
          method: 'POST',
          prismic_repo: 'holo-mkt',
          prismic_type: 'page',
          prismic_uid: 'home',
          url: 'https://example.com/blog/post-1',
          article_id: 'a-1',
          section: 'Billing',
        },
      });
      expect(path).toMatch(/^\/[a-z]/);
      expect(path).not.toContain(' ');
      expect(path).not.toContain('..');
    }
  });

  it('slack-thread path uses channel + date from thread_ts', () => {
    const path = computePath({
      kind: 'slack-thread',
      externalId: 'slack-thread:C012:1715690400.000100',
      metadata: {
        channel_name: 'Pricing',
        channel_id: 'C012',
        thread_ts: '1715690400.000100',
      },
    });
    expect(path).toBe('/slack/#pricing/2024-05-14/thread-1715690400.000100.md');
  });

  it('github-pr path uses repo + number', () => {
    const path = computePath({
      kind: 'github-pr',
      externalId: 'pr:acme/api#42',
      metadata: { repo_full_name: 'acme/api', pr_number: 42 },
    });
    expect(path).toBe('/github/acme/api/pulls/42.md');
  });

  it('pylon-ticket prefers issue_number when present, else ticket_id', () => {
    const a = computePath({
      kind: 'pylon-ticket',
      externalId: 'pylon-ticket:abc',
      metadata: { ticket_id: 'abc-uuid', issue_number: 1234 },
    });
    const b = computePath({
      kind: 'pylon-ticket',
      externalId: 'pylon-ticket:abc',
      metadata: { ticket_id: 'abc-uuid' },
    });
    expect(a).toBe('/pylon/tickets/1234.md');
    expect(b).toBe('/pylon/tickets/abc-uuid.md');
  });

  it('stripe-* paths use the Stripe object id under per-type folders', () => {
    expect(
      computePath({
        kind: 'stripe-customer',
        externalId: 'cus_NffrFeUfNV2Hib',
        metadata: { customer_id: 'cus_NffrFeUfNV2Hib' },
      }),
    ).toBe('/stripe/customers/cus_NffrFeUfNV2Hib.md');
    expect(
      computePath({
        kind: 'stripe-subscription',
        externalId: 'sub_1MowQVLkdIwHu7ix',
        metadata: {},
      }),
    ).toBe('/stripe/subscriptions/sub_1MowQVLkdIwHu7ix.md');
    expect(
      computePath({
        kind: 'stripe-invoice',
        externalId: 'in_1MtHbELkdIwHu7ix',
        metadata: {},
      }),
    ).toBe('/stripe/invoices/in_1MtHbELkdIwHu7ix.md');
    expect(
      computePath({
        kind: 'stripe-charge',
        externalId: 'ch_3MmlLrLkdIwHu7ix',
        metadata: {},
      }),
    ).toBe('/stripe/charges/ch_3MmlLrLkdIwHu7ix.md');
  });

  it('is deterministic — same input twice yields the same path', () => {
    const input = {
      kind: 'grain-call',
      externalId: 'grain-call:rec-1',
      metadata: {
        recording_id: 'rec-1',
        title: 'Customer Sync — Acme Corp',
        started_at: '2026-05-14T10:00:00Z',
      },
    };
    expect(computePath(input)).toBe(computePath(input));
  });

  it('throws on unknown kind', () => {
    expect(() =>
      computePath({ kind: 'nope-unknown', externalId: 'x', metadata: {} }),
    ).toThrow(/No path-fn registered/);
  });

  it('hasPathFn returns true for registered kinds and false for unknown', () => {
    expect(hasPathFn('slack-thread')).toBe(true);
    expect(hasPathFn('nope-unknown')).toBe(false);
  });
});
