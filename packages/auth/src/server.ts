import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import type { DB } from '@holo/db';
import { schema } from '@holo/db';
import type { Env } from '@holo/env';

export interface CreateAuthOpts {
  db: DB;
  env: Pick<
    Env,
    | 'BETTER_AUTH_SECRET'
    | 'BETTER_AUTH_URL'
    | 'GITHUB_LOGIN_CLIENT_ID'
    | 'GITHUB_LOGIN_CLIENT_SECRET'
  >;
  defaultOrganizationId: string;
}

// v0.0 Foundation: GitHub OAuth login only (per spec's "if running long, cut email OTP" guidance).
// Email OTP plugin is deferred — fights better-auth's bundled Zod types in this version pin.
// Add back when migrating to a Zod-compatible better-auth version, or by writing a thin
// passwordless-via-magic-link route handler in apps/web that doesn't go through the plugin.
export function createAuth({ db, env, defaultOrganizationId }: CreateAuthOpts) {
  return betterAuth({
    database: drizzleAdapter(db, {
      provider: 'pg',
      schema: {
        user: schema.user,
        session: schema.session,
        account: schema.account,
        verification: schema.verification,
      },
    }),
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    logger: { level: 'debug' },
    advanced: {
      generateId: () => crypto.randomUUID(),
    },
    emailAndPassword: { enabled: false },
    socialProviders: {
      github: {
        clientId: env.GITHUB_LOGIN_CLIENT_ID,
        clientSecret: env.GITHUB_LOGIN_CLIENT_SECRET,
        scopes: ['read:user', 'user:email'],
      },
    },
    user: {
      additionalFields: {
        organizationId: {
          type: 'string',
          required: true,
          defaultValue: defaultOrganizationId,
          input: false,
        },
      },
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;
