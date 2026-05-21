import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { emailOTP, organization } from 'better-auth/plugins';
import { and, eq } from 'drizzle-orm';
import type { DB, EmbedSampleChunksFn } from '@holo/db';
import { ensureSampleData, schema } from '@holo/db';
import type { Env } from '@holo/env';
import { holoError, ErrorCode } from '@holo/errors';
import { renderInvitationEmail, renderOtpEmail } from './email-templates';

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
    | 'EMAIL_FROM'
  >;
  defaultOrganizationId: string;
  /**
   * Embedder for the sample Star Wars dataset seeded into every new
   * workspace. When set, sample chunks are inserted with embeddings so
   * vector search hits them. When omitted, chunks land with NULL
   * embedding (BM25-only) — fine for tests, broken for product use.
   */
  embedSampleChunks?: EmbedSampleChunksFn;
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
  html?: string;
}

async function sendEmail(
  env: Pick<Env, 'EMAIL_PROVIDER' | 'RESEND_API_KEY' | 'EMAIL_FROM'>,
  tag: string,
  email: ResendEmail,
): Promise<void> {
  if (env.EMAIL_PROVIDER === 'console' || !env.RESEND_API_KEY) {
    console.log(
      `[email:${tag}] to=${email.to} subject=${JSON.stringify(email.subject)}\n${email.text}`,
    );
    return;
  }
  // parseEnv's refine guarantees EMAIL_FROM is set when EMAIL_PROVIDER=resend.
  const from = env.EMAIL_FROM!;
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: email.to,
      subject: email.subject,
      text: email.text,
      ...(email.html ? { html: email.html } : {}),
    }),
  });
  if (!res.ok) {
    throw holoError({
      code: ErrorCode.HOLO_INTERNAL,
      problem: `Resend API rejected ${tag} email (status ${res.status})`,
      cause: await res.text(),
      fix: `Verify RESEND_API_KEY is valid and EMAIL_FROM (${from}) is on a domain verified in Resend.`,
    });
  }
}

async function sendOtpEmail(
  env: Pick<Env, 'EMAIL_PROVIDER' | 'RESEND_API_KEY' | 'EMAIL_FROM'>,
  email: string,
  otp: string,
  type: string,
): Promise<void> {
  const rendered = renderOtpEmail({ otp });
  await sendEmail(env, type, {
    to: email,
    subject: rendered.subject,
    text: rendered.text,
    html: rendered.html,
  });
}

async function sendInvitationEmail(
  env: Pick<Env, 'EMAIL_PROVIDER' | 'RESEND_API_KEY' | 'EMAIL_FROM' | 'BETTER_AUTH_URL'>,
  args: {
    inviteeEmail: string;
    inviterName: string;
    organizationName: string;
    invitationId: string;
  },
): Promise<void> {
  const acceptUrl = `${env.BETTER_AUTH_URL}/accept-invite?id=${encodeURIComponent(args.invitationId)}`;
  const rendered = renderInvitationEmail({
    inviterName: args.inviterName,
    organizationName: args.organizationName,
    acceptUrl,
  });
  await sendEmail(env, 'invitation', {
    to: args.inviteeEmail,
    subject: rendered.subject,
    text: rendered.text,
    html: rendered.html,
  });
}

function slugifyOrgName(s: string): string {
  const cleaned = s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32);
  return cleaned || 'workspace';
}

export type ProvisionResult =
  | { created: true; organizationId: string }
  | { created: false; reason: 'pending_invite' | 'existing_member' };

/**
 * Body of the `user.create.after` Better Auth hook, extracted for testability.
 *
 * Provisions a personal organization owned by the new user and repoints the
 * user's `organization_id` (set by Better Auth's additionalFields default to
 * the demo "default" org) to it. This is the multi-tenant boundary — signups
 * must NOT silently land in the shared default org.
 *
 * No-ops when:
 *   - There's a pending invitation for this email. Better Auth's
 *     `acceptInvitation` handler will create the member row with the invited
 *     role; pre-creating here would race the unique (org, user) constraint.
 *   - The user already has a `member` row (idempotency on hook re-entry).
 */
export async function provisionPersonalOrgOnSignup(
  db: DB,
  newUser: { id: string; email: string; name?: string | null },
  opts: { embedSampleChunks?: EmbedSampleChunksFn } = {},
): Promise<ProvisionResult> {
  const pendingInvite = await db
    .select({ id: schema.invitation.id })
    .from(schema.invitation)
    .where(
      and(
        eq(schema.invitation.email, newUser.email.toLowerCase()),
        eq(schema.invitation.status, 'pending'),
      ),
    )
    .limit(1);
  if (pendingInvite[0]) return { created: false, reason: 'pending_invite' };

  const existing = await db
    .select({ id: schema.member.id })
    .from(schema.member)
    .where(eq(schema.member.userId, newUser.id))
    .limit(1);
  if (existing[0]) return { created: false, reason: 'existing_member' };

  const displayName = (newUser.name ?? '').trim() || newUser.email.split('@')[0]!;
  const orgName = `${displayName}'s workspace`;
  const slug = `${slugifyOrgName(displayName)}-${crypto.randomUUID().slice(0, 6)}`;

  const [newOrg] = await db
    .insert(schema.organization)
    .values({ name: orgName, slug })
    .returning({ id: schema.organization.id });

  await db
    .update(schema.user)
    .set({ organizationId: newOrg!.id })
    .where(eq(schema.user.id, newUser.id));

  await db.insert(schema.member).values({
    organizationId: newOrg!.id,
    userId: newUser.id,
    role: 'owner',
  });

  // Seed Star Wars sample data so the new workspace shows live content on
  // first login. Matches the bootstrap seed and the in-app
  // CreateWorkspaceForm — every workspace should have demo data by default.
  await ensureSampleData(db, newOrg!.id, { embed: opts.embedSampleChunks });

  // Seed the free-tier subscription + initial credit grant so /settings/billing
  // shows live data on first login. No-op when HOLO_BILLING_ENABLED is off.
  // Lazy-imported to keep @holo/auth's static dep graph slim and avoid a
  // cycle if billing ever depends on auth state.
  try {
    const { seedInitialSubscriptionAndGrant } = await import('@holo/billing');
    await seedInitialSubscriptionAndGrant(db, newOrg!.id);
  } catch {
    // Billing seed failures are non-fatal — the user can still sign in and
    // browse the workspace; a missing subscription row just means /settings/billing
    // renders zeros until the next renewal cron tick.
  }

  return { created: true, organizationId: newOrg!.id };
}

export function createAuth({ db, env, defaultOrganizationId, embedSampleChunks }: CreateAuthOpts) {
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
    // Route OAuth callback failures back to /sign-in instead of the default
    // `${baseURL}/error` (which doesn't exist in this app). The sign-in form
    // reads `?error=` and translates known codes to user-facing copy.
    onAPIError: {
      errorURL: '/sign-in',
    },
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
      user: {
        create: {
          // See provisionPersonalOrgOnSignup for behavior + invariants.
          after: async (createdUser) => {
            const u = createdUser as { id: string; email: string; name?: string | null };
            await provisionPersonalOrgOnSignup(db, u, { embedSampleChunks });
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
        // 7 days (default is 48h); covers a normal work week so invites
        // sent on Friday still work the following Friday.
        invitationExpiresIn: 60 * 60 * 24 * 7,
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
