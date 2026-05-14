/**
 * Adapter: HoloFs → just-bash's IFileSystem.
 *
 * just-bash's IFileSystem is broader than what HoloFs needs to support
 * (lstat, symlink, chmod, utimes, ...). We implement what `ls`, `cat`,
 * `grep`, `find`, `head`, `tail`, `wc`, `sort`, `uniq`, `tree`, `echo`
 * actually call — everything else throws ENOSYS/EROFS so just-bash
 * surfaces a clear error to the agent.
 *
 * Keeping the adapter in @holo/agent-tools instead of @holo/holofs means
 * the holofs package never imports `just-bash`. That keeps holofs
 * usable from the dashboard UI without dragging in 19 MB of bash internals.
 */
import type {
  IFileSystem,
  FileContent,
  FsStat,
  BufferEncoding,
  MkdirOptions,
  RmOptions,
  CpOptions,
} from 'just-bash';
import { HoloFs, EROFS, ENOENT, normalizePath } from '@holo/holofs';

type ReadFileOptions = { encoding?: BufferEncoding | null };

// just-bash treats `mode` as a POSIX-style permission integer. The virtual
// filesystem is read-only by everyone, but we still need to report
// something — `0o555` (r-xr-xr-x) for directories, `0o444` (r--r--r--)
// for files.
const DIR_MODE = 0o555;
const FILE_MODE = 0o444;

function notSupported(op: string, path: string): never {
  // just-bash's command handlers translate `.code === 'EROFS'` into the
  // right exit code + stderr; for operations that don't make sense on
  // our virtual FS we still want a clean failure rather than a thrown
  // generic Error.
  throw EROFS(`${op} ${path}`);
}

export function holoFsToIFileSystem(holoFs: HoloFs): IFileSystem {
  return {
    async exists(path: string): Promise<boolean> {
      try {
        await holoFs.stat(path);
        return true;
      } catch (err) {
        if ((err as { code?: string }).code === 'ENOENT') return false;
        throw err;
      }
    },

    async stat(path: string): Promise<FsStat> {
      const s = await holoFs.stat(path);
      const isDir = s.type === 'directory';
      const mtime = s.updatedAt ?? new Date(0);
      // Size on directories is conventionally 0 in POSIX; we don't have a
      // cheap way to know file size without rendering, so we report 0 and
      // let `wc -c` count after `cat`.
      return {
        isFile: !isDir,
        isDirectory: isDir,
        isSymbolicLink: false,
        mode: isDir ? DIR_MODE : FILE_MODE,
        size: 0,
        mtime,
      };
    },

    async lstat(path: string): Promise<FsStat> {
      return this.stat(path);
    },

    async readdir(path: string): Promise<string[]> {
      const entries = await holoFs.readdir(path);
      return entries.map((e) => e.name);
    },

    async readFile(
      path: string,
      _options?: ReadFileOptions | BufferEncoding,
    ): Promise<string> {
      return holoFs.readFile(path);
    },

    async readFileBuffer(path: string): Promise<Uint8Array> {
      const text = await holoFs.readFile(path);
      return new TextEncoder().encode(text);
    },

    async realpath(path: string): Promise<string> {
      // Our FS has no symlinks; realpath = stat-and-return.
      const s = await holoFs.stat(path);
      return s.path;
    },

    async readlink(path: string): Promise<string> {
      throw ENOENT(path);
    },

    // --- writes / mutations — always EROFS ----------------------------------
    async writeFile(path: string, _content: FileContent): Promise<void> {
      notSupported('write', path);
    },
    async mkdir(path: string, _options?: MkdirOptions): Promise<void> {
      notSupported('mkdir', path);
    },
    async rm(path: string, _options?: RmOptions): Promise<void> {
      notSupported('rm', path);
    },
    async cp(_src: string, dest: string, _options?: CpOptions): Promise<void> {
      notSupported('cp', dest);
    },
    async mv(_src: string, dest: string): Promise<void> {
      notSupported('mv', dest);
    },
    async chmod(path: string, _mode: number): Promise<void> {
      notSupported('chmod', path);
    },
    async symlink(_target: string, linkPath: string): Promise<void> {
      notSupported('symlink', linkPath);
    },
    async link(_existing: string, newPath: string): Promise<void> {
      notSupported('link', newPath);
    },
    async utimes(path: string, _atime: Date, _mtime: Date): Promise<void> {
      notSupported('utimes', path);
    },
    async appendFile(path: string, _content: FileContent): Promise<void> {
      notSupported('append', path);
    },
    resolvePath(base: string, path: string): string {
      // Standard POSIX-style resolution. Absolute paths win; relative are
      // joined onto base. Normalization (strip `..`/`.`) happens in the
      // HoloFs layer when the path is actually used.
      if (path.startsWith('/')) return normalizePath(path);
      const joined = base.endsWith('/') ? base + path : base + '/' + path;
      return normalizePath(joined);
    },
    getAllPaths(): string[] {
      // Not feasible against a multi-tenant DB without an unbounded scan,
      // and just-bash doesn't actually need it for the commands we ship.
      // Empty array signals "I don't enumerate."
      return [];
    },
  };
}
