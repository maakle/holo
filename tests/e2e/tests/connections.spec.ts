import { test, expect } from '@playwright/test';
import { signInAsTestUser } from '../helpers/auth';

/**
 * Connections-page E2E. Previously test.skip because the helper seeded a
 * Better Auth session row directly and the resulting token failed HMAC
 * verification, so the `(app)` layout redirected to `/sign-in`.
 *
 * The fix: `signInAsTestUser` drives a real sign-in through the running
 * Next.js auth handler, which sets a properly signed `better-auth.session_token`
 * cookie on the browser context. See tests/e2e/helpers/auth.ts.
 *
 * What this test asserts now:
 *   1. An authed user can load `/connections` (auth gate passes).
 *   2. The GitHub row renders in the catalog.
 *   3. The GitHub Connect button is interactive and routes to the wizard.
 *
 * Why we don't drive the full GitHub roundtrip: the v0.0 GitHub integration
 * uses a GitHub App *installation* (org-scoped install + webhook flow),
 * not a per-user OAuth2 redirect. Mocking the install flow end-to-end is
 * out of scope for this PR — that's a separate item once the GitHub App
 * install machinery is testable in isolation.
 */
test('Connections page loads for an authenticated user and shows the GitHub row', async ({
  page,
  context,
}) => {
  // Use the BrowserContext's own request fixture so Set-Cookie headers from
  // the auth handler get applied to the same cookie jar the page will use.
  await signInAsTestUser(context, context.request);

  await page.goto('/connections');

  // Auth gate passed (no redirect to /sign-in).
  await expect(page).toHaveURL(/\/connections$/);

  // Catalog rendered — headline and the GitHub tile are both visible.
  await expect(page.getByRole('heading', { name: /Connect your tools/i })).toBeVisible();
  await expect(page.getByText('GitHub', { exact: true }).first()).toBeVisible();

  // The Connect button on the GitHub row is enabled. We don't click through
  // the full GitHub App install flow here — that's a separate spec.
  const githubConnect = page.getByRole('button', { name: /^Connect$/ }).first();
  await expect(githubConnect).toBeVisible();
  await expect(githubConnect).toBeEnabled();
});
