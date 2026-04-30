import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { initCrypto } from '@holo/crypto';
import { parseEnv } from '@holo/env';
import { createDb } from '@holo/db';
import { HoloError } from '@holo/errors';
import { createSessionMiddleware } from './middleware/session';

async function main() {
  const env = parseEnv(process.env);
  await initCrypto();
  const db = createDb(env.DATABASE_URL);

  const app = new Hono();

  app.onError((err, c) => {
    if (err instanceof HoloError) {
      const status =
        err.code === 'HOLO_AUTH_NO_SESSION'
          ? 401
          : err.code === 'HOLO_CONNECTOR_NOT_IMPLEMENTED'
            ? 501
            : 500;
      return c.json(err.toJSON(), status);
    }
    console.error(err);
    return c.json(
      { code: 'HOLO_INTERNAL', problem: 'unexpected error', fix: 'check server logs' },
      500,
    );
  });

  app.get('/health', (c) => c.json({ status: 'ok', service: 'mcp' }));

  // Session middleware exists and is testable, but no MCP endpoints in Foundation.
  // Spec #2 will mount the JSON-RPC handler with createSessionMiddleware(db).
  app.get('/_session-check', createSessionMiddleware(db), (c) =>
    c.json({ user: c.get('user' as never) }),
  );

  const port = Number(process.env.MCP_PORT ?? 8091);
  serve({ fetch: app.fetch, port });
  console.log(`apps/mcp listening on :${port}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
