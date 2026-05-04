import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { emailOTP, organization } from 'better-auth/plugins';
import { eq } from 'drizzle-orm';
import type { DB } from '@holo/db';
import { schema } from '@holo/db';
import type { Env } from '@holo/env';
import { holoError, ErrorCode } from '@holo/errors';

export interface CreateAuthOpts {
  db: DB;
  env: Pick<
    Env,
    | 'BETTER_AUTH_SECRET'
    | 'BETTER_AUTH_URL'
    | 'AUTH_TRUSTED_ORIGINS'
    | 'GITHUB_LOGIN_CLIENT_ID'
    | 'GITHUB_LOGIN_CLIENT_SECRET'
    | 'EMAIL_PROVIDER'
    | 'RESEND_API_KEY'
  >;
  defaultOrganizationId: string;
}

/**
 * Parse the comma-separated AUTH_TRUSTED_ORIGINS env var. Empty / missing
 * returns []. Whitespace and trailing slashes are normalized so duplicates
 * with cosmetic differences are deduped.
 */
export function parseTrustedOrigins(raw: string | undefined): string[] {
  if (!raw) return [];
  const set = new Set<string>();
  for (const part of raw.split(',')) {
    const trimmed = part.trim().replace(/\/+$/, '');
    if (trimmed) set.add(trimmed);
  }
  return [...set];
}

interface ResendEmail {
  to: string;
  subject: string;
  text: string;
}

async function sendEmail(
  env: Pick<Env, 'EMAIL_PROVIDER' | 'RESEND_API_KEY' | 'BETTER_AUTH_URL'>,
  tag: string,
  email: ResendEmail,
): Promise<void> {
  if (env.EMAIL_PROVIDER === 'console' || !env.RESEND_API_KEY) {
    console.log(
      `[email:${tag}] to=${email.to} subject=${JSON.stringify(email.subject)}\n${email.text}`,
    );
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
      to: email.to,
      subject: email.subject,
      text: email.text,
    }),
  });
  if (!res.ok) {
    throw holoError({
      code: ErrorCode.HOLO_INTERNAL,
      problem: `Resend API rejected ${tag} email (status ${res.status})`,
      cause: await res.text(),
      fix: 'Verify RESEND_API_KEY is valid and the from-domain is verified in Resend.',
    });
  }
}

async function sendOtpEmail(
  env: Pick<Env, 'EMAIL_PROVIDER' | 'RESEND_API_KEY' | 'BETTER_AUTH_URL'>,
  email: string,
  otp: string,
  type: string,
): Promise<void> {
  await sendEmail(env, type, {
    to: email,
    subject: `Your sign-in code: ${otp}`,
    text: `Your verification code is ${otp}. It expires in 5 minutes.`,
  });
}

async function sendInvitationEmail(
  env: Pick<Env, 'EMAIL_PROVIDER' | 'RESEND_API_KEY' | 'BETTER_AUTH_URL'>,
  args: {
    inviteeEmail: string;
    inviterName: string;
    organizationName: string;
    invitationId: string;
  },
): Promise<void> {
  const acceptUrl = `${env.BETTER_AUTH_URL}/accept-invite?id=${encodeURIComponent(args.invitationId)}`;
  await sendEmail(env, 'invitation', {
    to: args.inviteeEmail,
    subject: `${args.inviterName} invited you to ${args.organizationName} on Holo`,
    text:
      `${args.inviterName} invited you to join the "${args.organizationName}" workspace on Holo.\n\n` +
      `Accept the invite:\n${acceptUrl}\n\n` +
      `If you didn't expect this, you can safely ignore this email.`,
  });
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
        organization: schema.organization,
        member: schema.member,
        invitation: schema.invitation,
      },
    }),
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    // Allow sign-in / CSRF cookies on additional origins — typically used
    // in dev when accessing the app over both localhost and an ngrok tunnel.
    // BETTER_AUTH_URL is implicitly trusted; we de-dupe defensively.
    trustedOrigins: [
      ...new Set([
        env.BETTER_AUTH_URL.replace(/\/+$/, ''),
        ...parseTrustedOrigins(env.AUTH_TRUSTED_ORIGINS),
      ]),
    ],
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
    databaseHooks: {
      // Auto-enroll new users in their home org. The `user.organizationId`
      // additionalField defaults the home org at insert; here we mirror that
      // into the `member` table so the org plugin sees them as a member.
      user: {
        create: {
          after: async (createdUser) => {
            const orgId =
              (createdUser as unknown as { organizationId?: string }).organizationId ??
              defaultOrganizationId;
            const existing = await db
              .select({ id: schema.member.id })
              .from(schema.member)
              .where(eq(schema.member.userId, createdUser.id))
              .limit(1);
            if (existing[0]) return;
            await db.insert(schema.member).values({
              organizationId: orgId,
              userId: createdUser.id,
              role: 'owner',
            });
          },
        },
      },
      // When a session is created, default `activeOrganizationId` to the
      // user's home org if not already set. Better Auth's
      // `organizationCreation` flow may override this later.
      session: {
        create: {
          before: async (newSession) => {
            const s = newSession as { userId: string; activeOrganizationId?: string | null };
            if (s.activeOrganizationId) return;
            const rows = await db
              .select({ organizationId: schema.user.organizationId })
              .from(schema.user)
              .where(eq(schema.user.id, s.userId))
              .limit(1);
            const homeOrg = rows[0]?.organizationId;
            if (!homeOrg) return;
            return { data: { ...newSession, activeOrganizationId: homeOrg } };
          },
        },
      },
    },
    plugins: [
      emailOTP({
        async sendVerificationOTP({ email, otp, type }) {
          await sendOtpEmail(env, email, otp, type);
        },
      }),
      organization({
        // A user can belong to many orgs but defaults to a single home org
        // until they create or are invited to additional ones.
        allowUserToCreateOrganization: true,
        async sendInvitationEmail(data) {
          await sendInvitationEmail(env, {
            inviteeEmail: data.email,
            inviterName: data.inviter.user.name ?? data.inviter.user.email,
            organizationName: data.organization.name,
            invitationId: data.id,
          });
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
