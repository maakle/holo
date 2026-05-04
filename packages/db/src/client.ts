import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from './schema/index';

export type DB = ReturnType<typeof createDb>;

type PgClient = ReturnType<typeof postgres>;
const globalForDb = globalThis as unknown as { __holoPgPools?: Map<string, PgClient> };
const pools = (globalForDb.__holoPgPools ??= new Map());

export function createDb(databaseUrl: string) {
  let pg = pools.get(databaseUrl);
  if (!pg) {
    pg = postgres(databaseUrl, { max: 10, onnotice: () => {} });
    pools.set(databaseUrl, pg);
  }
  return drizzle(pg, { schema });
}
