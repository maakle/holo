import { createDb, type DB } from '@holo/db';
import { holoError, ErrorCode } from '@holo/errors';

export interface CliDeps {
  db: DB;
  organizationId: string;
  userId: string;
  redisUrl: string;
}

let cached: CliDeps | undefined;

export function resolveDeps(): CliDeps {
  if (cached) return cached;

  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    throw holoError({
      code: ErrorCode.HOLO_ENV_INVALID,
      problem: 'DATABASE_URL not set',
      fix: 'Set DATABASE_URL in your .env or shell environment.',
    });
  }
  const orgId = process.env.HOLO_ORGANIZATION_ID;
  if (!orgId) {
    throw holoError({
      code: ErrorCode.HOLO_ENV_INVALID,
      problem: 'HOLO_ORGANIZATION_ID not set',
      fix: 'Set HOLO_ORGANIZATION_ID in your .env (the seeded default org id printed by `pnpm db:migrate`).',
    });
  }
  const userId = process.env.HOLO_USER_ID;
  if (!userId) {
    throw holoError({
      code: ErrorCode.HOLO_ENV_INVALID,
      problem: 'HOLO_USER_ID not set',
      fix: 'Set HOLO_USER_ID in your .env (the user id used as createdBy for CLI-issued mutations; in single-tenant v0.2 this is the org owner).',
    });
  }

  // REDIS_URL is only required by commands that enqueue worker jobs; we
  // default it here so commands that don't touch BullMQ keep working without
  // a Redis instance configured.
  const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6382';

  cached = { db: createDb(dbUrl), organizationId: orgId, userId, redisUrl };
  return cached;
}
