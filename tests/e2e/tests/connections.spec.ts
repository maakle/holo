import { test, expect } from '@playwright/test';
import postgres from 'postgres';

const DATABASE_URL = process.env.DATABASE_URL ?? 'postgresql://holo:holo@localhost:5432/holo';

/**
 * Seeds a Better Auth session row directly so we don't have to drive the
 * GitHub OAuth login flow itself in CI. Returns the session token for use
 * as a cookie value.
 */
async function seedSession(): Promise<{ token: string; userId: string; orgId: string }> {
  const sql = postgres(DATABASE_URL, { max: 1 });
  try {
    const orgRows = await sql<{ id: string }[]>`SELECT id FROM organization WHERE slug='default'`;
    if (!orgRows[0]) throw new Error('default organization not seeded');
    const orgId = orgRows[0].id;

    const email = `e2e-${Date.now()}@example.com`;
    const userRows = await sql<{ id: string }[]>`
      INSERT INTO "user" (email, organization_id, email_verified)
      VALUES (${email}, ${orgId}, true)
      RETURNING id
    `;
    const userId = userRows[0]!.id;

    const token = `e2e-token-${Date.now()}`;
    await sql`
      INSERT INTO "session" (user_id, token, expires_at)
      VALUES (${userId}, ${token}, now() + interval '1 hour')
    `;
    return { token, userId, orgId };
  } finally {
    await sql.end();
  }
}

test('GitHub Connect: with mocked GitHub, row flips to "Connected ✓"', async ({
  page,
  context,
}) => {
  const { token } = await seedSession();
  await context.addCookies([
    {
      name: 'better-auth.session_token',
      value: token,
      url: 'http://localhost:3030',
    },
  ]);

  // Mock the upstream GitHub endpoints. Note: the OAuth code-exchange call
  // happens server-side from the Next.js callback handler, so we route
  // outbound requests on the page's context. Playwright 1.48+ intercepts
  // server-initiated fetches via context-level routing.
  await context.route('**://github.com/login/oauth/access_token', async (route) =>
    route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        access_token: 'gho_e2e_test',
        scope: 'repo,read:org',
        token_type: 'bearer',
      }),
    }),
  );
  await context.route('**://api.github.com/user', async (route) =>
    route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 999, login: 'e2e-octocat' }),
    }),
  );
  await context.route('**://github.com/login/oauth/authorize**', async (route) => {
    const url = new URL(route.request().url());
    const state = url.searchParams.get('state');
    const redirectUri = url.searchParams.get('redirect_uri');
    if (!state || !redirectUri) return route.abort();
    return route.fulfill({
      status: 302,
      headers: { location: `${redirectUri}?code=test_code&state=${encodeURIComponent(state)}` },
    });
  });

  await page.goto('/connections');
  await expect(page.getByText('GitHub')).toBeVisible();
  // Click the GitHub row's Connect button (first Connect button in the list)
  await page.getByRole('button', { name: 'Connect' }).first().click();

  // After full roundtrip, the row label should reflect the GitHub login.
  await expect(page.getByText(/Connected ✓ \(e2e-octocat\)/)).toBeVisible({ timeout: 15_000 });
});
