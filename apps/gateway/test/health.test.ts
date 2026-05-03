import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';

describe('mcp /health', () => {
  it('returns ok', async () => {
    const app = new Hono();
    app.get('/health', (c) => c.json({ status: 'ok', service: 'mcp' }));
    const res = await app.request('/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok', service: 'mcp' });
  });
});
