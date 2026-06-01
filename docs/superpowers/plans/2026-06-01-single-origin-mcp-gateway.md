# Single-Origin MCP Gateway Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collapse the two-host web+gateway public surface into a single origin by having the Next.js web app reverse-proxy gateway paths (`/mcp`, `/v1/*`, `/slack/*`, `/teams-bot/*`, `/google-chat-app/*`, `/.well-known/oauth-protected-resource`, `/openapi.json`, `/docs`) to the local Hono gateway via Next.js `rewrites()`.

**Architecture:** Today the gateway is exposed at its own public hostname (`holo-gateway.maakle.com`) and the web at another (`holo-app.maakle.com`). After this change, only the web hostname is publicly exposed; the gateway stays bound to the docker network (and `localhost:8080` for direct access in dev). Next.js streams traffic through to the gateway transparently. MCP_PUBLIC_URL becomes optional and defaults to WEB_PUBLIC_URL so single-origin operators set one URL, not two.

**Tech Stack:** Next.js 16 `rewrites()`, Hono (gateway), Docker Compose (service networking), `@holo/env` zod schema.

**Non-goals:**
- Refactoring the gateway into Next.js API routes
- Removing the gateway's `:8080` port binding (operators using their own reverse proxy in production still need direct access)
- Changing the OAuth flow code in the gateway or web

**Risks to validate:**
- Next.js `rewrites()` must pass through Server-Sent Events without buffering (MCP streaming depends on it). Verified manually in Task 9.
- Order of rewrite rules matters — the existing catch-all `/.well-known/:path*` → `/well-known/:path*` must come AFTER the specific `/.well-known/oauth-protected-resource` proxy rule.

---

## File Structure

**Modified:**
- `packages/env/src/index.ts` — add `GATEWAY_INTERNAL_URL`, make `MCP_PUBLIC_URL` derive from `WEB_PUBLIC_URL` when unset
- `packages/env/test/env.test.ts` — assertions for the new behavior
- `.env.example` — document `GATEWAY_INTERNAL_URL`; clarify `MCP_PUBLIC_URL` semantics
- `apps/web/next.config.mjs` — add gateway-proxy rewrites
- `docker-compose.yml` — pass `GATEWAY_INTERNAL_URL=http://gateway:8080` to web
- `packages/cli/src/commands/init.ts` — drop `MCP_PUBLIC_URL` from wizard (now derived); add note
- `packages/cli/test/init.test.ts` — update assertions on generated `.env`
- `README.md` — explain single-origin model + override path
- `CONTRIBUTING.md` — update setup notes if needed
- `docs/decisions/` — add ADR 0009 documenting the single-origin choice

**Created:**
- `apps/web/src/app/__tests__/gateway-rewrites.test.ts` — integration smoke for rewrite presence in config
- `scripts/verify-mcp-sse.mjs` — operator-facing manual SSE verification helper (curl-based)
- `docs/decisions/0009-single-origin-gateway.md` — ADR

**Not modified:**
- `apps/gateway/src/main.ts` — gateway code is untouched; MCP_PUBLIC_URL handling already reads an env var
- `apps/web/Dockerfile` — env vars come in at runtime via compose
- `apps/web/public/install.sh` — installer doesn't configure tunneling

---

## Task 1: Add GATEWAY_INTERNAL_URL to env schema

**Files:**
- Modify: `packages/env/src/index.ts:92-93`
- Modify: `packages/env/test/env.test.ts`

- [ ] **Step 1: Write failing test**

Append to `packages/env/test/env.test.ts`:

```typescript
describe('GATEWAY_INTERNAL_URL', () => {
  it('parses when set to a valid URL', () => {
    const env = parseEnv({
      ...COMPLETE_ENV,
      GATEWAY_INTERNAL_URL: 'http://gateway:8080',
    });
    expect(env.GATEWAY_INTERNAL_URL).toBe('http://gateway:8080');
  });

  it('defaults to http://localhost:8080 when unset', () => {
    const env = parseEnv(COMPLETE_ENV);
    expect(env.GATEWAY_INTERNAL_URL).toBe('http://localhost:8080');
  });
});
```

