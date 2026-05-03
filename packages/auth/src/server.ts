import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { sql } from 'drizzle-orm';
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

// v0.0 Foundation: GitHub OAuth + email/password.
// Magic-link is deferred until email-sending infra (Resend/SendGrid) is wired up — for now
// password is the passwordless-alternative. Email verification is OFF until the same email
// infra lands; pre-alpha users self-host and trust their own DB writes.
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
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: false,
      minPasswordLength: 8,
    },
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
    databaseHooks: {
      user: {
        create: {
          // Every new user gets a member-row for their assigned org. Default role is
          // 'member'; invite-accepting users get their role upgraded by the /invite handler.
          // Idempotent via the (org, user) unique index.
          after: async (created: { id: string; organizationId?: string }) => {
            const orgId = created.organizationId ?? defaultOrganizationId;
            await db.execute(sql`
              INSERT INTO "member" ("organization_id", "user_id", "role")
              VALUES (${orgId}::uuid, ${created.id}::uuid, 'member')
              ON CONFLICT ("organization_id", "user_id") DO NOTHING
            `);
          },
        },
      },
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;
