/**
 * Path-fn registry — RFC 0009.
 *
 * Computes a deterministic virtual-filesystem path for each source_artifacts
 * row from its kind + chunk metadata. The worker (apps/worker embed-insert)
 * calls `computePath` once per artifact group when upserting source_artifacts,
 * using the first chunk's metadata (artifact-level fields are present on
 * every chunk of the same artifact, so any chunk in the group works).
 *
 * Paths are stable across re-syncs: same artifact → same path. This is the
 * idempotency contract HoloFs relies on.
 *
 * One entry per chunker kind. Unknown kinds throw — every kind that produces
 * chunks today must have a path-fn here. Adding a new chunker is a two-line
 * change: register the kind in this map, document the path scheme in RFC 0009.
 */
import { holoError, ErrorCode } from '@holo/errors';

export interface PathFnInput {
  kind: string;
  /** The synthetic external id the chunker assigns, e.g. `"pr:owner/repo#123"`. */
  externalId: string;
  /** Metadata from any chunk of this artifact — artifact-level fields are
   * shared across all chunks of one artifact (per the chunker contract). */
  metadata: Record<string, unknown>;
}

export type PathFn = (input: PathFnInput) => string;

// --- helpers ----------------------------------------------------------------

/** Filesystem-safe segment: lowercase, ASCII, dashes for separators. Avoids
 * collisions across sources by being conservative — no spaces, slashes, or
 * shell metacharacters. */
function slug(raw: unknown, fallback: string): string {
  if (raw == null) return fallback;
  const str = String(raw)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // strip combining marks
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return str || fallback;
}

/** Preserve a forward-slash-bearing path string (e.g. file_path,
 * breadcrumb) — slug each segment, rejoin with `/`. */
function slugPath(raw: unknown, fallback: string): string {
  if (raw == null) return fallback;
  const parts = String(raw).split('/').filter(Boolean);
  if (parts.length === 0) return fallback;
  return parts.map((p) => slug(p, '_')).join('/');
}

function dateFromIsoLike(raw: unknown): string {
  if (raw == null) return 'unknown-date';
  // Accept ISO strings, Date.toISOString output, anything with YYYY-MM-DD prefix.
  const s = String(raw);
  const match = s.match(/^(\d{4}-\d{2}-\d{2})/);
  if (match && match[1]) return match[1];
  const d = new Date(s);
  if (!Number.isNaN(d.valueOf())) return d.toISOString().slice(0, 10);
  return 'unknown-date';
}

/** Slack thread_ts is `seconds.microseconds` (e.g. `"1709123456.001200"`).
 * Convert to a UTC date for the directory segment. */
function dateFromSlackTs(ts: unknown): string {
  const n = parseFloat(String(ts ?? ''));
  if (!Number.isFinite(n)) return 'unknown-date';
  return new Date(n * 1000).toISOString().slice(0, 10);
}

// --- registry ---------------------------------------------------------------

