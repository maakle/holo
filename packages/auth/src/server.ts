import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { emailOTP } from 'better-auth/plugins';
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
    | 'EMAIL_PROVIDER'
    | 'RESEND_API_KEY'
  >;
  defaultOrganizationId: string;
}

async function sendOtpEmail(
  env: Pick<Env, 'EMAIL_PROVIDER' | 'RESEND_API_KEY' | 'BETTER_AUTH_URL'>,
  email: string,
  otp: string,
  type: string,
): Promise<void> {
  if (env.EMAIL_PROVIDER === 'console' || !env.RESEND_API_KEY) {
    // eslint-disable-next-line no-console
    console.log(`[email:${type}] to=${email} otp=${otp}`);
    return;
  }
  const fromHost = new URL(env.BETTER_AUTH_URL).host;
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: `Holo <noreply@${fromHost}>`,
      to: email,
      subject: `Your sign-in code: ${otp}`,
      text: `Your verification code is ${otp}. It expires in 5 minutes.`,
    }),
  });
  if (!res.ok) {
    throw new Error(`Resend API ${res.status}: ${await res.text()}`);
  }
}

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
      database: {
        generateId: () => crypto.randomUUID(),
      },
    },
    emailAndPassword: { enabled: false },
    socialProviders: {
      github: {
        clientId: env.GITHUB_LOGIN_CLIENT_ID,
        clientSecret: env.GITHUB_LOGIN_CLIENT_SECRET,
        scope: ['read:user', 'user:email'],
      },
    },
    plugins: [
      emailOTP({
        async sendVerificationOTP({ email, otp, type }) {
          await sendOtpEmail(env, email, otp, type);
        },
      }),
    ],
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
