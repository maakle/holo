# Next.js 16 Best-Practices Hardening — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the five concrete gaps identified in the 2026 Next.js 16 audit of `apps/web` — streaming, validation, tests, Tailwind v4, and a Node-runtime `proxy.ts` for auth gating.

**Architecture:** Five **independent phases**, each one a self-contained PR. Order is recommended (smallest UX win first → largest risk last), but any phase can ship without the others. No phase changes the existing server-first / Server-Actions architecture; they only fill in what's missing.

**Tech Stack:** Next.js 16.2.4, React 19.2.5, TypeScript 5.6.3 (strict), Tailwind 3.4 → 4, Zod 4.4, Vitest 2.1, Playwright (new), better-auth 1.6.9, Drizzle, pnpm workspaces.

> **Scope note:** These five phases are independent subsystems. If you want a tighter blast radius per PR, execute one phase at a time and merge between phases. The plan is structured so you can.

---

## Phase 1 — Suspense + `loading.tsx` for `(app)/dashboard`

**Why:** Today, [dashboard/page.tsx](../../../apps/web/src/app/(app)/dashboard/page.tsx) blocks on `Promise.all` of four DB queries before sending any HTML. Stream the shell immediately and let the heavy sections resolve independently.

**Files:**
- Create: `apps/web/src/app/(app)/dashboard/loading.tsx`
- Create: `apps/web/src/app/(app)/dashboard/_components/stats-section.tsx`
- Create: `apps/web/src/app/(app)/dashboard/_components/recent-invocations.tsx`
- Modify: `apps/web/src/app/(app)/dashboard/page.tsx` (replace inline data fetching with `<Suspense>` boundaries)

### Task 1.1: Add a route-level `loading.tsx`

- [ ] **Step 1: Create the file**

`apps/web/src/app/(app)/dashboard/loading.tsx`:
```tsx
export default function DashboardLoading() {
  return (
    <div className="space-y-10" aria-busy="true" aria-live="polite">
      <header className="flex flex-col gap-2">
        <span className="caption">Overview</span>
        <div className="h-9 w-64 animate-pulse rounded-md bg-surface-2" />
        <div className="h-5 w-full max-w-2xl animate-pulse rounded-md bg-surface-2" />
      </header>
      <section className="grid grid-cols-1 gap-3 md:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-28 rounded-md border border-border bg-surface" />
        ))}
      </section>
      <section className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="h-72 rounded-md border border-border bg-surface lg:col-span-2" />
        <div className="h-72 rounded-md border border-border bg-surface" />
      </section>
    </div>
  );
}
```

- [ ] **Step 2: Verify**

Run: `pnpm --filter @holo/web dev`, navigate to `/dashboard` while throttling network in DevTools to "Slow 3G". Expected: skeleton renders before data.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/\(app\)/dashboard/loading.tsx
git commit -m "feat(web): add dashboard loading skeleton for streamed shell"
```

### Task 1.2: Extract `StatsSection` as an async server component

- [ ] **Step 1: Create the component**

`apps/web/src/app/(app)/dashboard/_components/stats-section.tsx`:
```tsx
import Link from 'next/link';
import { count, eq } from 'drizzle-orm';
import { schema } from '@holo/db';
import { ArrowUpRight, Plug, Activity, Sparkles } from 'lucide-react';
import { getServerContext } from '@/lib/server-context';

