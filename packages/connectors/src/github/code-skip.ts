// Decides whether a file in a git repo should be indexed for code search.

const DENY_DIRS = new Set([
  '.git', 'node_modules', 'vendor', '.cache', 'dist', 'build', '__pycache__',
  '.venv', 'venv', '.next', 'coverage', '.nyc_output', 'target', 'out',
  '.gradle', '.m2', 'bower_components', '.terraform',
]);

const DENY_FILENAMES = new Set([
  'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'Gemfile.lock',
  'poetry.lock', 'Cargo.lock', 'go.sum', 'go.work.sum', 'composer.lock',
  'Pipfile.lock', 'mix.lock', 'pubspec.lock', 'packages.lock.json',
  '.DS_Store', 'Thumbs.db',
]);

const ALLOW_CODE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.py', '.rb', '.go', '.rs', '.java', '.kt', '.kts', '.swift',
  '.c', '.cc', '.cpp', '.cxx', '.h', '.hpp', '.cs', '.php',
  '.scala', '.clj', '.cljs', '.ex', '.exs', '.erl', '.hrl',
  '.ml', '.mli', '.hs', '.lhs', '.lua', '.r', '.jl', '.dart',
  '.vue', '.svelte', '.elm', '.purs',
]);

const ALLOW_DOC_EXTENSIONS = new Set(['.md', '.mdx', '.rst', '.txt']);

const ALLOW_CONFIG_EXTENSIONS = new Set([
  '.yaml', '.yml', '.json', '.toml', '.ini', '.tf', '.hcl',
  '.sql', '.sh', '.bash', '.zsh', '.fish', '.ps1',
  '.dockerfile', '.env',
]);

const DENY_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.ico', '.bmp', '.tiff', '.avif',
  '.pdf', '.zip', '.tar', '.gz', '.tgz', '.bz2', '.xz', '.rar', '.7z',
  '.exe', '.dll', '.so', '.dylib', '.wasm', '.bin', '.dat',
  '.db', '.sqlite', '.sqlite3', '.mdb',
  '.mp4', '.mp3', '.avi', '.mov', '.wav', '.ogg', '.flac',
  '.ttf', '.otf', '.woff', '.woff2', '.eot',
  '.min.js', '.min.css',
  '.map', '.lock',
]);

const MAX_FILE_SIZE = 1_000_000; // 1 MB

/**
 * Path-only policy check: deny dirs, deny filenames, deny/allow extensions.
 * Pulled out of `shouldIndex` so callers that already enforce their own size
 * + binary-content limits (e.g. the manual-upload route, which streams the
 * body with a configurable byte cap and a strict UTF-8 decode) can reuse the
 * exact same allow/deny policy without duplicating the lists.
 *
 * Returns `false` when the path is under a denied directory, matches a
 * denied filename, has a denied extension, or has an extension outside the
 * allow-list. Files with no extension pass (Dockerfile/Makefile etc.) so
 * that `extToLanguage`'s filename lookup can still classify them.
 */
export function shouldIndexByPath(filePath: string): boolean {
  const parts = filePath.split('/');
  const filename = parts[parts.length - 1] ?? '';

  for (const part of parts.slice(0, -1)) {
    if (DENY_DIRS.has(part)) return false;
  }

  if (DENY_FILENAMES.has(filename)) return false;

  const dotIdx = filename.lastIndexOf('.');
  const ext = dotIdx > 0 ? filename.slice(dotIdx).toLowerCase() : '';

  if (ext && DENY_EXTENSIONS.has(ext)) return false;

  if (ext) {
    const allowed =
      ALLOW_CODE_EXTENSIONS.has(ext) ||
      ALLOW_DOC_EXTENSIONS.has(ext) ||
      ALLOW_CONFIG_EXTENSIONS.has(ext);
    if (!allowed) return false;
  }

  return true;
}

