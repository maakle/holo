# 0001 — Connector port interface

**Status:** Accepted · **Date:** 2026-04-29

## Context

Holo ingests data from many third-party systems (Slack, GitHub, Notion, Google Workspace, Linear, meeting transcript platforms, and a long tail). Each system has a different OAuth model, sync semantics, webhook format, ACL primitive, and rate-limit shape. Two paths were considered:

1. Adopt a connector framework (Nango, Composio, Pipedream Connect) and build everything on top of it.
2. Roll our own connector layer behind a strict port interface, using official per-vendor SDKs.

## Decision

Roll our own. Define a `Connector<TConfig, TResource>` interface in `packages/connectors`. Every connector implements it. Long-tail providers are added later via a `NangoConnectorAdapter` that satisfies the same interface — Nango becomes one strategy among many, not the foundation.

The interface includes: `buildAuthorizeUrl`, `exchangeCode`, `refresh`, `fullSync`, `incrementalSync`, `verifyWebhook`, `normalizeWebhook`, `testConnection`.

## Consequences

**Positive:**
- Matches Dust and Onyx, the closest analogs at our scope.
- Top connectors all have excellent first-party SDKs, so the framework's main value (raw HTTP abstraction) doesn't apply.
- Avoids embedding Elastic License v2 code (Nango) in our AGPL-3.0 distribution.
- Each connector is ~300–500 LOC, well within hand-maintenance budget.
- The `NangoConnectorAdapter` escape hatch gives us Nango's catalog without committing the core stack.

**Negative:**
- More upfront work for each connector compared to a managed catalog.
- We own OAuth refresh, rate limiting, retry semantics, and webhook verification per provider.

**Mitigation:** A small shared library inside `packages/connectors/shared/` for OAuth refresh, HMAC verification, exponential backoff, and idempotency, used by all connector implementations.
