import { describe, it, expect } from 'vitest';
import nextConfig from '../../../next.config.mjs';

describe('Next.js gateway rewrites', () => {
  it('proxies every gateway path prefix to GATEWAY_INTERNAL_URL', async () => {
    const rules = await nextConfig.rewrites();
    const sources = rules.map((r: { source: string }) => r.source);

    // Every path the Hono gateway publishes must have a corresponding
    // rewrite. If you add a route to apps/gateway/src/main.ts, add the
    // rewrite here and update this assertion.
    const required = [
      '/mcp',
      '/mcp/:path*',
      '/v1/:path*',
      '/openapi.json',
      '/docs',
      '/docs/:path*',
      '/slack/:path*',
      '/teams-bot/:path*',
      '/google-chat-app/:path*',
      '/.well-known/oauth-protected-resource',
    ];
    for (const path of required) {
      expect(sources, `missing rewrite for ${path}`).toContain(path);
    }
  });

  it('places /.well-known/oauth-protected-resource before the well-known catchall', async () => {
    const rules = await nextConfig.rewrites();
    const specificIdx = rules.findIndex(
      (r: { source: string }) => r.source === '/.well-known/oauth-protected-resource',
    );
    const catchallIdx = rules.findIndex(
      (r: { source: string }) => r.source === '/.well-known/:path*',
    );
    expect(specificIdx).toBeGreaterThanOrEqual(0);
    expect(catchallIdx).toBeGreaterThanOrEqual(0);
    expect(specificIdx).toBeLessThan(catchallIdx);
  });
});
