/**
 * Citation projection: SearchResult → user-facing source link.
 *
 * Lives in agent-tools (not retrieval-core) because the projection embeds
 * UX-level decisions — label format, snippet truncation, what counts as a
 * "good enough" URL — that don't belong in the retrieval substrate.
 *
 * The orchestrator collects citations from every `search` tool call across a
 * turn and emits them in order; the model is told to reference them as
 * `[1]`, `[2]`, ... in its answer. The web layer renders the references as
 * footnote-style links.
 */
import type { SearchResult } from '@holo/retrieval-core';

export interface Citation {
  /** 1-based index across the orchestrator's collected citations for one
   * answer. Numbers are stable within a turn; the orchestrator assigns them
   * in the order tool calls returned. */
  index: number;
  chunkId: string;
  provider: string;
  artifactKind: string;
  /** Short human-readable identifier ("Skello deal · HubSpot", "PR #1234 ·
   * acme/repo"). Built by `buildCitationLabel`. */
  label: string;
  /** Best-effort deep link to the source surface. May be undefined for
   * providers we don't yet know how to URL-build (e.g. Salesforce). */
  url?: string;
  /** First ~200 chars of the chunk content — enough for the UI to render a
   * hover preview without re-fetching. */
  snippet: string;
}

/**
 * Provider-aware deep link. Mirrors the existing `deriveSnippetUrl` in
 * `tools/search.ts` (which we also keep, to avoid changing the tool's wire
 * format for already-deployed agents). When that source is `result.snippetUrl`
 * — already set by the chunker — we trust it.
 */
