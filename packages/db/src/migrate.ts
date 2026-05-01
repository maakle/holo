import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { config as loadEnv } from 'dotenv';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
loadEnv({ path: path.resolve(__dirname, '../../../.env') });
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
  await migrate(migrationDb, { migrationsFolder: './migrations' });

  const db = drizzle(sql, { schema });
  const org = await seedDefaultOrganization(db);
  console.log(`migrations applied; default org id=${org.id}`);
  await sql.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