export async function StatsSection({ orgId }: { orgId: string }) {
  const { db } = await getServerContext();
  const [connectedRows, skillRows, invocationRows] = await Promise.all([
    db.select({ value: count() }).from(schema.connectorCredentials).where(eq(schema.connectorCredentials.organizationId, orgId)),
    db.select({ value: count() }).from(schema.skills).where(eq(schema.skills.organizationId, orgId)),
    db.select({ value: count() }).from(schema.mcpInvocations).where(eq(schema.mcpInvocations.organizationId, orgId)),
  ]);

  const stats = [
    { label: 'Connections', value: connectedRows[0]?.value ?? 0, icon: Plug, href: '/connections' },
    { label: 'Skills', value: skillRows[0]?.value ?? 0, icon: Sparkles, href: '/skills' },
    { label: 'Invocations · 7d', value: invocationRows[0]?.value ?? 0, icon: Activity, href: '/observability' },
  ] as const;

  return (
    <section className="grid grid-cols-1 gap-3 md:grid-cols-3">
      {stats.map(({ label, value, icon: Icon, href }) => (
        <Link
          key={label}
          href={href}
          className="group rounded-md border border-border bg-surface p-5 transition-colors duration-micro hover:border-border-strong"
        >
          <div className="flex items-center justify-between">
            <span className="caption">{label}</span>
            <Icon className="h-4 w-4 text-text-subtle" />
          </div>
          <div className="mt-3 flex items-end justify-between gap-3">
            <span className="font-display text-display-2 font-semibold tabular-nums leading-none">
              {value}
            </span>
            <ArrowUpRight className="h-4 w-4 text-text-subtle opacity-0 transition-opacity duration-micro group-hover:opacity-100" />
          </div>
        </Link>
      ))}
    </section>
  );
}

