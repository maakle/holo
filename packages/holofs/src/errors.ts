/**
 * POSIX-style error codes. just-bash's IFileSystem expects errors with a
 * `.code` property to translate into the right bash exit codes and stderr
 * messages (ENOENT → "No such file or directory", EROFS → "Read-only file
 * system", etc.). We don't depend on just-bash here — its types are
 * consumed in @holo/agent-tools where the bash tool lives — so we define
 * the error shapes ourselves and just-bash sees them via structural typing.
 */

export class FsError extends Error {
  readonly code: string;
  readonly path: string;
  constructor(code: string, path: string, message: string) {
    super(`${code}: ${message} '${path}'`);
    this.name = 'FsError';
    this.code = code;
    this.path = path;
  }
}

export function ENOENT(path: string): FsError {
  return new FsError('ENOENT', path, 'No such file or directory');
}

export function EROFS(path: string): FsError {
  return new FsError('EROFS', path, 'Read-only file system');
}

export function EISDIR(path: string): FsError {
  return new FsError('EISDIR', path, 'Is a directory');
}

export function ENOTDIR(path: string): FsError {
  return new FsError('ENOTDIR', path, 'Not a directory');
}

export function EINVAL(path: string, msg = 'Invalid path'): FsError {
  return new FsError('EINVAL', path, msg);
}
