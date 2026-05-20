/** @type {import('next').NextConfig} */
const POSTHOG_HOST = process.env.NEXT_PUBLIC_POSTHOG_HOST || 'https://eu.i.posthog.com';
const POSTHOG_ASSETS_HOST =
  POSTHOG_HOST.includes('eu.i.posthog.com')
    ? 'https://eu-assets.i.posthog.com'
    : 'https://us-assets.i.posthog.com';

const nextConfig = {
  output: 'standalone',
  typedRoutes: false,
  // PostHog's /decide endpoint rejects 308 redirects from trailing-slash
  // normalization; opt out so the reverse proxy works.
  skipTrailingSlashRedirect: true,
  allowedDevOrigins: [
    'holo-app.maakle.com',
  ],
  // Next.js App Router doesn't serve routes from dot-prefixed directories,
  // so the OAuth metadata file lives under /well-known/* and is exposed at
  // its RFC-mandated /.well-known/* path via this rewrite.
  //
  // /ingest/* proxies PostHog ingestion through Holo's own origin so
  // browser-side analytics survive ad blockers that target *.posthog.com.
  // When PostHog is not configured these routes simply 502 if hit, which
  // never happens because posthog-js isn't initialized.
  async rewrites() {
    return [
      {
        source: '/.well-known/:path*',
        destination: '/well-known/:path*',
      },
      {
        source: '/ingest/static/:path*',
        destination: `${POSTHOG_ASSETS_HOST}/static/:path*`,
      },
      {
        source: '/ingest/:path*',
        destination: `${POSTHOG_HOST}/:path*`,
      },
    ];
  },
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
    'just-bash',
    '@mongodb-js/zstd',
  ],
  transpilePackages: [
    '@holo/auth',
    '@holo/chunker',
    '@holo/connectors',
    '@holo/crypto',
    '@holo/db',
    '@holo/env',
    '@holo/errors',
    '@holo/sync-providers',
  ],
  turbopack: {},
  webpack: (config, { isServer }) => {
    // Workspace packages use .js extensions in ESM imports (TS convention).
    // Webpack needs to resolve .js → .ts at build time.
    config.resolve.extensionAlias = {
      '.js': ['.ts', '.tsx', '.js', '.jsx'],
      '.mjs': ['.mts', '.mjs'],
    };
    if (isServer) {
      const nativeExternals = [
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
        'just-bash',
        '@mongodb-js/zstd',
      ];
      config.externals = [...(config.externals || []), ...nativeExternals];
    }
    return config;
  },
};
export default nextConfig;
