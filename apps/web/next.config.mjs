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
  async rewrites() {
    // Keep this fallback in sync with the GATEWAY_INTERNAL_URL default in
    // packages/env/src/index.ts. Next.js loads next.config.mjs outside the
    // @holo/env runtime, so the fallback is duplicated here intentionally.
    const GATEWAY = process.env.GATEWAY_INTERNAL_URL || 'http://localhost:8080';
    return [
      // --- Gateway proxies (single-origin mode) ---
      // The gateway is bound to GATEWAY_INTERNAL_URL (docker network or
      // localhost) and reached publicly via these path prefixes on the web
      // origin. Two-origin operators can ignore this and point clients at
      // a separate hostname; these rewrites do no harm in that case.
      //
      // MCP transport — bidirectional Streamable HTTP. Next.js passes
      // through SSE/chunked responses without buffering.
      { source: '/mcp', destination: `${GATEWAY}/mcp` },
      { source: '/mcp/:path*', destination: `${GATEWAY}/mcp/:path*` },
      // REST API surface (search, skills, accounts, feedback).
      { source: '/v1/:path*', destination: `${GATEWAY}/v1/:path*` },
      // OpenAPI surface (auto-generated spec + Scalar docs page).
      { source: '/openapi.json', destination: `${GATEWAY}/openapi.json` },
      { source: '/docs', destination: `${GATEWAY}/docs` },
      { source: '/docs/:path*', destination: `${GATEWAY}/docs/:path*` },
      // Third-party webhook surfaces — paths are part of the signed payload
      // contract; do not rewrite the path itself.
      { source: '/slack/:path*', destination: `${GATEWAY}/slack/:path*` },
      { source: '/teams-bot/:path*', destination: `${GATEWAY}/teams-bot/:path*` },
      { source: '/google-chat-app/:path*', destination: `${GATEWAY}/google-chat-app/:path*` },
      // RFC 9728 protected-resource metadata is served by the gateway only
      // (no equivalent route in the web app), so it MUST be proxied here.
      // Order matters: this specific rule must precede the well-known catch-all
      // below, which would otherwise route it to the web's local handler.
      //
      // Note: /.well-known/oauth-authorization-server (RFC 8414) is
      // intentionally NOT proxied — the web app has its own canonical handler
      // at apps/web/src/app/well-known/oauth-authorization-server/route.ts
      // that derives the issuer from WEB_PUBLIC_URL. The catch-all rewrite
      // below reaches it correctly.
      {
        source: '/.well-known/oauth-protected-resource',
        destination: `${GATEWAY}/.well-known/oauth-protected-resource`,
      },

      // --- Existing rules ---
      // App Router can't serve dot-prefixed dirs; expose /well-known/* at
      // /.well-known/*. Order matters: specific gateway proxies above win.
      {
        source: '/.well-known/:path*',
        destination: '/well-known/:path*',
      },
      // PostHog reverse-proxy (browser analytics survive ad blockers).
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