/** Returns true when the file's extension is in `ALLOW_CODE_EXTENSIONS`. */
export function isCodeExtension(filePath: string): boolean {
  const filename = filePath.split('/').pop() ?? '';
  const dotIdx = filename.lastIndexOf('.');
  const ext = dotIdx > 0 ? filename.slice(dotIdx).toLowerCase() : '';
  return ALLOW_CODE_EXTENSIONS.has(ext);
}

export function shouldIndex(filePath: string, fileSize: number, firstBytes: Uint8Array): boolean {
  if (fileSize > MAX_FILE_SIZE) return false;
  if (!shouldIndexByPath(filePath)) return false;

  // Binary detection: null byte in first 8000 bytes
  const limit = Math.min(firstBytes.length, 8000);
  for (let i = 0; i < limit; i++) {
    if (firstBytes[i] === 0) return false;
  }

  return true;
}

const EXT_TO_LANGUAGE: Record<string, string> = {
  '.ts': 'typescript',
  '.tsx': 'tsx',
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.py': 'python',
  '.rb': 'ruby',
  '.go': 'go',
  '.rs': 'rust',
  '.java': 'java',
  '.kt': 'kotlin',
  '.kts': 'kotlin',
  '.swift': 'swift',
  '.c': 'c',
  '.cc': 'cpp',
  '.cpp': 'cpp',
  '.cxx': 'cpp',
  '.h': 'c',
  '.hpp': 'cpp',
  '.cs': 'csharp',
  '.php': 'php',
  '.scala': 'scala',
  '.ex': 'elixir',
  '.exs': 'elixir',
  '.hs': 'haskell',
  '.lua': 'lua',
  // Web
  '.html': 'html',
  '.htm': 'html',
  '.css': 'css',
  '.scss': 'scss',
  '.sass': 'scss',
  '.less': 'less',
  '.vue': 'vue',
  '.svelte': 'svelte',
  // Data + config
  '.json': 'json',
  '.jsonc': 'json',
  '.yaml': 'yaml',
  '.yml': 'yaml',
  '.toml': 'toml',
  '.xml': 'xml',
  '.svg': 'xml',
  // Shell + scripting
  '.sh': 'bash',
  '.bash': 'bash',
  '.zsh': 'bash',
  '.fish': 'bash',
  '.ps1': 'powershell',
  // SQL + query languages
  '.sql': 'sql',
  '.graphql': 'graphql',
  '.gql': 'graphql',
  // Docs
  '.md': 'markdown',
  '.mdx': 'markdown',
  '.markdown': 'markdown',
  // Infra
  '.tf': 'hcl',
  '.tfvars': 'hcl',
  '.hcl': 'hcl',
  '.nix': 'nix',
  '.proto': 'protobuf',
  // Other languages
  '.dart': 'dart',
  '.r': 'r',
  '.jl': 'julia',
  '.zig': 'zig',
  '.elm': 'elm',
  '.fs': 'fsharp',
  '.fsx': 'fsharp',
  '.ml': 'ocaml',
  '.mli': 'ocaml',
  '.clj': 'clojure',
  '.cljs': 'clojure',
  '.cljc': 'clojure',
  '.erl': 'erlang',
  '.hrl': 'erlang',
  '.groovy': 'groovy',
  '.gradle': 'groovy',
  '.pl': 'perl',
  '.pm': 'perl',
};

// No-extension or compound-name files (matched on lowercase basename).
const FILENAME_TO_LANGUAGE: Record<string, string> = {
  dockerfile: 'dockerfile',
  makefile: 'makefile',
  'cmakelists.txt': 'cmake',
  rakefile: 'ruby',
  gemfile: 'ruby',
};

export function extToLanguage(filePath: string): string {
  const filename = filePath.split('/').pop() ?? '';
  const lowerName = filename.toLowerCase();
  const byName = FILENAME_TO_LANGUAGE[lowerName];
  if (byName !== undefined) return byName;
  const dotIdx = filename.lastIndexOf('.');
  const ext = dotIdx > 0 ? filename.slice(dotIdx).toLowerCase() : '';
  return EXT_TO_LANGUAGE[ext] ?? 'text';
}
