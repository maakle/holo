import 'server-only';
import { createDb, type DB, schema } from '@holo/db';
import { createAuth, type Auth } from '@holo/auth';
import { initCrypto } from '@holo/crypto';
import { parseEnv, type Env } from '@holo/env';
import { sql } from 'drizzle-orm';

let cached: { env: Env; db: DB; auth: Auth; defaultOrgId: string } | null = null;

export async function getServerContext() {
  if (cached) return cached;
  const env = parseEnv(process.env);
  await initCrypto();
  const db = createDb(env.DATABASE_URL);
  const orgs = await db
    .select({ id: schema.organization.id })
    .from(schema.organization)
    .where(sql`slug='default'`);
  if (!orgs[0]) throw new Error('default organization not seeded; run pnpm db:migrate');
  const defaultOrgId = orgs[0].id;
  const auth = createAuth({ db, env, defaultOrganizationId: defaultOrgId });
  cached = { env, db, auth, defaultOrgId };
  return cached;
}

export async function getServerAuth(): Promise<Auth> {
  return (await getServerContext()).auth;
}
