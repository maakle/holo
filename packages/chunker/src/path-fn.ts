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

  'stripe-record': ({ metadata, externalId }) => {
    const type = slug(metadata.record_type, 'record');
    const id = String(metadata.record_id ?? externalId);
    return `/stripe/${type}/${id}.md`;
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
};

/** Compute the virtual-filesystem path for an artifact. Throws if no path-fn
 * is registered for `kind` — every chunker kind that produces chunks must
 * have an entry above. */
export function computePath(input: PathFnInput): string {
  const fn = pathFns[input.kind];
  if (!fn) {
    throw new Error(
      `No path-fn registered for kind '${input.kind}'. ` +
        `Add an entry to pathFns in packages/chunker/src/path-fn.ts.`,
    );
  }
  return fn(input);
}

/** Whether a given kind has a registered path-fn. Used by the worker to
 * skip path computation gracefully for kinds that haven't been wired up
 * yet (defense in depth — `computePath` itself throws). */
export function hasPathFn(kind: string): boolean {
  return kind in pathFns;
}
