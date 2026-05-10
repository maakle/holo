import path from 'node:path';
import { config as loadEnv } from 'dotenv';
// Load .env from repo root when running locally via `pnpm -F @holo/db migrate`
// (cwd is packages/db). In production the file won't exist; dotenv silently
// returns { error } and the platform-injected env wins. We deliberately avoid
// import.meta.url / __dirname so this file works identically when run via tsx
// (ESM) and when bundled by esbuild as CJS for the Railway pre-deploy step.
loadEnv({ path: path.resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { holoError, ErrorCode } from '@holo/errors';
import * as schema from './schema/index';
import { seedDefaultOrganization } from './seed';

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw holoError({
      code: ErrorCode.HOLO_ENV_INVALID,
      problem: 'DATABASE_URL not set',
      fix: 'Set DATABASE_URL in your .env or shell environment before running migrations.',
    });
  }
  const sql = postgres(url, { max: 1 });
  const migrationDb = drizzle(sql);
  const migrationsFolder =
    process.env.MIGRATIONS_DIR ?? path.resolve(process.cwd(), 'migrations');
  await migrate(migrationDb, { migrationsFolder });

  const db = drizzle(sql, { schema });
  const org = await seedDefaultOrganization(db);
  console.log(`migrations applied; default org id=${org.id}`);
  await sql.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
