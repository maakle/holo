/**
 * Path parsing + normalization. RFC 0009.
 *
 * HoloFs paths are absolute POSIX-style, leading slash, no trailing slash,
 * no `..`, no embedded `//`. Rejects anything that could be used to escape
 * the virtual root (defense in depth — `acl_subjects` is still the
 * authoritative gate, but a clean path parser closes one class of bugs).
 */
import { EINVAL } from './errors';

function hasControlChars(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x20 || c === 0x7f) return true;
  }
  return false;
}

export function normalizePath(input: string): string {
  if (typeof input !== 'string' || input.length === 0) {
    throw EINVAL(input, 'Path must be a non-empty string');
  }
  if (!input.startsWith('/')) {
    throw EINVAL(input, 'Path must be absolute (start with /)');
  }
  if (hasControlChars(input)) {
    throw EINVAL(input, 'Path contains control characters');
  }

  const segments = input.split('/');
  const out: string[] = [];
  for (const seg of segments) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      // No escaping the root.
      throw EINVAL(input, 'Path traversal not permitted');
    }
    out.push(seg);
  }
  return '/' + out.join('/');
}

/** Return the directory portion of a path. `/a/b/c` -> `/a/b`. `/a` -> `/`. `/` -> `/`. */
export function dirname(path: string): string {
  const norm = normalizePath(path);
  if (norm === '/') return '/';
  const idx = norm.lastIndexOf('/');
  if (idx <= 0) return '/';
  return norm.slice(0, idx);
}

/** Return the final segment of a path. `/a/b/c` -> `c`. `/` -> ''. */
export function basename(path: string): string {
  const norm = normalizePath(path);
  if (norm === '/') return '';
  const idx = norm.lastIndexOf('/');
  return norm.slice(idx + 1);
}

/**
 * For a path used as a directory prefix, return the string we LIKE-match
 * against `source_artifacts.path`. Adds a trailing `/` if not already
 * present so `/slack` doesn't match `/slackotron/...`. Root path matches
 * everything.
 */
export function asDirPrefix(path: string): string {
  const norm = normalizePath(path);
  if (norm === '/') return '/';
  return norm.endsWith('/') ? norm : norm + '/';
}

/**
 * Extract the next path segment of `fullPath` after `prefix`. Returns null
 * if `fullPath` doesn't start with `prefix`. Returns the literal final
 * segment (a "file") if there's no slash after.
 *
 * Example:
 *   prefix = '/slack/'
 *   fullPath = '/slack/#engineering/2026-05-14/thread-1.md'
 *   -> '#engineering'
 */
export function nextSegmentAfter(prefix: string, fullPath: string): string | null {
  if (!fullPath.startsWith(prefix)) return null;
  const rest = fullPath.slice(prefix.length);
  if (rest.length === 0) return null;
  const slashIdx = rest.indexOf('/');
  return slashIdx === -1 ? rest : rest.slice(0, slashIdx);
}
