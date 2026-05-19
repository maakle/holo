/**
 * Manual-upload connector primitives shared by API routes, wizard steps,
 * and the manage drawer.
 *
 * `'manual-upload'` is intentionally NOT in `SYNC_PROVIDERS`: it has no
 * cron-driven sync, no OAuth credential row, and no worker module. The
 * `sources.provider`, `chunks.provider`, and `sync_runs.provider` columns
 * are plain `text` (no enum), so the string is valid wherever it appears.
 *
 * The chunk-level `provider` is set to the user-selected source tool
 * (e.g. `'grain'`) when known so retrieval naturally clusters imported
 * data with live-synced data of the same tool. The path stays under
 * `/manual-upload/<session-slug>/...` so the file explorer keeps imports
 * visually separate.
 */

import { SYNC_PROVIDERS, type SyncProvider } from '@holo/sync-providers';
import { CONNECTORS } from './connector-registry';

export const MANUAL_UPLOAD_PROVIDER = 'manual-upload' as const;

/**
 * Source tools a user can pick for an upload session.
 *
 * Derived from `SYNC_PROVIDERS` so every connector Holo can sync is a valid
 * tag — adding a new connector to `@holo/sync-providers` automatically
 * surfaces it in the upload wizard's dropdown without a second list to keep
 * in sync. `'other'` is the explicit opt-out that tags chunks as
 * manual-upload instead of clustering them with a real connector's data.
 */
export const MANUAL_UPLOAD_SOURCE_TOOLS = [
  ...SYNC_PROVIDERS,
  'other',
] as const;

export type ManualUploadSourceTool = SyncProvider | 'other';

export function isManualUploadSourceTool(value: string): value is ManualUploadSourceTool {
  return (MANUAL_UPLOAD_SOURCE_TOOLS as readonly string[]).includes(value);
}

/**
 * The provider id stamped on `chunks.provider` for an uploaded file. When the
 * user tagged a real connector (grain/pylon/etc.) the chunk's provider is
 * that connector id — retrieval treats it as native data. `'other'` falls
 * back to the manual-upload provider tag.
 */
export function sourceToolToChunkProvider(tool: ManualUploadSourceTool): string {
  return tool === 'other' ? MANUAL_UPLOAD_PROVIDER : tool;
}

/** Display label for the source tool dropdown + manage drawer chip. */
export function sourceToolLabel(tool: ManualUploadSourceTool): string {
  if (tool === 'other') return 'Other';
  // Connector registry is the single source of truth for human-readable
  // names; falling back to the raw id keeps things resilient if a
  // SYNC_PROVIDERS entry ever ships without a matching CONNECTORS row.
  return CONNECTORS.find((c) => c.id === tool)?.displayName ?? tool;
}

/** Hard cap per uploaded file (server-enforced; client mirrors this). */
export const MANUAL_UPLOAD_MAX_FILE_BYTES = 5 * 1024 * 1024;