export function StatsSkeleton() {
  return (
    <section className="grid grid-cols-1 gap-3 md:grid-cols-3">
      {[0, 1, 2].map((i) => (
        <div key={i} className="h-28 rounded-md border border-border bg-surface" />
      ))}
    </section>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/app/\(app\)/dashboard/_components/stats-section.tsx
git commit -m "feat(web): extract StatsSection as async server component"
```

### Task 1.3: Extract `RecentInvocations` as an async server component

- [ ] **Step 1: Create the component**

`apps/web/src/app/(app)/dashboard/_components/recent-invocations.tsx`:
```tsx
import Link from 'next/link';
import { desc, eq } from 'drizzle-orm';
import { schema } from '@holo/db';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { getServerContext } from '@/lib/server-context';

export async function RecentInvocations({ orgId }: { orgId: string }) {
  const { db } = await getServerContext();
  const rows = await db
    .select({
      id: schema.mcpInvocations.id,
      toolName: schema.mcpInvocations.toolName,
      latencyMs: schema.mcpInvocations.latencyMs,
      errorCode: schema.mcpInvocations.errorCode,
      createdAt: schema.mcpInvocations.createdAt,
    })
    .from(schema.mcpInvocations)
    .where(eq(schema.mcpInvocations.organizationId, orgId))
    .orderBy(desc(schema.mcpInvocations.createdAt))
    .limit(5);

  return (
    <Card className="lg:col-span-2">
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <div className="flex flex-col gap-1">
          <CardTitle>Recent invocations</CardTitle>
          <CardDescription>Last 5 MCP tool calls from your agents.</CardDescription>
        </div>
        <Button variant="ghost" size="sm" asChild>
          <Link href="/observability">View all →</Link>
        </Button>
      </CardHeader>
      <CardContent className="px-0">
        {rows.length === 0 ? (
          <div className="px-5 py-10 text-center">
            <p className="text-[13px] text-text-muted">
              No invocations yet. Connect an agent to see live activity.
            </p>
            <Button variant="primary" size="sm" className="mt-4" asChild>
              <Link href="/connect-agent">Connect agent</Link>
            </Button>
          </div>
        ) : (
          <ul className="divide-y divide-border border-t border-border">
            {rows.map((inv) => (
              <li
                key={inv.id}
                className="flex items-center justify-between gap-4 px-5 py-3 text-[13px] hover:bg-surface-2"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <Badge variant={inv.errorCode ? 'error' : 'success'}>
                    {inv.errorCode ? 'error' : 'ok'}
                  </Badge>
                  <span className="font-mono truncate text-text">{inv.toolName}</span>
                </div>
                <div className="flex shrink-0 items-center gap-4 text-text-muted">
                  <span className="font-mono tabular-nums">{inv.latencyMs}ms</span>
                  <time className="font-mono text-text-subtle">
                    {inv.createdAt.toISOString().slice(11, 19)}
                  </time>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

export function RecentInvocationsSkeleton() {
  return <div className="h-72 rounded-md border border-border bg-surface lg:col-span-2" />;
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/app/\(app\)/dashboard/_components/recent-invocations.tsx
git commit -m "feat(web): extract RecentInvocations as async server component"
```

### Task 1.4: Wrap children in `<Suspense>` in `page.tsx`

- [ ] **Step 1: Replace `apps/web/src/app/(app)/dashboard/page.tsx`**

```tsx
import { Suspense } from 'react';
import Link from 'next/link';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { ArrowUpRight, Plug, Activity, Sparkles, ScrollText, type LucideIcon } from 'lucide-react';
import { getServerContext } from '@/lib/server-context';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { StatsSection, StatsSkeleton } from './_components/stats-section';
import { RecentInvocations, RecentInvocationsSkeleton } from './_components/recent-invocations';

export default async function DashboardPage() {
  const { auth } = await getServerContext();
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in');
  const orgId = (session.user as unknown as { organizationId?: string }).organizationId;
  if (!orgId) redirect('/sign-in');

  return (
    <div className="space-y-10">
      <header className="flex flex-col gap-2">
        <span className="caption">Overview</span>
        <h1 className="font-display text-h1 font-semibold tracking-tight">Welcome back.</h1>
        <p className="max-w-2xl text-[15px] leading-6 text-text-muted">
          holo is your team&apos;s context layer for AI agents. Connect tools, extract skills,
          and watch every agent invocation in one place.
        </p>
      </header>

      <Suspense fallback={<StatsSkeleton />}>
        <StatsSection orgId={orgId} />
      </Suspense>

      <section className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Suspense fallback={<RecentInvocationsSkeleton />}>
          <RecentInvocations orgId={orgId} />
        </Suspense>

        <Card>
          <CardHeader>
            <CardTitle>Quick actions</CardTitle>
            <CardDescription>Get your team to first value.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-1">
            <QuickAction href="/connections" icon={Plug} label="Connect a tool" hint="GitHub, Slack, Notion…" />
            <QuickAction href="/skills" icon={Sparkles} label="Label a skill" hint="Turn artifacts into procedures" />
            <QuickAction href="/connect-agent" icon={Activity} label="Connect your agent" hint="Point any MCP client at holo" />
            <QuickAction href="/audit" icon={ScrollText} label="Review audit log" hint="Security & data-access events" />
          </CardContent>
        </Card>
      </section>
    </div>
  );
}

function QuickAction({
  href,
  icon: Icon,
  label,
  hint,
}: {
  href: string;
  icon: LucideIcon;
  label: string;
  hint: string;
}) {
  return (
    <Link
      href={href}
      className="-mx-2 flex items-center gap-3 rounded-md px-2 py-2 text-[13px] transition-colors duration-micro hover:bg-surface-2"
    >
      <Icon className="h-4 w-4 text-text-subtle" />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="text-text">{label}</span>
        <span className="text-[12px] text-text-subtle">{hint}</span>
      </div>
      <ArrowUpRight className="h-3.5 w-3.5 text-text-subtle" strokeWidth={1.75} />
    </Link>
  );
}
```

- [ ] **Step 2: Verify**

Run: `pnpm --filter @holo/web typecheck && pnpm --filter @holo/web build`. Expected: clean. Then `pnpm --filter @holo/web dev`, throttle network, watch the header render first, then stats, then recent invocations stream in independently.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/\(app\)/dashboard/page.tsx
git commit -m "feat(web): stream dashboard sections via Suspense boundaries"
```

---

## Phase 2 — Shared Zod schemas for Server-Action inputs

**Why:** Today [team/actions.ts:15-22](../../../apps/web/src/app/(app)/dashboard/team/actions.ts) validates with `email.includes('@')` and an inline tuple check. Replace with a Zod schema. We already depend on Zod 4.4.2.

**Files:**
- Create: `apps/web/src/app/(app)/dashboard/team/schemas.ts`
- Modify: `apps/web/src/app/(app)/dashboard/team/actions.ts`

### Task 2.1: Define the schemas

- [ ] **Step 1: Create the schema file**

`apps/web/src/app/(app)/dashboard/team/schemas.ts`:
```ts
import { z } from 'zod';

export const ROLES = ['owner', 'admin', 'member'] as const;
export type Role = (typeof ROLES)[number];

export const inviteMemberSchema = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid email address.'),
  role: z.enum(ROLES, { message: 'Invalid role.' }),
});
export type InviteMemberInput = z.infer<typeof inviteMemberSchema>;

export const cancelInvitationSchema = z.object({
  invitationId: z.string().min(1),
});
export type CancelInvitationInput = z.infer<typeof cancelInvitationSchema>;
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/app/\(app\)/dashboard/team/schemas.ts
git commit -m "feat(web): add Zod schemas for team server-action inputs"
```

### Task 2.2: Refactor `actions.ts` to use schemas

- [ ] **Step 1: Replace `apps/web/src/app/(app)/dashboard/team/actions.ts`**

```ts
'use server';

import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { holoError, ErrorCode } from '@holo/errors';
import { getServerContext } from '@/lib/server-context';
import { inviteMemberSchema, cancelInvitationSchema } from './schemas';

export async function inviteMember(formData: FormData): Promise<{
  ok: boolean;
  error?: string;
}> {
  const parsed = inviteMemberSchema.safeParse({
    email: formData.get('email'),
    role: formData.get('role') ?? 'member',
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input.' };
  }
  const { email, role } = parsed.data;

  const { auth } = await getServerContext();
  const reqHeaders = await headers();
  const session = await auth.api.getSession({ headers: reqHeaders });
  if (!session) {
    throw holoError({
      code: ErrorCode.HOLO_AUTH_NO_SESSION,
      problem: 'must be signed in',
      fix: 'Sign in and try again.',
    });
  }

  try {
    await auth.api.createInvitation({
      body: { email, role },
      headers: reqHeaders,
    });
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof Error
          ? err.message
          : 'Could not send invitation. Try again.',
    };
  }

  revalidatePath('/dashboard/team');
  return { ok: true };
}

export async function cancelInvitation(formData: FormData): Promise<void> {
  const parsed = cancelInvitationSchema.safeParse({
    invitationId: formData.get('invitationId'),
  });
  if (!parsed.success) return;

  const { auth } = await getServerContext();
  const reqHeaders = await headers();

  try {
    await auth.api.cancelInvitation({
      body: { invitationId: parsed.data.invitationId },
      headers: reqHeaders,
    });
  } catch {
    // Silently swallow — revalidate will show whether it stuck.
  }
  revalidatePath('/dashboard/team');
}
```

- [ ] **Step 2: Verify**

Run: `pnpm --filter @holo/web typecheck`. Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/\(app\)/dashboard/team/actions.ts
git commit -m "refactor(web): validate team actions with shared Zod schemas"
```

---

## Phase 3 — First five tests (unblock the test culture)

**Why:** Vitest is configured but unused. Land a tiny, real suite so the next contributor knows where tests go. Cover what would hurt most if it broke: server-action validation, the auth/session helper, and one E2E smoke.

**Files:**
- Create: `apps/web/vitest.config.ts`
- Create: `apps/web/src/app/(app)/dashboard/team/schemas.test.ts`
- Create: `apps/web/src/app/(app)/dashboard/team/actions.test.ts`
- Create: `apps/web/src/lib/server-context.test.ts`
- Create: `apps/web/playwright.config.ts`
- Create: `apps/web/e2e/sign-in.spec.ts`
- Modify: `apps/web/package.json` (add `test:e2e` script + `@playwright/test` dev dep)

### Task 3.1: Set up Vitest config

- [ ] **Step 1: Create `apps/web/vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    exclude: ['e2e/**'],
  },
});
```

- [ ] **Step 2: Verify**

Run: `pnpm --filter @holo/web test`. Expected: PASS (no tests, exits 0).

- [ ] **Step 3: Commit**

```bash
git add apps/web/vitest.config.ts
git commit -m "chore(web): wire up vitest config with @ alias"
```

### Task 3.2: Test the schemas (TDD — write failing first)

- [ ] **Step 1: Write the failing test**

`apps/web/src/app/(app)/dashboard/team/schemas.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { inviteMemberSchema, cancelInvitationSchema } from './schemas';

describe('inviteMemberSchema', () => {
  it('accepts a valid email and role', () => {
    const r = inviteMemberSchema.safeParse({ email: 'A@B.io', role: 'admin' });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.email).toBe('a@b.io'); // trimmed + lowercased
      expect(r.data.role).toBe('admin');
    }
  });

  it('rejects malformed emails', () => {
    const r = inviteMemberSchema.safeParse({ email: 'not-an-email', role: 'member' });
    expect(r.success).toBe(false);
  });

  it('rejects unknown roles', () => {
    const r = inviteMemberSchema.safeParse({ email: 'x@y.io', role: 'superuser' });
    expect(r.success).toBe(false);
  });
});

describe('cancelInvitationSchema', () => {
  it('rejects empty invitation IDs', () => {
    const r = cancelInvitationSchema.safeParse({ invitationId: '' });
    expect(r.success).toBe(false);
  });

  it('accepts non-empty invitation IDs', () => {
    const r = cancelInvitationSchema.safeParse({ invitationId: 'inv_123' });
    expect(r.success).toBe(true);
  });
});
```

- [ ] **Step 2: Run**

Run: `pnpm --filter @holo/web test`. Expected: 5 passed (Phase 2 already ships the schemas).

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/\(app\)/dashboard/team/schemas.test.ts
git commit -m "test(web): cover team server-action schemas"
```

### Task 3.3: Test `inviteMember` rejects bad input without touching auth

- [ ] **Step 1: Write the test**

`apps/web/src/app/(app)/dashboard/team/actions.test.ts`:
```ts
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/server-context', () => ({
  getServerContext: vi.fn(async () => {
    throw new Error('server context should not be reached for invalid input');
  }),
}));

import { inviteMember } from './actions';

function fd(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.append(k, v);
  return f;
}

describe('inviteMember', () => {
  it('returns an error and does not hit server context for malformed email', async () => {
    const result = await inviteMember(fd({ email: 'nope', role: 'member' }));
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/valid email/i);
  });

  it('returns an error for an unknown role', async () => {
    const result = await inviteMember(fd({ email: 'a@b.io', role: 'superuser' }));
    expect(result.ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run**

Run: `pnpm --filter @holo/web test`. Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/\(app\)/dashboard/team/actions.test.ts
git commit -m "test(web): inviteMember rejects bad input before reaching auth"
```

### Task 3.4: Smoke-test `getServerContext` shape

- [ ] **Step 1: Read the file first**

Read `apps/web/src/lib/server-context.ts` to confirm the exact exports and what it returns. If it requires env vars / a DB connection at import time, mock them; if it composes other modules, only assert on the public shape.

- [ ] **Step 2: Write the test**

`apps/web/src/lib/server-context.test.ts`:
```ts
import { describe, expect, it, vi } from 'vitest';

// If getServerContext eagerly opens a DB pool, mock @holo/db before importing.
vi.mock('@holo/db', async (orig) => {
  const actual = await orig<typeof import('@holo/db')>();
  return { ...actual, db: {} as unknown as typeof actual.db };
});

import { getServerContext } from './server-context';

describe('getServerContext', () => {
  it('returns an object exposing auth and db', async () => {
    const ctx = await getServerContext();
    expect(ctx).toBeDefined();
    expect(ctx).toHaveProperty('auth');
    expect(ctx).toHaveProperty('db');
  });

  it('is referentially stable across calls (module-cached)', async () => {
    const a = await getServerContext();
    const b = await getServerContext();
    expect(a).toBe(b);
  });
});
```

> **If the second assertion fails**, the cache is per-request rather than per-module — drop that assertion and add a comment to `server-context.ts` explaining the lifetime instead. Do not weaken caching to make the test pass.

- [ ] **Step 3: Run**

Run: `pnpm --filter @holo/web test`. Expected: PASS, or one assertion fails revealing the actual lifetime — fix per the note above.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/lib/server-context.test.ts
git commit -m "test(web): pin getServerContext public shape and lifetime"
```

### Task 3.5: Add Playwright + sign-in smoke

- [ ] **Step 1: Install**

```bash
pnpm --filter @holo/web add -D @playwright/test
pnpm --filter @holo/web exec playwright install --with-deps chromium
```

- [ ] **Step 2: Create `apps/web/playwright.config.ts`**

```ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000',
    trace: 'on-first-retry',
  },
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: 'pnpm dev',
        port: 3000,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
});
```

- [ ] **Step 3: Create `apps/web/e2e/sign-in.spec.ts`**

```ts
import { test, expect } from '@playwright/test';

test('sign-in page renders the email form', async ({ page }) => {
  await page.goto('/sign-in');
  await expect(page.getByRole('heading', { name: /sign in/i })).toBeVisible();
  await expect(page.getByLabel(/email/i)).toBeVisible();
});

test('dashboard redirects unauthenticated users to sign-in', async ({ page }) => {
  await page.goto('/dashboard');
  await expect(page).toHaveURL(/\/sign-in/);
});
```

- [ ] **Step 4: Add `test:e2e` script to `apps/web/package.json`**

Add to `scripts`:
```json
"test:e2e": "playwright test"
```

- [ ] **Step 5: Run**

Run: `pnpm --filter @holo/web test:e2e`. Expected: 2 passed. (If the sign-in heading text differs, adjust the selector — don't change the page.)

- [ ] **Step 6: Commit**

```bash
git add apps/web/playwright.config.ts apps/web/e2e apps/web/package.json pnpm-lock.yaml
git commit -m "test(web): add Playwright with sign-in + auth-redirect smoke tests"
```

---

## Phase 4 — Tailwind v4 migration

**Why:** v4 is stable, ~5× faster builds, and the CSS-variables-as-tokens model you already use is its native idiom. Token-driven codebases are the easiest to migrate.

**Files:**
- Modify: `apps/web/package.json`
- Modify: `apps/web/postcss.config.{js,mjs}` (likely deleted)
- Modify: `apps/web/src/app/globals.css` (move tokens from `tailwind.config.ts` into `@theme` block)
- Delete: `apps/web/tailwind.config.ts` (or shrink to the minimum still required)

### Task 4.1: Pre-migration snapshot

- [ ] **Step 1: Build the current app and save a screenshot baseline**

```bash
pnpm --filter @holo/web build
pnpm --filter @holo/web dev &
# In another terminal, walk /, /sign-in, /dashboard, /skills, /connections — screenshot each
```

Save the screenshots somewhere outside the repo (e.g. `~/Desktop/holo-tw3-baseline/`). You'll diff against these after migrating.

### Task 4.2: Run the official codemod

- [ ] **Step 1: Run the upgrade tool**

```bash
cd apps/web
pnpm dlx @tailwindcss/upgrade@latest
```

This rewrites `tailwind.config.ts` tokens into a `@theme` block in `globals.css`, swaps the PostCSS plugin to `@tailwindcss/postcss`, and updates `package.json`.

- [ ] **Step 2: Inspect the diff**

Run: `git diff apps/web`. Expected changes:
- `apps/web/package.json`: `tailwindcss` bumped to `^4`, `@tailwindcss/postcss` added, `autoprefixer` removed.
- `apps/web/postcss.config.*`: now uses `@tailwindcss/postcss`.
- `apps/web/src/app/globals.css`: starts with `@import "tailwindcss";` and a `@theme { ... }` block holding the tokens that used to live in `tailwind.config.ts`.

- [ ] **Step 3: Reconcile DESIGN.md tokens**

Open `DESIGN.md` and the new `@theme` block. Confirm every token listed in `DESIGN.md` (colors `--bg`, `--surface`, `--border`, `--text`, `--accent`, `--error`, `--success`, `--warning`, `--code-bg`; typography `display-1/2`, `h1/2`, `body`, `body-sm`, `caption`, `mono`) appears in the new theme. Add any missing ones by hand — do not invent values.

### Task 4.3: Verify nothing visually regressed

- [ ] **Step 1: Build + dev**

Run: `pnpm --filter @holo/web build && pnpm --filter @holo/web dev`. Expected: clean build.

- [ ] **Step 2: Manual diff**

Walk the same routes you screenshotted in 4.1 and compare side-by-side. Pay attention to:
- Custom font sizes (`display-1`, `display-2`, `h1`, `h2`, `body`, `body-sm`, `caption`).
- Custom colors via `bg-surface`, `text-text-muted`, `border-border-strong`.
- Dark mode toggle (still `darkMode: 'class'` semantics under v4).
- The `duration-micro` utility (custom transitionDuration).

If any utility no longer exists, add it to the `@theme` block — don't sprinkle inline styles.

- [ ] **Step 3: Commit (once visually clean)**

```bash
git add apps/web
git commit -m "chore(web): migrate Tailwind v3 → v4 via official codemod"
```

---

## Phase 5 — `proxy.ts` for `(app)/*` session gating (Next.js 16)

**Why:** Today every `(app)/*` page calls `getServerContext()` + `getSession()` and redirects on miss. A `proxy.ts` (the Next.js 16 successor to `middleware.ts`) gates the cookie at the network boundary so unauth requests never enter route rendering.

**Important:** In Next.js 16, the file is `proxy.ts` and it runs on the **Node.js runtime** (the edge runtime is not supported in proxy). `middleware.ts` still works for edge use cases but is deprecated. We don't need edge here — Node.js is fine.

**Files:**
- Create: `apps/web/proxy.ts`

### Task 5.1: Add the proxy

- [ ] **Step 1: Confirm cookie name**

Run:
```bash
grep -RIn "cookieName\|sessionCookie\|better-auth" packages/auth apps/web/src
```
Expected: find better-auth's session cookie name (default `better-auth.session_token`). Use the actual constant if exported; otherwise hardcode the name and add a comment with the source.

- [ ] **Step 2: Create `apps/web/proxy.ts`**

```ts
import { NextResponse, type NextRequest } from 'next/server';

// better-auth session cookie. Confirmed in Step 1 above.
const SESSION_COOKIE = 'better-auth.session_token';

const APP_PREFIXES = ['/dashboard', '/skills', '/connections', '/observability', '/audit', '/profile'];

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  const isAppRoute = APP_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
  if (!isAppRoute) return NextResponse.next();

  const hasSession = request.cookies.has(SESSION_COOKIE);
  if (hasSession) return NextResponse.next();

  const signInUrl = new URL('/sign-in', request.url);
  signInUrl.searchParams.set('next', `${pathname}${search}`);
  return NextResponse.redirect(signInUrl);
}

export const config = {
  matcher: [
    // Skip Next internals + static files; everything else passes through.
    '/((?!_next/|api/|.*\\..*).*)',
  ],
};
```

> Note: `proxy.ts` is gating only — it short-circuits the cookie check. The page-level `getSession()` calls remain authoritative; do **not** delete them. Cookie presence ≠ valid session.

- [ ] **Step 3: Verify**

Run: `pnpm --filter @holo/web build`. Expected: clean.

Then `pnpm --filter @holo/web dev` and:
1. Visit `/dashboard` in a private window → should redirect to `/sign-in?next=%2Fdashboard`.
2. Visit `/` → should render normally.
3. Visit `/sign-in` → should render normally.
4. Sign in → land on `/dashboard` → no redirect loop.

- [ ] **Step 4: Run the Playwright smoke from Phase 3**

Run: `pnpm --filter @holo/web test:e2e`. Expected: both tests still pass (the redirect test now exercises the proxy instead of the page's `getSession`).

- [ ] **Step 5: Commit**

```bash
git add apps/web/proxy.ts
git commit -m "feat(web): add Next.js 16 proxy.ts for (app)/* session gating"
```

---

## Self-Review Checklist (run before handing off)

- [x] **Spec coverage:** Each of the five gaps from the audit (Suspense, Zod schemas, tests, Tailwind v4, proxy) has at least one task.
- [x] **No placeholders:** Every code step contains the actual code, not a description of it.
- [x] **Type consistency:** `Role` and `ROLES` are defined once in `team/schemas.ts` and reused; `getServerContext` shape matches existing usage.
- [x] **Next.js 16 correctness:** Uses `proxy.ts` (not `middleware.ts`) on the Node.js runtime; uses `<Suspense>` + `loading.tsx` per App Router conventions; Server Actions stay 'use server'.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-03-nextjs-16-best-practices.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