export function buildCitationUrl(result: SearchResult): string | undefined {
  if (result.snippetUrl) return result.snippetUrl;
  const m = result.source.metadata;
  const provider = result.source.provider;
  const kind = result.source.artifactKind;

  // Provider-specific builders below take precedence — they reconstruct a URL
  // that points at the exact chunk (PR line, page section). The direct-URL
  // fallback at the bottom covers providers whose connector already stored
  // a canonical link in metadata (jira/linear/asana/confluence/zendesk/etc.).

  if (provider === 'github') {
    const repo = typeof m['repo_full_name'] === 'string'
      ? (m['repo_full_name'] as string)
      : typeof m['repoFullName'] === 'string'
        ? (m['repoFullName'] as string)
        : undefined;
    if (!repo) return undefined;
    if (kind === 'pr' && typeof m['pr_number'] === 'number') {
      return `https://github.com/${repo}/pull/${m['pr_number']}`;
    }
    if (kind === 'doc' && typeof m['file_path'] === 'string') {
      return `https://github.com/${repo}/blob/HEAD/${m['file_path']}`;
    }
    if (kind === 'code' && typeof m['file_path'] === 'string') {
      const ref = typeof m['commit_sha'] === 'string' ? (m['commit_sha'] as string) : 'HEAD';
      const start = m['start_line'] !== undefined ? `#L${m['start_line']}` : '';
      const end = m['end_line'] !== undefined ? `-L${m['end_line']}` : '';
      return `https://github.com/${repo}/blob/${ref}/${m['file_path']}${start}${end}`;
    }
  }
  if (provider === 'notion' && typeof m['notion_page_id'] === 'string') {
    return `https://www.notion.so/${(m['notion_page_id'] as string).replace(/-/g, '')}`;
  }
  if (provider === 'grain' && typeof m['recording_id'] === 'string') {
    return `https://grain.com/share/recording/${m['recording_id']}`;
  }
  if (provider === 'pylon' && typeof m['issue_number'] === 'number') {
    return `https://app.usepylon.com/issues?issueNumber=${m['issue_number']}`;
  }
  if (provider === 'google-chat') {
    // thread_name is the canonical Google API resource id
    // ("spaces/AAA/threads/BBB"). Build the user-facing chat URL by
    // extracting the bare space/thread ids — the URL form Google's web app
    // uses expects them un-prefixed.
    const thread = typeof m['thread_name'] === 'string' ? (m['thread_name'] as string) : undefined;
    const space = typeof m['space_name'] === 'string' ? (m['space_name'] as string) : undefined;
    const match = thread?.match(/^spaces\/([^/]+)\/threads\/([^/]+)$/);
    if (match) return `https://mail.google.com/chat/u/0/#chat/space/${match[1]}/thread/${match[2]}`;
    if (space?.startsWith('spaces/')) return `https://mail.google.com/chat/u/0/#chat/space/${space.slice('spaces/'.length)}`;
  }
  if (provider === 'prismic') {
    const repo = typeof m['prismic_repo'] === 'string' ? (m['prismic_repo'] as string) : undefined;
    const docId = typeof m['prismic_document_id'] === 'string' ? (m['prismic_document_id'] as string) : undefined;
    if (repo && docId) return `https://${repo}.prismic.io/documents/${docId}/`;
  }
  if (provider === 'stripe') {
    const id = typeof m['record_id'] === 'string' ? (m['record_id'] as string) : undefined;
    const type = typeof m['record_type'] === 'string' ? (m['record_type'] as string) : undefined;
    if (id && type) {
      // Charges live under /payments in the Stripe dashboard; other record
      // types use the pluralised type as the path segment.
      const segment = type === 'charge' ? 'payments' : `${type}s`;
      const prefix = m['livemode'] === false ? 'test/' : '';
      return `https://dashboard.stripe.com/${prefix}${segment}/${id}`;
    }
  }

  // Generic fallback: many connectors (jira, linear, asana, confluence,
  // mintlify, zendesk, airtable) already persist a canonical URL on the
  // artifact; google drive uses `webViewLink`, slack uses `permalink`.
  // Accept any of those as a last resort.
  for (const key of ['url', 'webViewLink', 'permalink'] as const) {
    const v = m[key];
    if (typeof v === 'string' && /^https?:\/\//.test(v)) return v;
  }
  return undefined;
}

/**
 * Compact human-readable identifier for the citation. Format priority:
 *   1. Provider-specific natural label (e.g. "PR #1234 · acme/repo")
 *   2. Generic "<artifactKind> · <provider>" if metadata is sparse
 * Always non-empty so the UI doesn't have to defend against `""`.
 */
export function buildCitationLabel(result: SearchResult): string {
  const m = result.source.metadata;
  const provider = result.source.provider;
  const kind = result.source.artifactKind;

  // Provider-specific labels — same priority order as the URL builder.
  if (provider === 'github') {
    const repo = typeof m['repo_full_name'] === 'string' ? (m['repo_full_name'] as string) : null;
    if (kind === 'pr' && typeof m['pr_number'] === 'number') {
      const title = typeof m['title'] === 'string' ? ` — ${m['title'] as string}` : '';
      return repo ? `PR #${m['pr_number']} · ${repo}${title}` : `PR #${m['pr_number']}${title}`;
    }
    if ((kind === 'doc' || kind === 'code') && typeof m['file_path'] === 'string') {
      return repo ? `${m['file_path']} · ${repo}` : `${m['file_path']}`;
    }
  }
  if (provider === 'pylon') {
    const title = typeof m['title'] === 'string' ? (m['title'] as string) : null;
    if (typeof m['issue_number'] === 'number') {
      return title ? `Pylon #${m['issue_number']} — ${title}` : `Pylon #${m['issue_number']}`;
    }
  }
  if (provider === 'hubspot') {
    const display = typeof m['display_name'] === 'string' ? (m['display_name'] as string) : null;
    return display ? `HubSpot ${kind || 'record'} — ${display}` : `HubSpot ${kind || 'record'}`;
  }
  if (provider === 'salesforce') {
    const display = typeof m['display_name'] === 'string' ? (m['display_name'] as string) : null;
    return display ? `Salesforce ${kind || 'record'} — ${display}` : `Salesforce ${kind || 'record'}`;
  }
  if (provider === 'grain') {
    const title = typeof m['title'] === 'string' ? (m['title'] as string) : null;
    return title ? `Grain — ${title}` : 'Grain recording';
  }
  if (provider === 'notion') {
    const title = typeof m['page_title'] === 'string'
      ? (m['page_title'] as string)
      : typeof m['title'] === 'string'
        ? (m['title'] as string)
        : null;
    return title ? `Notion — ${title}` : 'Notion page';
  }
  if (provider === 'slack') {
    const channel = typeof m['channel_name'] === 'string' ? (m['channel_name'] as string) : null;
    return channel ? `Slack — #${channel}` : 'Slack thread';
  }
  // Fallback: kind first because it's usually the meaningful part.
  return kind ? `${kind} · ${provider}` : provider;
}

const CITATION_SNIPPET_LEN = 200;

export function buildCitationSnippet(result: SearchResult): string {
  const text = result.content.trim().replace(/\s+/g, ' ');
  if (text.length <= CITATION_SNIPPET_LEN) return text;
  return `${text.slice(0, CITATION_SNIPPET_LEN - 1).trimEnd()}…`;
}

export function toCitation(result: SearchResult, index: number): Citation {
  const url = buildCitationUrl(result);
  return {
    index,
    chunkId: result.chunkId,
    provider: result.source.provider,
    artifactKind: result.source.artifactKind,
    label: buildCitationLabel(result),
    snippet: buildCitationSnippet(result),
    ...(url !== undefined ? { url } : {}),
  };
}

/**
 * Wire-format (snake_case) projection of `Citation`. Used by REST `/v1/search`
 * and MCP `search` tool output where the rest of the wire is snake_case
 * (`chunk_id`, `artifact_kind`). Internal TS APIs keep `Citation` camelCase.
 */
export interface WireCitation {
  index: number;
  chunk_id: string;
  provider: string;
  artifact_kind: string;
  label: string;
  url?: string;
  snippet: string;
}

export function citationToWire(c: Citation): WireCitation {
  return {
    index: c.index,
    chunk_id: c.chunkId,
    provider: c.provider,
    artifact_kind: c.artifactKind,
    label: c.label,
    snippet: c.snippet,
    ...(c.url !== undefined ? { url: c.url } : {}),
  };
}

