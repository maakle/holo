/**
 * URL-fn registry — the source-system deep-link counterpart to path-fn.
 *
 * For every artifact kind that has a registered path-fn (see `./path-fn.ts`),
 * a url-fn computes a deep link back into the original source system: the
 * actual Slack thread URL, GitHub PR URL, Notion page URL, Stripe dashboard
 * link, etc. Called once at embed-insert time and stored on
 * `source_artifacts.source_url`. The agent's `bash` citation extractor
 * batches a lookup by path to surface real URLs in slack replies, without
 * the citation builder having to know per-provider URL formats.
 *
 * Kinds with no derivable URL return `null`; the per-kind switch falls
 * through to a generic metadata probe (`url` / `permalink` / `webViewLink`)
 * that catches anything the connector happens to have stamped on the chunk.
 * That covers jira, linear, asana, confluence, mintlify, zendesk, airtable,
 * gitlab and any future connector that stores a canonical link directly.
 *
 * Keep `urlFns` keyed by the SAME artifact kinds as `pathFns`. Any new
 * chunker should land both entries together.
 */

export interface UrlFnInput {
  kind: string;
  externalId: string;
  metadata: Record<string, unknown>;
}

export type UrlFn = (input: UrlFnInput) => string | null;

// --- helpers ----------------------------------------------------------------

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

/**
 * Generic last-resort: many connectors persist a canonical link directly on
 * the chunk metadata. Accept the three keys we've seen in production
 * (jira/linear/asana use `url`, slack uses `permalink`, google drive uses
 * `webViewLink`). Reject anything that doesn't look like an http(s) URL so
 * we don't accidentally promote a path or id as a link.
 */
