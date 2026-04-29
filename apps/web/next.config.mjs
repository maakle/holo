/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: { typedRoutes: false },
  transpilePackages: [
    '@memex/auth',
    '@memex/connectors',
    '@memex/crypto',
    '@memex/db',
    '@memex/env',
    '@memex/errors',
  ],
};
export default nextConfig;
