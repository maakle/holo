/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  experimental: { typedRoutes: false },
  transpilePackages: [
    '@holo/auth',
    '@holo/chunker',
    '@holo/connectors',
    '@holo/crypto',
    '@holo/db',
    '@holo/env',
    '@holo/errors',
  ],
  webpack: (config) => {
    // Workspace packages use .js extensions in ESM imports (TS convention).
    // Webpack needs to resolve .js → .ts at build time.
    config.resolve.extensionAlias = {
      '.js': ['.ts', '.tsx', '.js', '.jsx'],
      '.mjs': ['.mts', '.mjs'],
    };
    return config;
  },
};
export default nextConfig;
