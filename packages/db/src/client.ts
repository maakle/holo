import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from './schema/index';

export type DB = ReturnType<typeof createDb>;

export function createDb(databaseUrl: string) {
  const pg = postgres(databaseUrl, { max: 10 });
  return drizzle(pg, { schema });
}
