import { Module, Global } from '@nestjs/common';
import { createDb, type DB, schema } from '@holo/db';
import { createAuth, type Auth } from '@holo/auth';
import { sql } from 'drizzle-orm';
import { parseEnv } from '@holo/env';
import { holoError, ErrorCode } from '@holo/errors';

const env = parseEnv(process.env);
const db: DB = createDb(env.DATABASE_URL);

let cachedAuth: Auth | null = null;

async function getAuth(): Promise<Auth> {
  if (cachedAuth) return cachedAuth;
  const orgs = await db
    .select({ id: schema.organization.id })
    .from(schema.organization)
    .where(sql`slug = 'default'`);
  if (!orgs[0]) {
    throw holoError({
      code: ErrorCode.HOLO_ENV_INVALID,
      problem: 'default organization not seeded',
      fix: 'Run `pnpm db:migrate` to migrate the schema and seed the default org.',
    });
  }
  cachedAuth = createAuth({ db, env, defaultOrganizationId: orgs[0].id });
  return cachedAuth;
}

export const DB_TOKEN = Symbol('DB');
export const AUTH_TOKEN = Symbol('Auth');

@Global()
@Module({
  providers: [
    { provide: DB_TOKEN, useValue: db },
    { provide: AUTH_TOKEN, useFactory: () => getAuth() },
  ],
  exports: [DB_TOKEN, AUTH_TOKEN],
})
export class AuthModule {}
