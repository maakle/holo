import { describe, it, expect } from 'vitest';
import { createHttpClient } from '../src/http/client';
import { apiKey } from '../src/auth/api-key';

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });
}

function makeFetchSeq(responses: Response[]): {
  fetch: typeof fetch;
  calls: Array<{ url: string; init: RequestInit }>;
} {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  let i = 0;
  const fn = (async (input: unknown, init: RequestInit) => {
    calls.push({ url: String(input), init });
    const res = responses[i];
    i += 1;
    if (!res) throw new Error(`no canned response for call ${i}`);
    return res;
  }) as unknown as typeof fetch;
  return { fetch: fn, calls };
}

describe('createHttpClient', () => {
  const auth = apiKey({ prefix: 'Token ' });
  const tokens = { accessToken: 'k' };

  it('sends Authorization header and parses JSON 200', async () => {
    const seq = makeFetchSeq([jsonResponse({ ok: true, value: 42 })]);
    const client = createHttpClient({
      config: { baseUrl: 'https://api.example.com' },
      auth,
      tokens,
      fetchImpl: seq.fetch,
      sleep: async () => {},
    });
    const result = await client.get<{ value: number }>('/things');
    expect(result.value).toBe(42);
    expect(seq.calls[0]!.url).toBe('https://api.example.com/things');
    expect((seq.calls[0]!.init.headers as Headers).get('Authorization')).toBe('Token k');
  });

  it('retries on 503 and succeeds on second attempt', async () => {
    const seq = makeFetchSeq([
      jsonResponse({}, { status: 503 }),
      jsonResponse({ value: 1 }),
    ]);
    const client = createHttpClient({
      config: {
        baseUrl: 'https://api.example.com',
        retry: { maxAttempts: 3, initialDelayMs: 1, maxDelayMs: 1 },
      },
      auth,
      tokens,
      fetchImpl: seq.fetch,
      sleep: async () => {},
    });
    const result = await client.get<{ value: number }>('/x');
    expect(result.value).toBe(1);
    expect(seq.calls).toHaveLength(2);
  });

  it('honors Retry-After on 429', async () => {
    const seq = makeFetchSeq([
      jsonResponse({}, { status: 429, headers: { 'Retry-After': '2' } }),
      jsonResponse({ value: 'ok' }),
    ]);
    const sleeps: number[] = [];
    const client = createHttpClient({
      config: {
        baseUrl: 'https://api.example.com',
        retry: { maxAttempts: 3, initialDelayMs: 100, maxDelayMs: 10_000 },
      },
      auth,
      tokens,
      fetchImpl: seq.fetch,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });
    await client.get<{ value: string }>('/x');
    expect(sleeps[0]!).toBeGreaterThanOrEqual(2000);
  });

  it('throws after exhausting retries on retryable status', async () => {
    const seq = makeFetchSeq([
      jsonResponse({}, { status: 503 }),
      jsonResponse({}, { status: 503 }),
      jsonResponse({}, { status: 503 }),
    ]);
    const client = createHttpClient({
      config: {
        baseUrl: 'https://api.example.com',
        retry: { maxAttempts: 3, initialDelayMs: 1, maxDelayMs: 1 },
      },
      auth,
      tokens,
      fetchImpl: seq.fetch,
      sleep: async () => {},
    });
    await expect(client.get('/x')).rejects.toMatchObject({ code: 'HOLO_FETCH_FAILED' });
  });

  it('does not retry on non-retryable 4xx', async () => {
    const seq = makeFetchSeq([jsonResponse({ error: 'nope' }, { status: 404 })]);
    const client = createHttpClient({
      config: { baseUrl: 'https://api.example.com' },
      auth,
      tokens,
      fetchImpl: seq.fetch,
      sleep: async () => {},
    });
    await expect(client.get('/missing')).rejects.toMatchObject({ code: 'HOLO_FETCH_FAILED' });
    expect(seq.calls).toHaveLength(1);
  });

  it('serializes JSON bodies and sets Content-Type', async () => {
    const seq = makeFetchSeq([jsonResponse({ ok: true })]);
    const client = createHttpClient({
      config: { baseUrl: 'https://api.example.com' },
      auth,
      tokens,
      fetchImpl: seq.fetch,
      sleep: async () => {},
    });
    await client.post('/things', { name: 'x' });
    const init = seq.calls[0]!.init;
    expect(init.body).toBe(JSON.stringify({ name: 'x' }));
    expect((init.headers as Headers).get('Content-Type')).toBe('application/json');
  });

  it('appends query params to the URL', async () => {
    const seq = makeFetchSeq([jsonResponse({})]);
    const client = createHttpClient({
      config: { baseUrl: 'https://api.example.com' },
      auth,
      tokens,
      fetchImpl: seq.fetch,
      sleep: async () => {},
    });
    await client.get('/items', { query: { page: 2, limit: 50 } });
    expect(seq.calls[0]!.url).toBe('https://api.example.com/items?page=2&limit=50');
  });

  it('returns undefined on 204', async () => {
    const seq = makeFetchSeq([new Response(null, { status: 204 })]);
    const client = createHttpClient({
      config: { baseUrl: 'https://api.example.com' },
      auth,
      tokens,
      fetchImpl: seq.fetch,
      sleep: async () => {},
    });
    const r = await client.get<undefined>('/x');
    expect(r).toBeUndefined();
  });
});
