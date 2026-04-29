/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: { typedRoutes: false },
  transpilePackages: [
    '@holo/auth',
    '@holo/connectors',
    '@holo/crypto',
    '@holo/db',
    '@holo/env',
    '@holo/errors',
  ],
};
export default nextConfig;
