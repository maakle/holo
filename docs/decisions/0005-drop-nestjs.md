# 0005 — Drop NestJS

**Status:** Accepted (2026-05-03)
**Supersedes parts of:** [0001](./0001-connector-port-interface.md), [`ARCHITECTURE.md`](../ARCHITECTURE.md) ("NestJS for the API, Next.js for the dashboard" section)

## Context

Earlier drafts of `ARCHITECTURE.md` chose NestJS for `apps/api` and `apps/worker`. The reasoning: DI + module system pay off concretely past ~30 modules, and our domain (connectors, retrieval, skills, plans, evals, auth, billing, webhooks) was projected to land there.

At v0.0, we have:
- 1 connector (GitHub) wired E2E in `apps/web` route handlers
- a worker that schedules a 60-second heartbeat
- an MCP server (Hono) with one tool (`search`)
- no skills, plans, evals, or billing modules yet

The NestJS scaffold cost us:
- ~3,000 lines of NestJS + nestjs-pino + reflect-metadata + rxjs in `node_modules`
- a separate app process (`apps/api`) that nothing on the user's path hit (auth callbacks live in `apps/web`)
- duplicate auth wiring (NestJS `AuthGuard` in `apps/api`, Better Auth session middleware in `apps/mcp`, Better Auth in `apps/web`)
- slower cold starts and an additional Dockerfile

It bought us little — the only NestJS-shaped thing in the codebase was a `health.controller.ts`, an `AuthGuard`, and a `HoloErrorFilter` that maps `HoloError` → HTTP status (already implementable as Hono middleware in 10 lines).

## Decision

Three apps, no backend framework:

| App | Stack | Owns |
|---|---|---|
| `apps/web` | Next.js 15 | Dashboard, marketing, sign-in, all OAuth callbacks (login + connector), team management, connect-agent. |
| `apps/mcp` | Hono + `@hono/zod-openapi` | MCP JSON-RPC at `POST /mcp`; OpenAPI/REST at `/v1/*` (spec at `/openapi.json`, UI at `/docs`). |
| `apps/worker` | plain Node + BullMQ | Per-connector ingestion jobs registered in `jobs/<name>.ts`. |

Cross-cutting concerns (auth, ACL scoping, structured errors, logging) live as Hono middleware or shared helpers in `packages/*`.

## Consequences

**Pros:**
- ~3,000 lines fewer in `node_modules`; faster `pnpm install` and CI
- One auth code-path per agent route (Better Auth session cookie or `api_token` bearer, both via `apps/mcp/src/middleware/auth.ts`)
- Faster local dev (one fewer service in `pnpm dev` and `docker-compose`)
- OpenAPI is a first-class output of `@hono/zod-openapi` — Zod schemas are the source of truth, no NestJS controller decorators
- Easier for OSS contributors — no NestJS module boilerplate to learn

**Cons:**
- No request-scoped DI for `workspaceId`/`traceId` — we pass them explicitly through middleware-set context (Hono `c.set('identity', …)`) and function arguments. Not as automatic as NestJS interceptors, but explicit.
- No ready-made `@nestjs/bullmq` decorator-driven worker class — we register `Worker(name, handler, { connection })` directly. Slightly more imperative but with fewer surprises.
- We may regret this if v0.6's drift-detection + skill-synthesis modules push the codebase past ~50 services. Re-adoption cost: bringing NestJS back into one of the two backend apps is ~1 day of wrapping work.

## When to revisit

If we hit either threshold:
- ≥ 30 connectors in production with per-connector services that need shared cross-cutting concerns
- A Plan/Intent/Drift system whose service layer would meaningfully benefit from request-scoped DI

…wrap `apps/mcp` in NestJS (Fastify adapter) and migrate the routes incrementally. Until then, plain Hono.

## References

- Vercel's GitHub MCP server, Anthropic's reference servers: all plain HTTP frameworks, no NestJS
- Cal.com migration *toward* DI was specifically about a Next.js monolith — we already split web from API by app, so we don't have that pain
- Twenty CRM's NestJS investment is justified by the size and shape of their domain (CRM with custom field schema), not ours
