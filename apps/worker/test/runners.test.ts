import { describe, it, expect, vi } from 'vitest';
import {
  createSlackRunner,
  createNotionRunner,
  createGithubProseRunner,
  createGithubCodeRunner,
  createHubspotRunner,
} from '../src/queues/runners';

// Minimal mocks of the worker's runtime deps. Runners are factories — the
// methods they return only invoke their dependencies when called, so we can
// exercise instantiation without touching a real DB / Redis.

function mockEmbedQueue() {
  return { add: vi.fn().mockResolvedValue(undefined) };
}

function mockDb() {
  // Drizzle-style chainable builder (.select().from().where().limit()) returning empty rows.
  const chain = {
    from: vi.fn(() => chain),
    where: vi.fn(() => chain),
    orderBy: vi.fn(() => chain),
    limit: vi.fn(() => Promise.resolve([])),
  };
  return { select: vi.fn(() => chain) };
}

describe('runner factories', () => {
  it('createSlackRunner exposes full + incremental', () => {
    const runner = createSlackRunner({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      db: mockDb() as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      embedQueue: mockEmbedQueue() as any,
    });
    expect(typeof runner.full).toBe('function');
    expect(typeof runner.incremental).toBe('function');
    expect(runner.codeInitial).toBeUndefined();
  });

  it('createNotionRunner exposes full + incremental', () => {
    const runner = createNotionRunner({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      db: mockDb() as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      embedQueue: mockEmbedQueue() as any,
    });
    expect(typeof runner.full).toBe('function');
    expect(typeof runner.incremental).toBe('function');
  });

  it('createGithubProseRunner exposes full + incremental (no code methods)', () => {
    const runner = createGithubProseRunner({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      db: mockDb() as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      embedQueue: mockEmbedQueue() as any,
    });
    expect(typeof runner.full).toBe('function');
    expect(typeof runner.incremental).toBe('function');
    expect(runner.codeInitial).toBeUndefined();
  });

  it('createGithubCodeRunner exposes codeInitial + codeIncremental (no full/incremental)', () => {
    const runner = createGithubCodeRunner({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      db: mockDb() as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      embedQueue: mockEmbedQueue() as any,
    });
    expect(typeof runner.codeInitial).toBe('function');
    expect(typeof runner.codeIncremental).toBe('function');
    expect(runner.full).toBeUndefined();
    expect(runner.incremental).toBeUndefined();
  });

  it('createHubspotRunner exposes full + incremental', () => {
    const runner = createHubspotRunner({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      db: mockDb() as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      embedQueue: mockEmbedQueue() as any,
    });
    expect(typeof runner.full).toBe('function');
    expect(typeof runner.incremental).toBe('function');
    expect(runner.codeInitial).toBeUndefined();
  });

  it('hubspot runner.full throws HOLO_AUTH_NO_SESSION when no token is found', async () => {
    const runner = createHubspotRunner({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      db: mockDb() as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      embedQueue: mockEmbedQueue() as any,
    });
    await expect(
      runner.full!({ sourceId: 'src-1', organizationId: 'org-1' }),
    ).rejects.toMatchObject({ code: 'HOLO_AUTH_NO_SESSION' });
  });

  it('slack runner.full throws HOLO_AUTH_NO_SESSION when no token is found', async () => {
    const runner = createSlackRunner({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      db: mockDb() as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      embedQueue: mockEmbedQueue() as any,
    });
    await expect(
      runner.full!({ sourceId: 'src-1', organizationId: 'org-1' }),
    ).rejects.toMatchObject({ code: 'HOLO_AUTH_NO_SESSION' });
  });
});
