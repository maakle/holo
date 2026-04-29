import 'dotenv/config';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import * as schema from './schema/index.js';
import { seedDefaultOrganization } from './seed.js';

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL not set');
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
