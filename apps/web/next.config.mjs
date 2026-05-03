/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  typedRoutes: false,
  // Native modules (use node-gyp-build / prebuilds) — must NOT be bundled by
  // webpack; load from node_modules at runtime instead.
  serverExternalPackages: [
    'tree-sitter',
    'tree-sitter-typescript',
    'tree-sitter-javascript',
    'tree-sitter-python',
    'tree-sitter-go',
    'tree-sitter-rust',
    'tree-sitter-java',
    'tree-sitter-ruby',
    'tree-sitter-php',
    'tree-sitter-c',
    'tree-sitter-cpp',
  ],
  transpilePackages: [
    '@holo/auth',
    '@holo/chunker',
    '@holo/connectors',
    '@holo/crypto',
    '@holo/db',
    '@holo/env',
    '@holo/errors',
  ],
  webpack: (config, { isServer }) => {
    // Workspace packages use .js extensions in ESM imports (TS convention).
    // Webpack needs to resolve .js → .ts at build time.
    config.resolve.extensionAlias = {
      '.js': ['.ts', '.tsx', '.js', '.jsx'],
      '.mjs': ['.mts', '.mjs'],
    };
    if (isServer) {
      const treeSitterPackages = [
        'tree-sitter',
        'tree-sitter-typescript',
        'tree-sitter-javascript',
        'tree-sitter-python',
        'tree-sitter-go',
        'tree-sitter-rust',
        'tree-sitter-java',
        'tree-sitter-ruby',
        'tree-sitter-php',
        'tree-sitter-c',
        'tree-sitter-cpp',
      ];
      config.externals = [...(config.externals || []), ...treeSitterPackages];
    }
    return config;
  },
};
export default nextConfig;
