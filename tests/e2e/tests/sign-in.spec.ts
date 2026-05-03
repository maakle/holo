import { test, expect } from '@playwright/test';

test('unauthenticated home page redirects to /sign-in', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/sign-in$/);
  await expect(page.getByRole('heading', { name: /Welcome to holo/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /Continue with GitHub/i })).toBeVisible();
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