export const pathFns: Record<string, PathFn> = {
  'slack-thread': ({ metadata }) => {
    const channel = slug(metadata.channel_name, slug(metadata.channel_id, 'unknown'));
    const ts = String(metadata.thread_ts ?? 'unknown');
    return `/slack/#${channel}/${dateFromSlackTs(metadata.thread_ts)}/thread-${ts}.md`;
  },

  'google-chat-thread': ({ metadata, externalId }) => {
    const space = slug(metadata.space_display_name, slug(metadata.space_name, 'unknown'));
    const thread = slug(metadata.thread_name, slug(externalId, 'thread'));
    return `/google-chat/${space}/${thread}.md`;
  },

  'github-pr': ({ metadata }) => {
    const repo = slugPath(metadata.repo_full_name, 'unknown/unknown');
    return `/github/${repo}/pulls/${metadata.pr_number ?? 'unknown'}.md`;
  },

  'github-issue': ({ metadata }) => {
    const repo = slugPath(metadata.repo_full_name, 'unknown/unknown');
    return `/github/${repo}/issues/${metadata.issue_number ?? 'unknown'}.md`;
  },

  'github-code': ({ metadata }) => {
    const repo = slugPath(metadata.repo_full_name, 'unknown/unknown');
    const file = slugPath(metadata.file_path, 'unknown');
    return `/github/${repo}/code/${file}`;
  },

  'github-doc': ({ metadata }) => {
    const repo = slugPath(metadata.repo_full_name, 'unknown/unknown');
    const file = slugPath(metadata.file_path, 'unknown');
    return `/github/${repo}/docs/${file}`;
  },

  'notion-page': ({ metadata, externalId }) => {
    const breadcrumb = slugPath(
      String(metadata.breadcrumb ?? '').replace(/\s*\/\s*/g, '/'),
      '',
    );
    const pageSlug = slug(metadata.notion_page_id, slug(externalId, 'page'));
    return breadcrumb ? `/notion/${breadcrumb}/${pageSlug}.md` : `/notion/${pageSlug}.md`;
  },

  'grain-call': ({ metadata, externalId }) => {
    const date = dateFromIsoLike(metadata.started_at);
    const title = slug(metadata.title, 'call');
    const id = String(metadata.recording_id ?? externalId);
    return `/grain/${date}/${title}-${id}.md`;
  },

  'pylon-ticket': ({ metadata, externalId }) => {
    const number = metadata.issue_number ?? metadata.ticket_id ?? externalId;
    return `/pylon/tickets/${slug(number, 'unknown')}.md`;
  },

  'hubspot-record': ({ metadata, externalId }) => {
    const type = slug(metadata.record_type, 'record');
    const id = String(metadata.record_id ?? externalId);
    const name = slug(metadata.display_name, id);
    return `/hubspot/${type}/${name}-${id}.md`;
  },

  'salesforce-record': ({ metadata, externalId }) => {
    const type = slug(metadata.record_type, 'record');
    const id = String(metadata.record_id ?? externalId);
    const name = slug(metadata.display_name, id);
    return `/salesforce/${type}/${name}-${id}.md`;
  },

  // The Stripe connector emits one artifact kind per record type — see
  // packages/connectors/src/stripe/chunking.ts (`kind = \`stripe-\${recordType}\``).
  // Paths use the Stripe object id directly (cus_*, sub_*, in_*, ch_*) which is
  // globally unique and survives renames.
  'stripe-customer': ({ metadata, externalId }) => {
    const id = String(metadata.customer_id ?? externalId);
    return `/stripe/customers/${id}.md`;
  },
  'stripe-subscription': ({ externalId }) => {
    return `/stripe/subscriptions/${String(externalId)}.md`;
  },
  'stripe-invoice': ({ externalId }) => {
    return `/stripe/invoices/${String(externalId)}.md`;
  },
  'stripe-charge': ({ externalId }) => {
    return `/stripe/charges/${String(externalId)}.md`;
  },

  'mintlify-page': ({ metadata, externalId }) => {
    const path = slugPath(metadata.path, slug(externalId, 'page'));
    return `/mintlify/${path}.md`;
  },

  'openapi-endpoint': ({ metadata, externalId }) => {
    const api = slug(metadata.api_title, 'api');
    const method = slug(metadata.method, 'method');
    const path = slugPath(metadata.path, slug(externalId, 'endpoint'));
    return `/openapi/${api}/${method}-${path}.md`;
  },

  'prismic-document': ({ metadata, externalId }) => {
    const repo = slug(metadata.prismic_repo, 'repo');
    const type = slug(metadata.prismic_type, 'type');
    const uid = slug(metadata.prismic_uid, slug(externalId, 'doc'));
    return `/prismic/${repo}/${type}/${uid}.md`;
  },

  'webcrawl-page': ({ metadata, externalId }) => {
    const url = String(metadata.url ?? '');
    if (url) {
      try {
        const u = new URL(url);
        const path = slugPath(u.pathname, 'root');
        return `/webcrawl/${slug(u.hostname, 'site')}/${path}.md`;
      } catch {
        // fall through
      }
    }
    return `/webcrawl/${slug(externalId, 'page')}.md`;
  },

  'zendesk-article': ({ metadata, externalId }) => {
    const section = slug(metadata.section, 'general');
    const id = String(metadata.article_id ?? externalId);
    const title = slug(metadata.title, id);
    return `/zendesk/${section}/${title}-${id}.md`;
  },

  // --- kinds emitted by @holo/connectors (not @holo/chunker) ----------------
  // These connectors do their own chunking and emit chunks directly. We
  // register path-fns here so embed-insert can populate `path` on the
  // source_artifacts row.

  'googledrive-file': ({ metadata, externalId }) => {
    const driveSegments = (() => {
      const breadcrumb = metadata.breadcrumb;
      if (Array.isArray(breadcrumb)) {
        const filtered = (breadcrumb as unknown[])
          .filter((b): b is string => typeof b === 'string' && b.length > 0)
          .map((b) => slug(b, 'folder'));
        if (filtered.length > 0) return filtered.join('/');
      }
      return null;
    })();
    const id = String(metadata.file_id ?? externalId);
    const name = slug(metadata.file_name ?? metadata.title, id);
    const dir = driveSegments ? `/${driveSegments}` : '';
    return `/gdrive${dir}/${name}-${id}`;
  },

  'jira-project': ({ metadata, externalId }) => {
    const key = slug(metadata.project_key, slug(externalId, 'project'));
    return `/jira/${key}.md`;
  },
  'jira-issue': ({ metadata, externalId }) => {
    const key = slug(metadata.issue_key, slug(externalId, 'issue'));
    return `/jira/issues/${key}.md`;
  },
  'jira-comment': ({ metadata, externalId }) => {
    const issueKey = slug(metadata.issue_key, 'issue');
    const id = String(metadata.comment_id ?? externalId);
    return `/jira/issues/${issueKey}/comments/${id}.md`;
  },

  'linear-issue': ({ metadata, externalId }) => {
    const team = slug(metadata.team_key ?? metadata.team_name, 'team');
    const identifier = slug(metadata.identifier ?? metadata.issue_identifier ?? externalId, 'issue');
    return `/linear/${team}/${identifier}.md`;
  },

  'asana-task': ({ metadata, externalId }) => {
    const project = slug(metadata.project_name, 'project');
    const id = String(metadata.task_id ?? externalId);
    const title = slug(metadata.title, id);
    return `/asana/${project}/${title}-${id}.md`;
  },

  'confluence-space': ({ metadata, externalId }) => {
    const key = slug(metadata.space_key, slug(externalId, 'space'));
    return `/confluence/${key}.md`;
  },
  'confluence-page': ({ metadata, externalId }) => {
    const space = slug(metadata.space_key, 'space');
    const id = String(metadata.page_id ?? externalId);
    const title = slug(metadata.title, id);
    return `/confluence/${space}/${title}-${id}.md`;
  },
  'confluence-comment': ({ metadata, externalId }) => {
    const space = slug(metadata.space_key, 'space');
    const pageId = String(metadata.page_id ?? 'page');
    const id = String(metadata.comment_id ?? externalId);
    return `/confluence/${space}/${pageId}/comments/${id}.md`;
  },

  'airtable-record': ({ metadata, externalId }) => {
    const base = slug(metadata.base_name ?? metadata.base_id, 'base');
    const table = slug(metadata.table_name ?? metadata.table_id, 'table');
    const id = String(metadata.record_id ?? externalId);
    return `/airtable/${base}/${table}/${id}.md`;
  },

  'gitlab-mr': ({ metadata }) => {
    const repo = slugPath(metadata.repo_full_name ?? metadata.project_path, 'unknown/unknown');
    return `/gitlab/${repo}/merge_requests/${metadata.mr_iid ?? metadata.iid ?? 'unknown'}.md`;
  },
  'gitlab-issue': ({ metadata }) => {
    const repo = slugPath(metadata.repo_full_name ?? metadata.project_path, 'unknown/unknown');
    return `/gitlab/${repo}/issues/${metadata.issue_iid ?? metadata.iid ?? 'unknown'}.md`;
  },
  'gitlab-code': ({ metadata }) => {
    const repo = slugPath(metadata.repo_full_name ?? metadata.project_path, 'unknown/unknown');
    const file = slugPath(metadata.file_path, 'unknown');
    return `/gitlab/${repo}/code/${file}`;
  },
  'gitlab-doc': ({ metadata }) => {
    const repo = slugPath(metadata.repo_full_name ?? metadata.project_path, 'unknown/unknown');
    const file = slugPath(metadata.file_path, 'unknown');
    return `/gitlab/${repo}/docs/${file}`;
  },

  // HubSpot connector emits four variants of the generic hubspot-record kind.
  // Same shape; same path scheme.
  'hubspot-contact': ({ metadata, externalId }) => {
    const id = String(metadata.record_id ?? externalId);
    const name = slug(metadata.display_name, id);
    return `/hubspot/contacts/${name}-${id}.md`;
  },
  'hubspot-company': ({ metadata, externalId }) => {
    const id = String(metadata.record_id ?? externalId);
    const name = slug(metadata.display_name, id);
    return `/hubspot/companies/${name}-${id}.md`;
  },
  'hubspot-deal': ({ metadata, externalId }) => {
    const id = String(metadata.record_id ?? externalId);
    const name = slug(metadata.display_name, id);
    return `/hubspot/deals/${name}-${id}.md`;
  },
  'hubspot-engagement': ({ metadata, externalId }) => {
    const id = String(metadata.engagement_id ?? metadata.record_id ?? externalId);
    const type = slug(metadata.engagement_type, 'engagement');
    return `/hubspot/engagements/${type}-${id}.md`;
  },

  'mintlify-openapi-endpoint': ({ metadata, externalId }) => {
    const method = slug(metadata.method, 'method');
    const path = slugPath(metadata.path, slug(externalId, 'endpoint'));
    return `/mintlify/api/${method}-${path}.md`;
  },

  // --- sample data (db/sample-data.ts) --------------------------------------
  // Star Wars seed. Lets the file explorer show real-shaped paths on a fresh
  // workspace before any connector is wired up.

  doc: ({ metadata, externalId }) => {
    const title = slug(metadata.title, slug(externalId, 'doc'));
    return `/sample/docs/${title}.md`;
  },
  message: ({ metadata, externalId }) => {
    // sample message titles include the channel: "#mos-eisley — Obi-Wan Kenobi"
    const title = String(metadata.title ?? '');
    const channelMatch = title.match(/^#([\w-]+)/);
    const channel = channelMatch && channelMatch[1] ? slug(channelMatch[1], 'channel') : 'general';
    const id = slug(externalId, 'msg');
    return `/sample/messages/#${channel}/${id}.md`;
  },
  issue: ({ metadata, externalId }) => {
    const id = slug(externalId, 'issue');
    const title = slug(metadata.title, id);
    return `/sample/issues/${title}.md`;
  },
};

/** Compute the virtual-filesystem path for an artifact. Throws if no path-fn
 * is registered for `kind` — every chunker kind that produces chunks must
 * have an entry above. */
export function computePath(input: PathFnInput): string {
  const fn = pathFns[input.kind];
  if (!fn) {
    throw holoError({
      code: ErrorCode.HOLO_INVALID_INPUT,
      problem: `No path-fn registered for kind '${input.kind}'.`,
      fix: 'Add an entry to pathFns in packages/chunker/src/path-fn.ts. See RFC 0009.',
    });
  }
  return fn(input);
}

/** Whether a given kind has a registered path-fn. Used by the worker to
 * skip path computation gracefully for kinds that haven't been wired up
 * yet (defense in depth — `computePath` itself throws). */
export function hasPathFn(kind: string): boolean {
  return kind in pathFns;
}
