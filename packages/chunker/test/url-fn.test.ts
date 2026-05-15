import { describe, it, expect } from 'vitest';
import { computeSourceUrl, hasUrlFn, urlFns } from '../src/url-fn';

describe('url-fn registry', () => {
  it('github-pr builds the canonical pull URL', () => {
    expect(
      computeSourceUrl({
        kind: 'github-pr',
        externalId: 'pr:acme/api#42',
        metadata: { repo_full_name: 'acme/api', pr_number: 42 },
      }),
    ).toBe('https://github.com/acme/api/pull/42');
  });

  it('github-pr returns null when metadata is incomplete', () => {
    expect(
      computeSourceUrl({
        kind: 'github-pr',
        externalId: 'pr:acme/api#42',
        metadata: { repo_full_name: 'acme/api' }, // no pr_number
      }),
    ).toBeNull();
  });

  it('github-code includes line range and ref when present', () => {
    expect(
      computeSourceUrl({
        kind: 'github-code',
        externalId: 'code:acme/api/src/index.ts:10-15',
        metadata: {
          repo_full_name: 'acme/api',
          file_path: 'src/index.ts',
          commit_sha: 'abc123',
          start_line: 10,
          end_line: 15,
        },
      }),
    ).toBe('https://github.com/acme/api/blob/abc123/src/index.ts#L10-L15');
  });

  it('notion-page strips dashes from page id', () => {
    expect(
      computeSourceUrl({
        kind: 'notion-page',
        externalId: 'pg-1',
        metadata: { notion_page_id: '12345678-90ab-cdef-1234-567890abcdef' },
      }),
    ).toBe('https://www.notion.so/1234567890abcdef1234567890abcdef');
  });

  it('stripe-charge points at /payments and respects livemode=false', () => {
    expect(
      computeSourceUrl({
        kind: 'stripe-charge',
        externalId: 'ch_test',
        metadata: { livemode: false },
      }),
    ).toBe('https://dashboard.stripe.com/test/payments/ch_test');
    expect(
      computeSourceUrl({
        kind: 'stripe-charge',
        externalId: 'ch_live',
        metadata: { livemode: true },
      }),
    ).toBe('https://dashboard.stripe.com/payments/ch_live');
  });

  it('stripe-customer/subscription/invoice use plural segments', () => {
    expect(
      computeSourceUrl({
        kind: 'stripe-customer',
        externalId: 'cus_x',
        metadata: {},
      }),
    ).toBe('https://dashboard.stripe.com/customers/cus_x');
    expect(
      computeSourceUrl({
        kind: 'stripe-subscription',
        externalId: 'sub_x',
        metadata: {},
      }),
    ).toBe('https://dashboard.stripe.com/subscriptions/sub_x');
    expect(
      computeSourceUrl({
        kind: 'stripe-invoice',
        externalId: 'in_x',
        metadata: {},
      }),
    ).toBe('https://dashboard.stripe.com/invoices/in_x');
  });

  it('webcrawl-page uses the crawled URL directly', () => {
    expect(
      computeSourceUrl({
        kind: 'webcrawl-page',
        externalId: 'p-1',
        metadata: { url: 'https://example.com/blog/post' },
      }),
    ).toBe('https://example.com/blog/post');
  });

  it('falls back to metadata.url / .permalink / .webViewLink for connectors that stamp it', () => {
    // jira / linear / asana / confluence / mintlify / zendesk / airtable all rely on this.
    expect(
      computeSourceUrl({
        kind: 'jira-issue',
        externalId: 'JIRA-1',
        metadata: { url: 'https://acme.atlassian.net/browse/JIRA-1' },
      }),
    ).toBe('https://acme.atlassian.net/browse/JIRA-1');
    expect(
      computeSourceUrl({
        kind: 'slack-thread',
        externalId: 'C1:1.1',
        metadata: { permalink: 'https://acme.slack.com/archives/C1/p1234567890' },
      }),
    ).toBe('https://acme.slack.com/archives/C1/p1234567890');
    expect(
      computeSourceUrl({
        kind: 'googledrive-file',
        externalId: 'gd-1',
        metadata: { webViewLink: 'https://drive.google.com/file/d/abc/view' },
      }),
    ).toBe('https://drive.google.com/file/d/abc/view');
  });

  it('returns null when no URL can be derived and no metadata fallback exists', () => {
    expect(
      computeSourceUrl({
        kind: 'salesforce-record',
        externalId: 'sf-1',
        metadata: { record_type: 'account', record_id: 'a-1' }, // no url
      }),
    ).toBeNull();
  });

  it('rejects non-http URLs in the generic fallback so paths/ids never get promoted', () => {
    expect(
      computeSourceUrl({
        kind: 'jira-issue',
        externalId: 'JIRA-1',
        metadata: { url: '/relative/path' },
      }),
    ).toBeNull();
    expect(
      computeSourceUrl({
        kind: 'jira-issue',
        externalId: 'JIRA-1',
        metadata: { url: 'ftp://foo' },
      }),
    ).toBeNull();
  });

  it('every kind in the path-fn registry has a corresponding url-fn entry', async () => {
    const { pathFns } = await import('../src/path-fn');
    const pathKinds = Object.keys(pathFns).sort();
    const missingUrl: string[] = [];
    for (const k of pathKinds) {
      if (!hasUrlFn(k)) missingUrl.push(k);
    }
    // The reverse direction is also tested: every url-fn maps to a path-fn.
    const urlKinds = Object.keys(urlFns).sort();
    const missingPath: string[] = [];
    for (const k of urlKinds) {
      if (!Object.prototype.hasOwnProperty.call(pathFns, k)) missingPath.push(k);
    }
    expect({ missingUrl, missingPath }).toEqual({ missingUrl: [], missingPath: [] });
  });
});
