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

  it('teams-thread channel path uses team + channel + date + root id', () => {
    const path = computePath({
      kind: 'teams-thread',
      externalId: 'teams-thread:team-x/channel-y/root-1',
      metadata: {
        resource_kind: 'channel',
        team_id: 'team-x',
        team_display_name: 'Engineering',
        channel_id: 'channel-y',
        channel_display_name: 'general',
        root_message_id: 'root-1',
        created_date_time: '2026-05-14T22:13:20Z',
      },
    });
    expect(path).toBe('/teams/engineering/general/2026-05-14/root-1.md');
  });

  it('teams-thread chat path uses chat label + date + root id', () => {
    const path = computePath({
      kind: 'teams-thread',
      externalId: 'teams-thread:chat-z/root-1',
      metadata: {
        resource_kind: 'chat',
        chat_id: 'chat-z',
        chat_topic: 'Q4 Planning',
        root_message_id: 'root-1',
        created_date_time: '2026-05-14T22:13:20Z',
      },
    });
    expect(path).toBe('/teams/chats/q4-planning/2026-05-14/root-1.md');
  });

  it('teams-thread chat falls back to chat_id when chat_topic is empty (1:1 chats)', () => {
    const path = computePath({
      kind: 'teams-thread',
      externalId: 'teams-thread:chat-z/root-1',
      metadata: {
        resource_kind: 'chat',
        chat_id: 'chat-z',
        chat_topic: '',
        root_message_id: 'root-1',
        created_date_time: '2026-05-14T22:13:20Z',
      },
    });
    expect(path).toBe('/teams/chats/chat-z/2026-05-14/root-1.md');
  });

  it('google-chat-thread path uses space + date + thread id', () => {
    const path = computePath({
      kind: 'google-chat-thread',
      externalId: 'spaces/AAA/threads/T1',
      metadata: {
        space_name: 'spaces/AAA',
        space_display_name: 'Engineering',
        thread_name: 'spaces/AAA/threads/T1',
        parent_create_time: '2026-05-14T22:13:20.000Z',
      },
    });
    expect(path).toBe('/google-chat/engineering/2026-05-14/spaces-aaa-threads-t1.md');
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

  it('airtable-record reads camelCase metadata emitted by @holo/connectors', () => {
    const path = computePath({
      kind: 'airtable-record',
      externalId: 'airtable-record:appXYZ:tblABC:recDEF',
      metadata: {
        baseId: 'appXYZ',
        baseName: 'Sales CRM',
        tableId: 'tblABC',
        tableName: 'Pipeline',
        recordId: 'recDEF',
      },
    });
    expect(path).toBe('/airtable/sales-crm/pipeline/recDEF.md');
  });

  it('confluence-page reads camelCase metadata (spaceKey/pageId)', () => {
    const path = computePath({
      kind: 'confluence-page',
      externalId: '12345',
      metadata: {
        pageId: '12345',
        spaceKey: 'ENG',
        title: 'Onboarding Runbook',
      },
    });
    expect(path).toBe('/confluence/eng/onboarding-runbook-12345.md');
  });

  it('confluence-space accepts `key` as emitted by the connector', () => {
    const path = computePath({
      kind: 'confluence-space',
      externalId: 'confluence-space:ENG',
      metadata: { key: 'ENG', name: 'Engineering' },
    });
    expect(path).toBe('/confluence/eng.md');
  });

  it('confluence-comment falls back to spaceId when no space key is in metadata', () => {
    const path = computePath({
      kind: 'confluence-comment',
      externalId: '12345:c-99',
      metadata: { commentId: 'c-99', pageId: '12345', spaceId: '4242' },
    });
    expect(path).toBe('/confluence/4242/12345/comments/c-99.md');
  });

  it('jira-* read camelCase metadata emitted by @holo/connectors', () => {
    expect(
      computePath({
        kind: 'jira-project',
        externalId: 'jira-project:ENG',
        metadata: { key: 'ENG', name: 'Engineering' },
      }),
    ).toBe('/jira/eng.md');
    expect(
      computePath({
        kind: 'jira-issue',
        externalId: '10001',
        metadata: { key: 'ENG-42', projectKey: 'ENG' },
      }),
    ).toBe('/jira/issues/eng-42.md');
    expect(
      computePath({
        kind: 'jira-comment',
        externalId: '10001:c-7',
        metadata: { commentId: 'c-7', issueKey: 'ENG-42' },
      }),
    ).toBe('/jira/issues/eng-42/comments/c-7.md');
  });

  it('linear-issue reads camelCase teamKey + identifier', () => {
    const path = computePath({
      kind: 'linear-issue',
      externalId: 'linear-issue:HOLO-12',
      metadata: { identifier: 'HOLO-12', teamKey: 'HOLO', teamId: 't-1' },
    });
    expect(path).toBe('/linear/holo/holo-12.md');
  });

  it('asana-task derives project from projectNames array', () => {
    const path = computePath({
      kind: 'asana-task',
      externalId: 'task-gid-42',
      metadata: {
        name: 'Ship Files panel',
        projectNames: ['Inbox', 'Roadmap'],
      },
    });
    expect(path).toBe('/asana/inbox/ship-files-panel-task-gid-42.md');
  });

  it('googledrive-file reads camelCase fileId + name when no breadcrumb', () => {
    const path = computePath({
      kind: 'googledrive-file',
      externalId: '1A2B3C',
      metadata: { fileId: '1A2B3C', name: 'Q3 plan.docx' },
    });
    expect(path).toBe('/gdrive/q3-plan-docx-1A2B3C');
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