Note: `COMPLETE_ENV` is the existing inline object literal at [packages/env/test/env.test.ts:5-15](../../packages/env/test/env.test.ts#L5-L15) — already exported in the test file's scope, just reference it.

- [ ] **Step 2: Run test to confirm it fails**

```bash
pnpm -F @holo/env test
```

Expected: 2 new tests FAIL (`GATEWAY_INTERNAL_URL` is undefined on `env`).

- [ ] **Step 3: Add the field to the schema**

In `packages/env/src/index.ts`, after the existing `MCP_PUBLIC_URL` line (line 92):

```typescript
  MCP_PUBLIC_URL: z.url().default('http://localhost:8080'),
  /**
   * Where the Next.js web app proxies gateway-bound requests internally
   * (Next.js rewrites). In Docker this is the compose service hostname;
   * in local dev it's the gateway's published port. Never exposed publicly.
   */
  GATEWAY_INTERNAL_URL: z.url().default('http://localhost:8080'),
  WEB_PUBLIC_URL: z.url().optional(),
```

- [ ] **Step 4: Run test to confirm it passes**

```bash
pnpm -F @holo/env test
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/env/src/index.ts packages/env/test/env.test.ts
git commit -m "feat(env): add GATEWAY_INTERNAL_URL for single-origin proxy"
```

---

## Task 2: Make MCP_PUBLIC_URL derive from WEB_PUBLIC_URL when unset

**Files:**
- Modify: `packages/env/src/index.ts` (the schema + a post-parse derivation)
- Modify: `packages/env/test/env.test.ts`

**Why this design:** In single-origin mode, `MCP_PUBLIC_URL` is always identical to `WEB_PUBLIC_URL`. Forcing operators to set both is a paper cut. We keep `MCP_PUBLIC_URL` as a real field (so gateway code at [apps/gateway/src/main.ts:30,55,83,98](../../apps/gateway/src/main.ts) doesn't need to change), but auto-fill it from `WEB_PUBLIC_URL` when unset. Two-origin operators still set both explicitly.

- [ ] **Step 1: Write failing test**

Append to `packages/env/test/env.test.ts`:

```typescript
describe('MCP_PUBLIC_URL derivation', () => {
  it('defaults to WEB_PUBLIC_URL when MCP_PUBLIC_URL is unset', () => {
    const env = parseEnv({
      ...COMPLETE_ENV,
      WEB_PUBLIC_URL: 'https://holo.example.com',
      MCP_PUBLIC_URL: undefined,
    });
    expect(env.MCP_PUBLIC_URL).toBe('https://holo.example.com');
  });

  it('keeps MCP_PUBLIC_URL when explicitly set (two-origin mode)', () => {
    const env = parseEnv({
      ...COMPLETE_ENV,
      WEB_PUBLIC_URL: 'https://holo.example.com',
      MCP_PUBLIC_URL: 'https://gateway.example.com',
    });
    expect(env.MCP_PUBLIC_URL).toBe('https://gateway.example.com');
  });

  it('falls back to localhost:3000 when neither is set (dev default)', () => {
    const env = parseEnv({
      ...COMPLETE_ENV,
      WEB_PUBLIC_URL: undefined,
      MCP_PUBLIC_URL: undefined,
    });
    expect(env.MCP_PUBLIC_URL).toBe('http://localhost:3000');
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
pnpm -F @holo/env test
```

Expected: the first two tests FAIL (current default is `http://localhost:8080`, not derived); the third also FAILs.

- [ ] **Step 3: Change the schema default and add a post-parse derivation**

In `packages/env/src/index.ts`:

Change line 92 from:
```typescript
  MCP_PUBLIC_URL: z.url().default('http://localhost:8080'),
```
to:
```typescript
  /**
   * Base URL agents use to reach the MCP gateway. In single-origin mode
   * (the default) this equals WEB_PUBLIC_URL; the Next.js app proxies
   * `/mcp` and friends to the gateway internally. Set this explicitly
   * only if you're publishing the gateway on a separate hostname.
   */
  MCP_PUBLIC_URL: z.url().optional(),
```

Update the `parseEnv` function (around line 156) to derive the value when missing:

```typescript
export function parseEnv(raw: Record<string, string | undefined>): Env {
  const result = EnvSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `${i.path.join('.')}: ${i.message}`)
      .join('; ');
    throw holoError({
      code: ErrorCode.HOLO_ENV_INVALID,
      problem: 'environment variables are missing or invalid',
      cause: issues,
      fix: 'Verify your .env file matches .env.example. Generate secrets with `openssl rand -base64 32`.',
    });
  }
  const env = result.data;
  // Single-origin convenience: MCP_PUBLIC_URL defaults to WEB_PUBLIC_URL,
  // then to BETTER_AUTH_URL (which is required and always set in dev/prod).
  if (!env.MCP_PUBLIC_URL) {
    env.MCP_PUBLIC_URL = env.WEB_PUBLIC_URL ?? env.BETTER_AUTH_URL;
  }
  return env;
}
```

You also need to widen the `Env` type so `MCP_PUBLIC_URL` is non-optional in the returned shape. Add right above the `export function parseEnv`:

```typescript
export type Env = z.infer<typeof EnvSchema> & { MCP_PUBLIC_URL: string };
```

(Replace the existing `export type Env = z.infer<typeof EnvSchema>;` line.)

- [ ] **Step 4: Run test to confirm it passes**

```bash
pnpm -F @holo/env test
```

Expected: all tests PASS. Note: the third test expects `http://localhost:3000` because `BETTER_AUTH_URL` defaults to that in the minimal valid env helper.

- [ ] **Step 5: Verify gateway code still compiles**

```bash
pnpm -F @holo/gateway typecheck
```

Expected: PASS. (`apps/gateway/src/main.ts` reads `env.MCP_PUBLIC_URL` as a non-optional string; this still works because the post-parse fill guarantees it.)

- [ ] **Step 6: Commit**

```bash
git add packages/env/src/index.ts packages/env/test/env.test.ts
git commit -m "feat(env): derive MCP_PUBLIC_URL from WEB_PUBLIC_URL when unset"
```

---

## Task 3: Update .env.example with new env var and clarified semantics

**Files:**
- Modify: `.env.example`

- [ ] **Step 1: Update .env.example**

Find the existing `MCP_PUBLIC_URL=http://localhost:8080` line (around line 11) and replace with:

```bash
# Public base URL agents use to reach MCP / REST. Leave unset to inherit
# from WEB_PUBLIC_URL (single-origin mode — recommended). Set explicitly
# only when publishing the gateway on a separate hostname.
# MCP_PUBLIC_URL=

# Where the web app proxies gateway-bound paths internally (Next.js rewrites).
# Default works for both pnpm dev and docker compose. Never exposed publicly.
GATEWAY_INTERNAL_URL=http://localhost:8080
```

- [ ] **Step 2: Verify pnpm bootstrap still produces a working .env**

```bash
# In a scratch dir to avoid clobbering your real .env
cp .env /tmp/.env.bak
rm .env
pnpm bootstrap
diff <(grep -o '^[A-Z_]*=' /tmp/.env.bak | sort -u) <(grep -o '^[A-Z_]*=' .env | sort -u)
# Restore
mv /tmp/.env.bak .env
```

Expected: the only differences are the documented variables changing (`MCP_PUBLIC_URL` removed/commented, `GATEWAY_INTERNAL_URL` added).

- [ ] **Step 3: Commit**

```bash
git add .env.example
git commit -m "docs(env): document GATEWAY_INTERNAL_URL and MCP_PUBLIC_URL derivation"
```

---

## Task 4: Add Next.js rewrites to proxy gateway paths

**Files:**
- Modify: `apps/web/next.config.mjs`

**Why this ordering:** Next.js evaluates rewrite rules in order. The specific `/.well-known/oauth-protected-resource` proxy MUST come before the existing catch-all `/.well-known/:path*` → `/well-known/:path*` rule, or the catch-all would intercept it.

- [ ] **Step 1: Read the current rewrites block**

```bash
sed -n '25,50p' apps/web/next.config.mjs
```

Confirm the current `rewrites()` returns the array with `/.well-known/:path*` and `/ingest/*` rules.

- [ ] **Step 2: Replace the rewrites block**

Edit `apps/web/next.config.mjs` and replace the entire `async rewrites()` function with:

```javascript
  async rewrites() {
    const GATEWAY = process.env.GATEWAY_INTERNAL_URL || 'http://localhost:8080';
    return [
      // --- Gateway proxies (single-origin mode) ---
      // The gateway is bound to GATEWAY_INTERNAL_URL (docker network or
      // localhost) and reached publicly via these path prefixes on the web
      // origin. Two-origin operators can ignore this and point clients at
      // a separate hostname; these rewrites do no harm in that case.
      //
      // MCP transport — bidirectional Streamable HTTP. Next.js passes
      // through SSE/chunked responses without buffering.
      { source: '/mcp', destination: `${GATEWAY}/mcp` },
      { source: '/mcp/:path*', destination: `${GATEWAY}/mcp/:path*` },
      // REST API surface (search, skills, accounts, feedback).
      { source: '/v1/:path*', destination: `${GATEWAY}/v1/:path*` },
      // OpenAPI surface (auto-generated spec + Scalar docs page).
      { source: '/openapi.json', destination: `${GATEWAY}/openapi.json` },
      { source: '/docs', destination: `${GATEWAY}/docs` },
      { source: '/docs/:path*', destination: `${GATEWAY}/docs/:path*` },
      // Third-party webhook surfaces — paths are part of the signed payload
      // contract; do not rewrite the path itself.
      { source: '/slack/:path*', destination: `${GATEWAY}/slack/:path*` },
      { source: '/teams-bot/:path*', destination: `${GATEWAY}/teams-bot/:path*` },
      { source: '/google-chat-app/:path*', destination: `${GATEWAY}/google-chat-app/:path*` },
      // RFC 9728 protected-resource metadata served by the gateway. MUST
      // come before the well-known catch-all below, which would otherwise
      // route to the web's local /well-known/* handler.
      {
        source: '/.well-known/oauth-protected-resource',
        destination: `${GATEWAY}/.well-known/oauth-protected-resource`,
      },

      // --- Existing rules ---
      // App Router can't serve dot-prefixed dirs; expose /well-known/* at
      // /.well-known/*. Order matters: specific gateway proxies above win.
      {
        source: '/.well-known/:path*',
        destination: '/well-known/:path*',
      },
      // PostHog reverse-proxy (browser analytics survive ad blockers).
      {
        source: '/ingest/static/:path*',
        destination: `${POSTHOG_ASSETS_HOST}/static/:path*`,
      },
      {
        source: '/ingest/:path*',
        destination: `${POSTHOG_HOST}/:path*`,
      },
    ];
  },
```

- [ ] **Step 3: Typecheck the change**

```bash
pnpm -F @holo/web typecheck
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/web/next.config.mjs
git commit -m "feat(web): proxy gateway paths via Next.js rewrites (single-origin)"
```

---

## Task 5: Pass GATEWAY_INTERNAL_URL to web in Docker compose

**Files:**
- Modify: `docker-compose.yml`

- [ ] **Step 1: Read the web service block**

```bash
sed -n '75,95p' docker-compose.yml
```

Confirm the web service uses `environment: *app_env`.

- [ ] **Step 2: Override + extend the web service env**

In `docker-compose.yml`, replace the `web:` block with:

```yaml
  web:
    profiles: ["app"]
    build:
      context: .
      dockerfile: apps/web/Dockerfile
    environment:
      <<: *app_env
      # Inside the compose network the gateway is reachable at its service
      # hostname. Used only by Next.js rewrites to proxy /mcp, /v1, etc.
      GATEWAY_INTERNAL_URL: http://gateway:8080
    ports:
      - "3000:3000"
    depends_on:
      migrate: { condition: service_completed_successfully }
      gateway: { condition: service_started }
```

Note the new `depends_on: gateway` — web must wait for gateway to be up, or proxied requests fail at boot.

- [ ] **Step 3: Validate compose file**

```bash
docker compose --profile app config > /dev/null
```

Expected: no errors (exit 0).

- [ ] **Step 4: Commit**

```bash
git add docker-compose.yml
git commit -m "feat(compose): wire GATEWAY_INTERNAL_URL for single-origin web proxy"
```

---

## Task 6: Drop MCP_PUBLIC_URL from CLI init wizard

**Files:**
- Modify: `packages/cli/src/commands/init.ts:145`
- Modify: `packages/cli/test/init.test.ts` (any assertion on `MCP_PUBLIC_URL`)

- [ ] **Step 1: Check what the init test asserts**

```bash
grep -n "MCP_PUBLIC_URL" packages/cli/test/init.test.ts
```

If matches exist, note line numbers; tests will need updating in Step 3.

- [ ] **Step 2: Remove MCP_PUBLIC_URL from the generated env**

In `packages/cli/src/commands/init.ts`, find the `envLines` array (around line 133). Remove the line:

```typescript
    `MCP_PUBLIC_URL=http://localhost:8080`,
```

Add this comment above the `WEB_PUBLIC_URL` line in the same array:

```typescript
    // MCP_PUBLIC_URL is derived from WEB_PUBLIC_URL in single-origin mode.
    // Set it explicitly only when publishing the gateway on a separate host.
    `WEB_PUBLIC_URL=http://localhost:3000`,
```

(Replace the existing `WEB_PUBLIC_URL=http://localhost:3000` line; if it doesn't exist, add it. Verify by reading the file first.)

- [ ] **Step 3: Update tests**

If Step 1 found assertions on `MCP_PUBLIC_URL` in the generated env, remove them. Add a new assertion that `WEB_PUBLIC_URL` is present:

```typescript
expect(written).toContain('WEB_PUBLIC_URL=http://localhost:3000');
expect(written).not.toContain('MCP_PUBLIC_URL=');
```

- [ ] **Step 4: Run CLI tests**

```bash
pnpm -F @holo/cli test
```

Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/commands/init.ts packages/cli/test/init.test.ts
git commit -m "feat(cli): drop MCP_PUBLIC_URL from init (now derived from WEB_PUBLIC_URL)"
```

---

## Task 7: Add a rewrite-presence smoke test for the web app

**Files:**
- Create: `apps/web/src/app/__tests__/gateway-rewrites.test.ts`

**Why this design:** A full integration test would require booting both web and gateway, which Vitest isn't set up for in `apps/web`. Instead, import the next.config and assert the rewrite array contains every path prefix the gateway exposes. Cheap, catches regressions if someone deletes a rewrite by accident.

- [ ] **Step 1: Write the test**

Create `apps/web/src/app/__tests__/gateway-rewrites.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import nextConfig from '../../../next.config.mjs';

describe('Next.js gateway rewrites', () => {
  it('proxies every gateway path prefix to GATEWAY_INTERNAL_URL', async () => {
    const rules = await nextConfig.rewrites();
    const sources = rules.map((r) => r.source);

    // Every path the Hono gateway publishes must have a corresponding
    // rewrite. If you add a route to apps/gateway/src/main.ts, add the
    // rewrite here and update this assertion.
    const required = [
      '/mcp',
      '/mcp/:path*',
      '/v1/:path*',
      '/openapi.json',
      '/docs',
      '/docs/:path*',
      '/slack/:path*',
      '/teams-bot/:path*',
      '/google-chat-app/:path*',
      '/.well-known/oauth-protected-resource',
    ];
    for (const path of required) {
      expect(sources, `missing rewrite for ${path}`).toContain(path);
    }
  });

  it('places /.well-known/oauth-protected-resource before the well-known catchall', async () => {
    const rules = await nextConfig.rewrites();
    const specificIdx = rules.findIndex(
      (r) => r.source === '/.well-known/oauth-protected-resource',
    );
    const catchallIdx = rules.findIndex(
      (r) => r.source === '/.well-known/:path*',
    );
    expect(specificIdx).toBeGreaterThanOrEqual(0);
    expect(catchallIdx).toBeGreaterThanOrEqual(0);
    expect(specificIdx).toBeLessThan(catchallIdx);
  });
});
```

- [ ] **Step 2: Run the test**

```bash
pnpm -F @holo/web test
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/__tests__/gateway-rewrites.test.ts
git commit -m "test(web): assert gateway rewrites cover Hono surface and respect order"
```

---

## Task 8: Add a real HTTP smoke test for the proxy

**Files:**
- Create: `scripts/verify-mcp-sse.mjs`

**Why this design:** SSE behavior through `rewrites()` can't be unit-tested without booting both processes. This script is an operator-runnable helper that drives the boot, hits a known SSE endpoint, and reports pass/fail. Run it in CI later, but for now it's documentation + a manual gate before merge.

- [ ] **Step 1: Write the verifier script**

Create `scripts/verify-mcp-sse.mjs`:

```javascript
#!/usr/bin/env node
// Manual smoke test for the single-origin gateway rewrite.
// Prereq: web + gateway running locally (pnpm dev).
//
// What this verifies:
//   1. GET http://localhost:3000/v1/health     → 200, JSON, came from gateway
//   2. GET http://localhost:3000/openapi.json  → 200, JSON, has paths
//   3. POST http://localhost:3000/mcp           → 401 (expected; no bearer)
//      and the WWW-Authenticate header points at the single-origin URL,
//      not http://localhost:8080.
//
// Pass = all three checks green. Doesn't verify a full MCP session — see
// Task 9 for the Claude Desktop end-to-end procedure.
const BASE = process.env.WEB_BASE_URL || 'http://localhost:3000';

let failed = 0;
function check(name, cond, detail = '') {
  if (cond) console.log(`  \x1b[32m✓\x1b[0m ${name}`);
  else { console.log(`  \x1b[31m✗\x1b[0m ${name}  ${detail}`); failed++; }
}

console.log(`Verifying single-origin gateway at ${BASE}\n`);

// 1. /v1/health
{
  const r = await fetch(`${BASE}/v1/health`);
  const body = await r.json().catch(() => null);
  check('GET /v1/health returns 200', r.status === 200, `status=${r.status}`);
  check('GET /v1/health body is JSON', body !== null);
}

// 2. /openapi.json
{
  const r = await fetch(`${BASE}/openapi.json`);
  const body = await r.json().catch(() => null);
  check('GET /openapi.json returns 200', r.status === 200, `status=${r.status}`);
  check('GET /openapi.json has paths', body && typeof body.paths === 'object');
}

// 3. /mcp 401 + correct WWW-Authenticate
{
  const r = await fetch(`${BASE}/mcp`, { method: 'POST' });
  check('POST /mcp returns 401 (no bearer)', r.status === 401, `status=${r.status}`);
  const wwwAuth = r.headers.get('www-authenticate') || '';
  check(
    'WWW-Authenticate points at single-origin host',
    wwwAuth.includes(BASE) && !wwwAuth.includes('localhost:8080'),
    `header=${wwwAuth || '(missing)'}`,
  );
}

console.log('');
if (failed) { console.error(`\x1b[31m${failed} check(s) failed\x1b[0m`); process.exit(1); }
console.log('\x1b[32mAll checks passed.\x1b[0m');
```

Add to `package.json` scripts:

```json
"verify:gateway": "node scripts/verify-mcp-sse.mjs"
```

(Add the line under the existing `"check:env"` entry in [package.json](../../package.json).)

- [ ] **Step 2: Manually verify the script runs**

In one terminal: `pnpm dev` (must still be running). In another:

```bash
pnpm verify:gateway
```

Expected: all 6 checks PASS. If `WWW-Authenticate` still mentions `localhost:8080`, the gateway is advertising its own URL instead of the single-origin one — set `MCP_PUBLIC_URL=http://localhost:3000` in `.env` (or unset it so it derives from `BETTER_AUTH_URL`).

- [ ] **Step 3: Commit**

```bash
git add scripts/verify-mcp-sse.mjs package.json
git commit -m "test(scripts): add verify:gateway HTTP smoke for single-origin proxy"
```

---

## Task 9: Manually verify MCP SSE through the rewrite with Claude Desktop

**Files:** none modified — this is a manual gate.

**Why this matters:** The whole rewrite design hinges on Next.js streaming SSE through without buffering. Pure HTTP checks (Task 8) catch most regressions but not SSE-specific buffering bugs.

- [ ] **Step 1: Start the stack and a tunnel**

```bash
# Terminal 1
pnpm dev

# Terminal 2 — pick whichever tunnel you have
cloudflared tunnel run holo-dev    # or: ngrok http 3000
```

Record the public URL (e.g. `https://holo.maakle.com`).

- [ ] **Step 2: Set MCP_PUBLIC_URL to the public URL temporarily**

Edit `.env`:

```bash
MCP_PUBLIC_URL=https://holo.maakle.com
WEB_PUBLIC_URL=https://holo.maakle.com
BETTER_AUTH_URL=https://holo.maakle.com
```

Restart `pnpm dev` to pick up the change.

- [ ] **Step 3: Configure Claude Desktop**

In `~/Library/Application Support/Claude/claude_desktop_config.json` add (or update):

```json
{
  "mcpServers": {
    "holo-single-origin": {
      "url": "https://holo.maakle.com/mcp"
    }
  }
}
```

Restart Claude Desktop.

- [ ] **Step 4: Run a tool call from Claude Desktop**

Open Claude Desktop, complete the OAuth flow if prompted, then ask Claude to call the `search` tool with a simple query. Watch for:

- The OAuth flow completes (proves `/.well-known/oauth-protected-resource` is served at the single origin)
- The tool list loads (proves `POST /mcp` initialization streams correctly)
- A tool call returns results (proves bidirectional streaming)

Pass criterion: a tool call round-trips successfully.

- [ ] **Step 5: Document the verification in the ADR (next task)**

If pass: proceed to Task 10. If fail: stop, investigate buffering in Next.js logs, and either tune the rewrite or fall back to the cloudflared path-routing approach documented in the ADR's "Alternatives considered" section.

---

## Task 10: Write ADR 0009 documenting the choice

**Files:**
- Create: `docs/decisions/0009-single-origin-gateway.md`

- [ ] **Step 1: Find the existing ADR template**

```bash
cat docs/decisions/0005-github-app-over-oauth.md | head -40
```

Match its structure (front matter, sections).

- [ ] **Step 2: Write the ADR**

Create `docs/decisions/0009-single-origin-gateway.md`:

```markdown
# 0009 — Single-origin gateway

**Status:** Accepted (2026-06-01)
**Supersedes:** none

## Context

Holo runs three Node processes: `apps/web` (Next.js, port 3000), `apps/gateway` (Hono, port 8080), `apps/worker` (NestJS, no public port). Before this decision, self-hosters and contributors exposed two public hostnames — one for the web, one for the gateway — typically backed by two cloudflared ingress rules or two ngrok tunnels.

Two-host setups are friction at every onboarding step:

- Two DNS records, two TLS certs, two tunnel configs to keep aligned
- ngrok free supports only one tunnel, blocking contributors testing OAuth/MCP locally
- Operators frequently typo or desync the two URLs (we hit a `/Users/maakle` typo this session)
- OAuth callbacks and cookies have to navigate cross-origin even though both origins belong to the same operator

## Decision

The web app reverse-proxies all gateway-bound paths to the gateway via Next.js `rewrites()`. The gateway stays bound to a private endpoint (`http://gateway:8080` in Docker, `http://localhost:8080` in dev) and is no longer expected to have a public hostname.

Proxied paths:
- `/mcp`, `/mcp/*` — MCP Streamable HTTP transport
- `/v1/*` — REST API (search, skills, accounts, feedback)
- `/openapi.json`, `/docs`, `/docs/*` — OpenAPI surface
- `/slack/*`, `/teams-bot/*`, `/google-chat-app/*` — third-party webhooks
- `/.well-known/oauth-protected-resource` — RFC 9728 MCP OAuth metadata

`MCP_PUBLIC_URL` becomes optional in [`packages/env/src/index.ts`](../../packages/env/src/index.ts) and defaults to `WEB_PUBLIC_URL`. Two-origin operators can still publish the gateway separately by setting `MCP_PUBLIC_URL` explicitly; the gateway code is unchanged.

## Consequences

**Positive:**
- One tunnel/cert/DNS record per self-host
- ngrok free works for contributors
- Same-origin OAuth, cookies, CORS — fewer footguns in Better Auth
- Single source of truth for the public URL

**Negative:**
- Gateway availability is coupled to web availability (if Next.js crashes, agents can't reach `/mcp`). Acceptable: if the web is down the product is down regardless.
- Slight latency from the extra Node hop. Negligible relative to LLM inherent latency.
- All gateway traffic now flows through Next.js's runtime — at very high agent volume an operator may want to bypass and put their own reverse proxy in front of both. The gateway's `:8080` port is intentionally still published in `docker-compose.yml` to make this possible.

## Alternatives considered

**Path-based routing at the tunnel layer (cloudflared `path:` ingress).** Works for cloudflared-only operators but ngrok free doesn't support it. Kept as a documented fallback if Next.js SSE proxying breaks in practice.

**Fold the gateway into Next.js as API routes.** Real refactor; loses the clean separation between the agent surface (Hono, fast, no React) and the operator surface (Next.js, slower, React-heavy). Rejected.

## Verification

Single-origin SSE is verified end-to-end against Claude Desktop on the date this ADR is committed (see Task 9 of the implementation plan, [`docs/superpowers/plans/2026-06-01-single-origin-mcp-gateway.md`](../superpowers/plans/2026-06-01-single-origin-mcp-gateway.md)). The lightweight HTTP smoke lives at [`scripts/verify-mcp-sse.mjs`](../../scripts/verify-mcp-sse.mjs).
```

- [ ] **Step 3: Commit**

```bash
git add docs/decisions/0009-single-origin-gateway.md
git commit -m "docs(adr): 0009 single-origin gateway via Next.js rewrites"
```

---

## Task 11: Update README and CONTRIBUTING for the new model

**Files:**
- Modify: `README.md` (Quickstart and Development sections)
- Modify: `CONTRIBUTING.md` (Setup section)

- [ ] **Step 1: Find the relevant README sections**

```bash
grep -n "MCP_PUBLIC_URL\|gateway\|tunnel" README.md
```

Note the line ranges that mention the gateway URL or two-host setup.

- [ ] **Step 2: Add a "Public URL" subsection to README's Quickstart**

After the existing self-host quickstart code block, add:

```markdown
### One public URL

Self-hosters need **one** public URL (DNS + TLS + tunnel/proxy) pointing at `:3000`. The web app reverse-proxies agent traffic (`/mcp`, `/v1/*`, webhooks) to the gateway internally. See [ADR 0009](./docs/decisions/0009-single-origin-gateway.md) for the rationale and the two-origin override.

For a quick local tunnel:

\`\`\`bash
ngrok http 3000           # or: cloudflared tunnel run <name>
\`\`\`

Then set `WEB_PUBLIC_URL` (and `BETTER_AUTH_URL`) in `.env` to the public URL and restart.
```

(Use real backticks, not escaped ones, when writing the file.)

- [ ] **Step 3: Update CONTRIBUTING.md**

Find the existing setup block and add a one-line note below it:

```markdown
**Public testing:** if you need a public URL for OAuth or MCP testing, run `ngrok http 3000` and set `WEB_PUBLIC_URL` in `.env` to the tunnel URL — one tunnel is enough. See [ADR 0009](./docs/decisions/0009-single-origin-gateway.md).
```

- [ ] **Step 4: Commit**

```bash
git add README.md CONTRIBUTING.md
git commit -m "docs: document single-origin tunneling for self-host and dev"
```

---

## Task 12: Final integration verification

**Files:** none modified.

- [ ] **Step 1: Clean slate test**

```bash
docker compose --profile app down -v
docker compose --profile app up -d --build
sleep 30
curl -sf http://localhost:3000/v1/health | jq .
curl -sf -o /dev/null -w "%{http_code}\n" http://localhost:3000/openapi.json
curl -sf -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3000/mcp
```

Expected: `/v1/health` returns JSON; `/openapi.json` returns `200`; `/mcp` returns `401`.

- [ ] **Step 2: Run the full test suite**

```bash
pnpm test
```

Expected: all tests PASS. If anything fails that touched env/cli/web, revisit the relevant task.

- [ ] **Step 3: Run the operator smoke**

```bash
pnpm verify:gateway
```

Expected: all 6 checks PASS.

- [ ] **Step 4: Clean up**

```bash
docker compose --profile app down
```

- [ ] **Step 5: Open the PR**

```bash
git push -u origin feat/single-origin-mcp-gateway
gh pr create --title "feat: collapse web+gateway into single public origin" --body "$(cat <<'EOF'
## Summary
- Next.js web app proxies `/mcp`, `/v1/*`, `/slack/*`, `/teams-bot/*`, `/google-chat-app/*`, `/openapi.json`, `/docs`, and `/.well-known/oauth-protected-resource` to the local gateway via `rewrites()`.
- `MCP_PUBLIC_URL` now optional — defaults to `WEB_PUBLIC_URL`. Two-origin operators unaffected (set it explicitly).
- New `GATEWAY_INTERNAL_URL` env tells Next.js where the gateway lives internally.
- Compose web service waits on gateway and gets `GATEWAY_INTERNAL_URL=http://gateway:8080`.

## Test plan
- [x] `pnpm -F @holo/env test` — env derivation
- [x] `pnpm -F @holo/cli test` — init wizard
- [x] `pnpm -F @holo/web test` — rewrite presence + ordering
- [x] `pnpm verify:gateway` — live HTTP smoke
- [x] Claude Desktop tool call through tunneled single origin

See [ADR 0009](./docs/decisions/0009-single-origin-gateway.md) for the design rationale.
EOF
)"
```

---

## Self-Review Notes

- **Spec coverage:** every gateway path prefix from the explore report (Task 4) has a rewrite rule. MCP_PUBLIC_URL derivation (Task 2) preserves two-origin mode for operators who want it.
- **Streaming risk:** explicitly gated by manual Task 9. If it fails, ADR documents the cloudflared path-routing fallback.
- **Order dependency:** Task 4 step 2 spells out why `/.well-known/oauth-protected-resource` must precede the well-known catch-all, and Task 7 step 1 asserts that ordering.
- **No env regression:** Task 6 removes `MCP_PUBLIC_URL` from the wizard but the parseEnv derivation guarantees `env.MCP_PUBLIC_URL` is always a string at runtime, so gateway code at [`apps/gateway/src/main.ts:30`](../../apps/gateway/src/main.ts#L30) continues to work without a code change.
- **Rollback story:** revert the branch — schema change is forward-compatible (extra var with default), rewrites are additive, gateway code untouched. Operators on two-origin setups continue to work because `MCP_PUBLIC_URL` is honored when explicitly set.
