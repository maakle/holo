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
import { computeSourceUrl } from '@holo/chunker';
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
 * Resolve the effective provider for citation purposes. Manual-upload
 * sessions tag themselves with the originating tool (e.g. 'pylon', 'grain')
 * in `metadata.chunk_provider` while `source.provider` stays the literal
 * 'manual-upload'. For citation labels and URL building we want to treat
 * the chunk as if it came from the tagged native provider — otherwise
 * everything uploaded via manual-upload gets a generic "document ·
 * manual-upload" label even when the user explicitly tagged it.
 *
 * Native syncs leave `chunk_provider` unset, so they keep their own
 * provider name.
 */
function effectiveProvider(result: SearchResult): string {
  if (result.source.provider !== 'manual-upload') return result.source.provider;
  const tag = result.source.metadata['chunk_provider'];
  return typeof tag === 'string' && tag.length > 0 ? tag : 'manual-upload';
}

/**
 * Provider-aware deep link. Two layers:
 *   1. `result.snippetUrl` — chunker-set, points at the exact chunk (PR
 *      line, doc section). Most accurate; trust it when present.
 *   2. `computeSourceUrl({ kind, externalId, metadata })` — the shared
 *      url-fn registry in @holo/chunker. Same logic that stamps
 *      `source_artifacts.source_url` at embed-insert time, so a citation
 *      URL here and a bash-citation URL elsewhere always agree.
 *
 * The retrieval layer strips the `<provider>-` prefix from chunks.kind
 * before handing it to citation builders (so the local switch could match
 * `'pr'`/`'doc'`), but the url-fn registry is keyed on the full namespaced
 * kind. Reconstruct it here, using the effective provider so manual-upload
 * chunks tagged as e.g. 'pylon' get the same URL treatment as a native sync.
 */
export function buildCitationUrl(result: SearchResult): string | undefined {
  if (result.snippetUrl) return result.snippetUrl;
  const fullKind = `${effectiveProvider(result)}-${result.source.artifactKind}`;
  const fromRegistry = computeSourceUrl({
    kind: fullKind,
    externalId: result.chunkId,
    metadata: result.source.metadata,
  });
  return fromRegistry ?? undefined;
}

/**
 * Compact human-readable identifier for the citation. Format priority:
 *   1. Provider-specific natural label (e.g. "PR #1234 · acme/repo")
 *   2. Generic "<artifactKind> · <provider>" if metadata is sparse
 * Always non-empty so the UI doesn't have to defend against `""`.
 */
export function buildCitationLabel(result: SearchResult): string {
  const m = result.source.metadata;
  const provider = effectiveProvider(result);
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

