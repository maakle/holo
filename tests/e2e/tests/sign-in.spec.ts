import { test, expect } from '@playwright/test';

test('home page renders the public marketing landing', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/$/);
  await expect(
    page.getByRole('heading', { name: /Shared context for the agents/i }),
  ).toBeVisible();
  await expect(page.getByRole('link', { name: /Get started/i }).first()).toBeVisible();
});

test('sign-in page exposes GitHub and email options', async ({ page }) => {
  await page.goto('/sign-in');
  await expect(page.getByText(/Sign in to your workspace/i)).toBeVisible();
  await expect(page.getByRole('button', { name: /Continue with GitHub/i })).toBeVisible();
  await expect(page.getByPlaceholder(/you@company.com/i)).toBeVisible();
  await expect(page.getByPlaceholder(/Password/i)).toBeVisible();
  await expect(page.getByRole('button', { name: /^Sign in$/i })).toBeVisible();
});

test('sign-in page can toggle to create-account mode', async ({ page }) => {
  await page.goto('/sign-in');
  await page.getByRole('button', { name: /Create one/i }).click();
  await expect(page.getByRole('button', { name: /Create account/i })).toBeVisible();
  await expect(page.getByPlaceholder(/Name/i)).toBeVisible();
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
