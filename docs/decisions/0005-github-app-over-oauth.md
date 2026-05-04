# 0005 — GitHub App over OAuth App for the GitHub connector

**Status:** Accepted · **Date:** 2026-05-04

## Context

The current GitHub connector authenticates as an OAuth App with a user-to-server token. This was the fastest path to a working ingestion flow and is fine for solo / dev use. As we move toward customer-grade deployments — even single-tenant ones with one admin connecting once per org — the OAuth-App model creates operational headaches that don't get solved by tuning the connector itself.

Identity is the central problem. An OAuth user-to-server token ties the entire connector's authority to one human's GitHub account. If that human leaves the company, has a security action taken on their account, revokes the grant, or rotates 2FA in a way that invalidates the token, the connector dies for everyone in the org. The 5,000/hr rate limit applies per-user, doesn't scale with org size, and we get no webhook delivery — every change must be polled. The audit trail in customers' GitHub logs shows every API call as that one human, not as our system.

Two paths were considered:

1. Stay on OAuth, fix the symptoms (better cursors, GraphQL, reconnect prompts).
2. Migrate to a GitHub App with installation-scoped tokens.

## Decision

Migrate to a GitHub App. Register one App in our GitHub account, customers install it on their org once at onboarding, and the worker mints fresh installation tokens from our private key for every API call.

The migration is parallel: a new "Connect via GitHub App" flow ships alongside the existing OAuth flow. Existing OAuth-connected sources continue working until we're confident in the App path, then we deprecate OAuth and provide a guided re-install.

## Consequences

**Positive:**
- Connector identity decouples from any one user. Admin departures, password resets, and OAuth grant revocations no longer break ingestion.
- Installation tokens auto-rotate hourly; we never store a long-lived credential.
- Rate limit scales with org size (5k base → 12.5k+ for orgs >20 seats), and webhooks remove most of the polling pressure entirely.
- Fine-grained per-resource permissions (`Contents: Read`, `Pull requests: Read`, etc.) replace coarse OAuth scopes.
- Repo selection moves to GitHub's native installer UI — no need to maintain a custom picker for that primary case (we keep ours for "subset of installed repos" filtering).
- Audit trail in customers' GitHub Enterprise logs shows API calls as the holo App, clean for SOC2 review.

**Negative:**
- Bigger one-time engineering investment than a tuning pass on OAuth (~1–2 weeks).
- We commit to running a GitHub App: maintaining a private key as a deploy secret, registering webhook URLs at app-creation time (changes require coordinating with all installations), publishing the App's identity (logo, name, callback URLs) on GitHub's marketplace.
- Self-hosters of holo can't share our App. Each self-hosted instance must register its own GitHub App, configure the private key, and update users' install URLs. Documented as part of the self-host setup.

**Mitigation:**
- Document the self-host setup with copy-paste app manifest JSON so creating a new App is one click on GitHub's "Create from manifest" page.
- Keep the OAuth flow code in place until the App flow has run in production for at least one customer cycle. Dual-flow code path in `packages/connectors/src/github/`.

## Notes

This decision is GitHub-specific. Slack, Notion, and Grain all have analogous "App" vs "OAuth" splits we may revisit independently — but they don't share GitHub's particular pain (per-user rate limits + no webhooks for OAuth Apps), so the urgency is lower.
