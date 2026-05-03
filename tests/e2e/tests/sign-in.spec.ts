import { test, expect } from '@playwright/test';

test('home page renders the public marketing landing', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/$/);
  // Hero headline (two-line: "The agent context layer / for your company.")
  await expect(
    page.getByRole('heading', { name: /The agent context layer/i }),
  ).toBeVisible();
  // Primary CTA routes to /sign-in for unauthed visitors
  await expect(page.getByRole('link', { name: /Get started/i }).first()).toBeVisible();
  // Footer status indicator
  await expect(page.getByText(/All systems normal/i)).toBeVisible();
});

test('sign-in page exposes both auth methods', async ({ page }) => {
  await page.goto('/sign-in');
  await expect(page.getByRole('heading', { name: /Welcome to holo/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /Continue with GitHub/i })).toBeVisible();
  // Email OTP step 1 input
  await expect(page.getByPlaceholder(/you@company.com/i)).toBeVisible();
});

test('protected initiate route returns HOLO_AUTH_NO_SESSION without a session', async ({
  request,
}) => {
  const res = await request.post('/api/connectors/slack/initiate');
  expect(res.status()).toBe(401);
  const body = (await res.json()) as { code: string; problem: string; fix: string };
  expect(body.code).toBe('HOLO_AUTH_NO_SESSION');
  expect(body.fix).toBeTruthy();
});
