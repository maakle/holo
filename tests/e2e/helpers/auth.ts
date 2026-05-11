import type { APIRequestContext, BrowserContext } from '@playwright/test';
import postgres from 'postgres';

const DATABASE_URL = process.env.DATABASE_URL ?? 'postgresql://holo:holo@localhost:5432/holo';
const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:3000';

export interface SignedInUser {
  email: string;
  userId: string;
  /** The organization this session is active in (the new user's personal org). */
  organizationId: string;
  /** Raw value of the `better-auth.session_token` cookie. Includes the HMAC
   * signature segment after the dot — the form Better Auth's getSession()
   * verifies. */
  sessionTokenCookie: string;
}

/**
 * Sign a fresh test user in via Better Auth's emailOTP endpoint and attach the
 * resulting signed session cookie to the given Playwright browser context.
 *
 * Why this exists: Better Auth verifies session cookies via HMAC against
 * `BETTER_AUTH_SECRET`. Seeding a row directly in the `session` table
 * produces an unsigned token that `auth.api.getSession()` rejects, so the
 * `(app)` layout redirects to `/sign-in`. The fix is to drive a real sign-in
 * through the running Next.js auth handler so the response sets a properly
 * signed cookie.
 *
 * Flow:
 *   1. POST `/api/auth/email-otp/send-verification-otp` (type: 'sign-in')
 *      to mint an OTP. With `EMAIL_PROVIDER=console` (the e2e default) the
 *      OTP is just logged to stdout, but it's also persisted to the
 *      `verification` table because Better Auth always stores it server-side.
 *   2. Read the OTP back from `verification` where
 *      identifier = `sign-in-otp-${email}`. Default `storeOTP` is `plain`,
 *      so the row value is `${otp}:${attemptsUsed}`.
 *   3. POST `/api/auth/sign-in/email-otp` with `{email, otp}` to complete
 *      sign-in. The response's `Set-Cookie: better-auth.session_token=...`
 *      is the signed cookie we need. Better Auth also auto-creates the user
 *      if missing, which triggers `provisionPersonalOrgOnSignup` and seeds
 *      a personal org + sample data.
 *
 * The cookie is attached to the Playwright `BrowserContext`, so subsequent
 * `page.goto('/connections')` calls within that context are authed.
 */
export async function signInAsTestUser(
  context: BrowserContext,
  request: APIRequestContext,
  opts: { email?: string } = {},
): Promise<SignedInUser> {
  const email = (
    opts.email ?? `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`
  ).toLowerCase();

  // Step 1: request OTP. This both stores the OTP server-side AND will
  // create-on-sign-in if the user is new (auto-signup is allowed because
  // `disableSignUp` is not set on the emailOTP plugin in server.ts).
  const sendRes = await request.post(`${BASE_URL}/api/auth/email-otp/send-verification-otp`, {
    data: { email, type: 'sign-in' },
  });
  if (!sendRes.ok()) {
    const body = await sendRes.text();
    throw new Error(`send-verification-otp failed: ${sendRes.status()} ${body}`);
  }

  // Step 2: read the OTP back from the verification table.
  const otp = await readLatestOtp(email);

  // Step 3: complete sign-in. Set-Cookie on the response carries the signed
  // session token; Playwright's APIRequestContext applies it to the
  // BrowserContext's cookie jar automatically.
  const signInRes = await request.post(`${BASE_URL}/api/auth/sign-in/email-otp`, {
    data: { email, otp },
  });
  if (!signInRes.ok()) {
    const body = await signInRes.text();
    throw new Error(`sign-in/email-otp failed: ${signInRes.status()} ${body}`);
  }
  const signInBody = (await signInRes.json()) as { token: string; user: { id: string } };

  // Confirm the cookie made it into the context's jar and find its signed
  // value (the part that getSession() will verify).
  const cookies = await context.cookies(BASE_URL);
  const cookie = cookies.find((c) => c.name === 'better-auth.session_token');
  if (!cookie) {
    throw new Error(
      `sign-in succeeded but no better-auth.session_token cookie was set on the context. ` +
        `Got cookies: ${cookies.map((c) => c.name).join(', ')}`,
    );
  }

  // Warm up the session so the `(app)/layout.tsx` reconciliation runs once.
  //
  // Why: Better Auth's `user.create.after` hook (where
  // `provisionPersonalOrgOnSignup` repoints the user from the seeded default
  // org to a fresh personal org) is queued for after the transaction. The
  // `session.create.before` hook fires *during* the same transaction and
  // therefore reads the user's pre-provision `organization_id` — which is
  // still the default org. The session's `activeOrganizationId` is set to
  // that default, the user is not a member of default, so the `(app)`
  // layout's first request reconciles by updating the session to the
  // user's actual personal org and redirecting to `/dashboard`.
  //
  // Letting tests pay that redirect cost on their own first navigation
  // makes assertions like `toHaveURL(/\/connections$/)` flaky. We absorb
  // it here so the helper's return contract is "browser is signed in and
  // pointed at a valid active org."
  const warmupRes = await request.get(`${BASE_URL}/dashboard`);
  if (!warmupRes.ok() && warmupRes.status() !== 200) {
    // Don't fail hard — the redirect itself is the expected behavior for
    // new users; a non-OK status here would still be diagnostic.
    const body = await warmupRes.text();
    throw new Error(
      `session warmup GET /dashboard failed: ${warmupRes.status()} ${body.slice(0, 200)}`,
    );
  }

  // Lookup the user's personal organizationId (set by the create.after hook).
  const organizationId = await lookupOrganizationIdForUser(signInBody.user.id);

  return {
    email,
    userId: signInBody.user.id,
    organizationId,
    sessionTokenCookie: cookie.value,
  };
}

async function readLatestOtp(email: string): Promise<string> {
  const sql = postgres(DATABASE_URL, { max: 1 });
  try {
    const rows = await sql<{ value: string }[]>`
      SELECT value FROM verification
      WHERE identifier = ${`sign-in-otp-${email}`}
      ORDER BY created_at DESC
      LIMIT 1
    `;
    if (!rows[0]) {
      throw new Error(`no verification row for sign-in OTP (identifier=sign-in-otp-${email})`);
    }
    // Stored as `${otp}:${attempts}` (see better-auth email-otp/routes.mjs
    // createVerificationOTP — default `storeOTP: 'plain'`).
    const value = rows[0].value;
    const idx = value.lastIndexOf(':');
    return idx === -1 ? value : value.slice(0, idx);
  } finally {
    await sql.end();
  }
}

async function lookupOrganizationIdForUser(userId: string): Promise<string> {
  const sql = postgres(DATABASE_URL, { max: 1 });
  try {
    const rows = await sql<{ organization_id: string }[]>`
      SELECT organization_id FROM "user" WHERE id = ${userId}
    `;
    if (!rows[0]) throw new Error(`user ${userId} not found after sign-in`);
    return rows[0].organization_id;
  } finally {
    await sql.end();
  }
}
