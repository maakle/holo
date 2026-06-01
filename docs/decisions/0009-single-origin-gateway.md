# 0009 — Single-origin gateway

**Status:** Accepted (2026-06-01)
**Supersedes:** none

## Context

Holo runs three Node processes: `apps/web` (Next.js, port 3000), `apps/gateway` (Hono, port 8080), `apps/worker` (NestJS, no public port). Before this decision, self-hosters and contributors exposed two public hostnames — one for the web, one for the gateway — typically backed by two cloudflared ingress rules or two ngrok tunnels.

Two-host setups are friction at every onboarding step:

- Two DNS records, two TLS certs, two tunnel configs to keep aligned
- ngrok free supports only one tunnel, blocking contributors testing OAuth/MCP locally
- Operators frequently typo or desync the two URLs
- OAuth callbacks and cookies have to navigate cross-origin even though both origins belong to the same operator

## Decision

The web app reverse-proxies all gateway-bound paths to the gateway via Next.js `rewrites()`. The gateway stays bound to a private endpoint (`http://gateway:8080` in Docker, `http://localhost:8080` in dev) and is no longer expected to have a public hostname.

Proxied paths (from [apps/web/next.config.mjs](../../apps/web/next.config.mjs)):
- `/mcp`, `/mcp/*` — MCP Streamable HTTP transport
- `/v1/*` — REST API (search, skills, accounts, feedback)
- `/openapi.json`, `/docs`, `/docs/*` — OpenAPI surface
- `/slack/*`, `/teams-bot/*`, `/google-chat-app/*` — third-party webhooks
- `/.well-known/oauth-protected-resource` — RFC 9728 MCP OAuth metadata

Notable non-proxied path:
- `/.well-known/oauth-authorization-server` — the web has its own canonical handler at [apps/web/src/app/well-known/oauth-authorization-server/route.ts](../../apps/web/src/app/well-known/oauth-authorization-server/route.ts) that derives the issuer from `WEB_PUBLIC_URL`. The existing `/.well-known/:path*` catch-all reaches it correctly.

`MCP_PUBLIC_URL` became optional in [packages/env/src/index.ts](../../packages/env/src/index.ts) and defaults to `WEB_PUBLIC_URL` (with `BETTER_AUTH_URL` as a final fallback). Two-origin operators can still publish the gateway separately by setting `MCP_PUBLIC_URL` explicitly; the gateway code is unchanged.

A new env var, `GATEWAY_INTERNAL_URL`, tells the web app where to proxy to. It defaults to `http://localhost:8080`. In Docker Compose the web service overrides it to `http://gateway:8080`.

## Consequences

**Positive:**
- One tunnel/cert/DNS record per self-host
- ngrok free works for contributors
- Same-origin OAuth, cookies, CORS — fewer footguns in Better Auth
- Single source of truth for the public URL

**Negative:**
- Gateway availability is coupled to web availability (if Next.js crashes, agents can't reach `/mcp`). Acceptable: if the web is down the product is down regardless.
- Slight latency from the extra Node hop. Negligible relative to LLM inherent latency.
- All gateway traffic now flows through Next.js's runtime. At very high agent volume an operator may want to bypass Next and put their own reverse proxy in front of both. The gateway's `:8080` port is intentionally still published in [`docker-compose.yml`](../../docker-compose.yml) to make this possible — operators retain the option to put the gateway back on its own public hostname.

## Alternatives considered

**Path-based routing at the tunnel layer (cloudflared `path:` ingress).** Works for cloudflared-only operators but ngrok free doesn't support it. Kept as a documented fallback if Next.js SSE proxying breaks in practice — operators can configure their tunnel to route `/mcp` and `/v1` directly to the gateway and bypass the Next.js rewrite layer.

**Fold the gateway into Next.js as API routes.** Real refactor; loses the clean separation between the agent surface (Hono, fast, no React) and the operator surface (Next.js, slower, React-heavy). Rejected.

## Verification

HTTP-level verification is automated by [`pnpm verify:gateway`](../../scripts/verify-mcp-sse.mjs) which exercises `/v1/health`, `/openapi.json`, and `/mcp` (expected 401 with `WWW-Authenticate` pointing at the single-origin URL).

Streaming behavior (MCP Streamable HTTP / SSE) is the operator's gate: before relying on this in production, run a real MCP client (Claude Desktop, Cursor, or the MCP Inspector) against `${WEB_PUBLIC_URL}/mcp`, complete the OAuth flow, and call a tool. A successful round-trip confirms Next.js `rewrites()` passes streaming responses through without buffering.

If streaming breaks in your environment, fall back to the cloudflared path-routing approach in "Alternatives considered" above and file an issue with the buffering behavior you observed.

## Migration notes for existing deployments

Operators upgrading from a two-host setup should:
1. Add `GATEWAY_INTERNAL_URL` on the web service pointing at the gateway's internal address (e.g., `http://gateway:8080` for compose, `http://${{Gateway.RAILWAY_PRIVATE_DOMAIN}}:8080` for Railway).
2. Set `MCP_PUBLIC_URL` to `WEB_PUBLIC_URL` on web/gateway/worker (or unset `MCP_PUBLIC_URL` on web — derivation takes over).
3. Update OAuth callback URLs and webhook receiver URLs (Slack, Stripe, GitHub App, Google Chat, Teams) to the single public origin.
4. Remove the gateway's public domain / DNS record once steps 1-3 are in place.

Do step 1 before step 4 to avoid a window where `/mcp` returns 502 because the web has no proxy target.
