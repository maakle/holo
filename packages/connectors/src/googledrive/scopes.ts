/**
 * Pattern grammar for Google Drive allowlist entries.
 *
 * Patterns are stored verbatim in `connector_allowlists.pattern`. The spec
 * parses each row at sync time and the picker UI emits them with the same
 * grammar. Keeping the encoding in one module means there's a single source
 * of truth — neither the worker nor the dashboard infers structure from
 * unprefixed strings.
 *
 *   mydrive           → impersonation user's personal My Drive (entire)
 *   drive:<id>        → entire Shared Drive
 *   folder:<id>       → folder + all descendants (recursive walk)
 *   file:<id>         → single file (no listing — direct fetch)
 *
 * Backwards-compat: an unprefixed opaque string that isn't literally
 * `mydrive` is treated as a Shared Drive ID. Prior versions of this
 * connector stored Shared Drive IDs without the `drive:` prefix; this
 * fallback prevents existing rows from going dark after upgrade.
 */

/** Reserved literal for the impersonation user's My Drive. */
export const MY_DRIVE_ALLOWLIST_KEY = 'mydrive';

export type ScopeKind = 'mydrive' | 'drive' | 'folder' | 'file';

export interface ParsedScope {
  kind: ScopeKind;
  /** Drive / folder / file id. `null` for `mydrive`. */
  id: string | null;
  /** Original pattern string, kept for logging. */
  pattern: string;
}

const DRIVE_PREFIX = 'drive:';
const FOLDER_PREFIX = 'folder:';
const FILE_PREFIX = 'file:';

/** Drive resource IDs are URL-safe strings. */
const ID_RE = /^[A-Za-z0-9_-]+$/;

export function parseScope(pattern: string): ParsedScope | null {
  if (pattern === MY_DRIVE_ALLOWLIST_KEY) {
    return { kind: 'mydrive', id: null, pattern };
  }
  if (pattern.startsWith(FOLDER_PREFIX)) {
    const id = pattern.slice(FOLDER_PREFIX.length);
    return ID_RE.test(id) ? { kind: 'folder', id, pattern } : null;
  }
  if (pattern.startsWith(FILE_PREFIX)) {
    const id = pattern.slice(FILE_PREFIX.length);
    return ID_RE.test(id) ? { kind: 'file', id, pattern } : null;
  }
  if (pattern.startsWith(DRIVE_PREFIX)) {
    const id = pattern.slice(DRIVE_PREFIX.length);
    return ID_RE.test(id) ? { kind: 'drive', id, pattern } : null;
  }
  // Backwards-compat: unprefixed opaque string → treat as drive id.
  if (ID_RE.test(pattern)) {
    return { kind: 'drive', id: pattern, pattern };
  }
  return null;
}

export interface ClassifiedScopes {
  /** True when allowlist resolves to "everything under My Drive." */
  hasMyDrive: boolean;
  /** Shared Drive IDs to ingest fully. */
  driveIds: Set<string>;
  /** Folder IDs to walk recursively. */
  folderIds: Set<string>;
  /** Individual file IDs to fetch directly. */
  fileIds: Set<string>;
}

/**
 * Split a resolved allowlist set (output of evaluateAllowlist) into the
 * three execution paths the spec uses: whole-drive scans, folder walks,
 * file fetches.
 */
export function classifyScopes(patterns: Iterable<string>): ClassifiedScopes {
  const out: ClassifiedScopes = {
    hasMyDrive: false,
    driveIds: new Set(),
    folderIds: new Set(),
    fileIds: new Set(),
  };
  for (const pattern of patterns) {
    const parsed = parseScope(pattern);
    if (!parsed) continue;
    switch (parsed.kind) {
      case 'mydrive':
        out.hasMyDrive = true;
        break;
      case 'drive':
        if (parsed.id) out.driveIds.add(parsed.id);
        break;
      case 'folder':
        if (parsed.id) out.folderIds.add(parsed.id);
        break;
      case 'file':
        if (parsed.id) out.fileIds.add(parsed.id);
        break;
    }
  }
  return out;
}

/** Encode helpers — keep call sites symmetric with parseScope. */
export const encodeDriveScope = (id: string): string => `${DRIVE_PREFIX}${id}`;
export const encodeFolderScope = (id: string): string => `${FOLDER_PREFIX}${id}`;
export const encodeFileScope = (id: string): string => `${FILE_PREFIX}${id}`;