function metadataUrlFallback(metadata: Record<string, unknown>): string | null {
  for (const key of ['url', 'permalink', 'webViewLink'] as const) {
    const v = metadata[key];
    if (typeof v === 'string' && /^https?:\/\//.test(v)) return v;
  }
  return null;
}

// --- registry ---------------------------------------------------------------

export const urlFns: Record<string, UrlFn> = {
  'slack-thread': ({ metadata }) => {
    // Connectors store the rendered Slack permalink directly when available;
    // it's the only fully-correct form (the workspace subdomain isn't in the
    // chunk metadata). Without permalink we can't construct a stable URL
    // because Slack permalinks require the workspace prefix.
    return str(metadata.permalink) ?? null;
  },

  'google-chat-thread': ({ metadata }) => {
    // thread_name is the canonical Google API resource id
    // ("spaces/AAA/threads/BBB"). The user-facing URL strips the prefixes.
    const thread = str(metadata.thread_name);
    const space = str(metadata.space_name);
    const match = thread?.match(/^spaces\/([^/]+)\/threads\/([^/]+)$/);
    if (match) return `https://mail.google.com/chat/u/0/#chat/space/${match[1]}/thread/${match[2]}`;
    if (space?.startsWith('spaces/'))
      return `https://mail.google.com/chat/u/0/#chat/space/${space.slice('spaces/'.length)}`;
    return null;
  },

  /**
   * Microsoft Graph hands us a fully-rendered `webUrl` on the root message
   * (e.g. `https://teams.microsoft.com/l/message/19:xxx@thread.tacv2/yyy?
   * tenantId=...&groupId=...`). The chunker persists it as
   * `metadata.web_url` so we just read it back. Returning null falls
   * through to the dashboard's `/files/<path>` view — accurate when
   * Graph didn't supply a webUrl (deleted parent message, system event
   * thread, etc.).
   */
  'teams-thread': ({ metadata }) => {
    return str(metadata.web_url) ?? null;
  },

  'github-pr': ({ metadata }) => {
    const repo = str(metadata.repo_full_name) ?? str(metadata.repoFullName);
    const n = num(metadata.pr_number);
    if (!repo || n === undefined) return null;
    return `https://github.com/${repo}/pull/${n}`;
  },

  'github-issue': ({ metadata }) => {
    const repo = str(metadata.repo_full_name) ?? str(metadata.repoFullName);
    const n = num(metadata.issue_number);
    if (!repo || n === undefined) return null;
    return `https://github.com/${repo}/issues/${n}`;
  },

  'github-code': ({ metadata }) => {
    const repo = str(metadata.repo_full_name) ?? str(metadata.repoFullName);
    const file = str(metadata.file_path);
    if (!repo || !file) return null;
    const ref = str(metadata.commit_sha) ?? 'HEAD';
    const start = metadata.start_line !== undefined ? `#L${metadata.start_line}` : '';
    const end = metadata.end_line !== undefined ? `-L${metadata.end_line}` : '';
    return `https://github.com/${repo}/blob/${ref}/${file}${start}${end}`;
  },

  'github-doc': ({ metadata }) => {
    const repo = str(metadata.repo_full_name) ?? str(metadata.repoFullName);
    const file = str(metadata.file_path);
    if (!repo || !file) return null;
    return `https://github.com/${repo}/blob/HEAD/${file}`;
  },

  'notion-page': ({ metadata }) => {
    const id = str(metadata.notion_page_id);
    if (!id) return metadataUrlFallback(metadata);
    return `https://www.notion.so/${id.replace(/-/g, '')}`;
  },

  'grain-call': ({ metadata, externalId }) => {
    const id = str(metadata.recording_id) ?? externalId;
    if (!id) return null;
    return `https://grain.com/share/recording/${id}`;
  },

  'pylon-ticket': ({ metadata }) => {
    const issueNumber = num(metadata.issue_number);
    if (issueNumber !== undefined) {
      return `https://app.usepylon.com/issues?issueNumber=${issueNumber}`;
    }
    return metadataUrlFallback(metadata);
  },

  // HubSpot connector emits four kinds (one path each). The generic
  // hubspot-record kind is kept for legacy data only. URL pattern is the
  // same — record_id is unique across types.
  'hubspot-record': ({ metadata }) => metadataUrlFallback(metadata),
  'hubspot-contact': ({ metadata }) => metadataUrlFallback(metadata),
  'hubspot-company': ({ metadata }) => metadataUrlFallback(metadata),
  'hubspot-deal': ({ metadata }) => metadataUrlFallback(metadata),
  'hubspot-engagement': ({ metadata }) => metadataUrlFallback(metadata),

  // Salesforce doesn't have a stable per-instance URL pattern we can
  // reconstruct without the org's My Domain. Accept whatever the connector
  // stamped on metadata.
  'salesforce-record': ({ metadata }) => metadataUrlFallback(metadata),

  // Stripe dashboard. Charges live under /payments; other record types use
  // the pluralised type. Livemode=false → test/ prefix.
  'stripe-customer': ({ metadata, externalId }) => stripeDashboardUrl('customers', externalId, metadata),
  'stripe-subscription': ({ metadata, externalId }) =>
    stripeDashboardUrl('subscriptions', externalId, metadata),
  'stripe-invoice': ({ metadata, externalId }) => stripeDashboardUrl('invoices', externalId, metadata),
  'stripe-charge': ({ metadata, externalId }) => stripeDashboardUrl('payments', externalId, metadata),

  'mintlify-page': ({ metadata }) => metadataUrlFallback(metadata),
  'mintlify-openapi-endpoint': ({ metadata }) => metadataUrlFallback(metadata),
  'openapi-endpoint': ({ metadata }) => metadataUrlFallback(metadata),

  'prismic-document': ({ metadata }) => {
    const repo = str(metadata.prismic_repo);
    const docId = str(metadata.prismic_document_id);
    if (repo && docId) return `https://${repo}.prismic.io/documents/${docId}/`;
    return metadataUrlFallback(metadata);
  },

  'webcrawl-page': ({ metadata }) => {
    // The crawled URL IS the source URL.
    const url = str(metadata.url);
    if (url && /^https?:\/\//.test(url)) return url;
    return null;
  },

  'zendesk-article': ({ metadata }) => metadataUrlFallback(metadata),

  'googledrive-file': ({ metadata }) => metadataUrlFallback(metadata),

  'jira-project': ({ metadata }) => metadataUrlFallback(metadata),
  'jira-issue': ({ metadata }) => metadataUrlFallback(metadata),
  'jira-comment': ({ metadata }) => metadataUrlFallback(metadata),

  'linear-issue': ({ metadata }) => metadataUrlFallback(metadata),

  'asana-task': ({ metadata }) => metadataUrlFallback(metadata),

  'confluence-space': ({ metadata }) => metadataUrlFallback(metadata),
  'confluence-page': ({ metadata }) => metadataUrlFallback(metadata),
  'confluence-comment': ({ metadata }) => metadataUrlFallback(metadata),

  'airtable-record': ({ metadata }) => metadataUrlFallback(metadata),

  'gitlab-mr': ({ metadata }) => gitlabUrl(metadata, 'merge_requests', metadata.mr_iid ?? metadata.iid),
  'gitlab-issue': ({ metadata }) =>
    gitlabUrl(metadata, 'issues', metadata.issue_iid ?? metadata.iid),
  'gitlab-code': ({ metadata }) => {
    const repo = str(metadata.repo_full_name) ?? str(metadata.project_path);
    const file = str(metadata.file_path);
    if (!repo || !file) return metadataUrlFallback(metadata);
    return `https://gitlab.com/${repo}/-/blob/HEAD/${file}`;
  },
  'gitlab-doc': ({ metadata }) => {
    const repo = str(metadata.repo_full_name) ?? str(metadata.project_path);
    const file = str(metadata.file_path);
    if (!repo || !file) return metadataUrlFallback(metadata);
    return `https://gitlab.com/${repo}/-/blob/HEAD/${file}`;
  },

  // Sample-data kinds (loaded by `ensureSampleData` for the dogfood and demo
  // workspaces). No external source system — the path under `/sample/...`
  // is the only address. Explicit null entries keep the path-fn ↔ url-fn
  // registries in lock-step so the round-trip test in url-fn.test.ts can
  // assert coverage without listing exceptions.
  doc: () => null,
  message: () => null,
  issue: () => null,
};

function stripeDashboardUrl(
  segment: 'customers' | 'subscriptions' | 'invoices' | 'payments',
  externalId: string,
  metadata: Record<string, unknown>,
): string | null {
  const id = str(metadata.record_id) ?? externalId;
  if (!id) return null;
  const prefix = metadata.livemode === false ? 'test/' : '';
  return `https://dashboard.stripe.com/${prefix}${segment}/${id}`;
}

function gitlabUrl(
  metadata: Record<string, unknown>,
  segment: 'merge_requests' | 'issues',
  iid: unknown,
): string | null {
  const repo = str(metadata.repo_full_name) ?? str(metadata.project_path);
  const n = num(iid);
  if (!repo || n === undefined) return metadataUrlFallback(metadata);
  return `https://gitlab.com/${repo}/-/${segment}/${n}`;
}

/**
 * Compute the source-system URL for an artifact, or `null` if no URL can be
 * derived. Called by embed-insert at upsert time and by the path-backfill
 * job. Idempotent; same input always yields the same URL.
 */
export function computeSourceUrl(input: UrlFnInput): string | null {
  const fn = urlFns[input.kind];
  if (fn) {
    const out = fn(input);
    if (out) return out;
  }
  // Generic fallback applies to every kind — even those without a registered
  // url-fn — so a connector that stamps a canonical link on metadata without
  // a dedicated url-fn still gets credit.
  return metadataUrlFallback(input.metadata);
}

export function hasUrlFn(kind: string): boolean {
  return Object.prototype.hasOwnProperty.call(urlFns, kind);
}
