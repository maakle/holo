# 0007 — Workspace credit-pool pricing

**Status:** Accepted · **Date:** 2026-05-20 · **Amended:** 2026-05-20 (top-ups instead of variants — see Status of related changes)

## Context

The original pricing ladder (Free 25K credits / Starter $20 / Team $50 / Business $200, per-seat-shaped) broke at first contact with reality:

1. One chat run debits ~20,100 credits — the dashboard ledger shows it. So the Free tier (25K/mo) supports about one chat per month, and the $20 Starter is gone after ~25 chats. A first-time user who connects Slack and asks two questions has burned the trial before they reach the "aha."
2. A 1,000-employee company on the Business plan pays $200/mo — $0.20 per employee per year. Glean for the same org base-prices at $129K+/yr. We were leaving 50× on the table for the customers that should be paying us the most.
3. The product's deployment shape — a handful of dashboard admins enable a bot that serves the entire workspace via Slack / Teams / Google Chat — is fundamentally not per-seat. Per-seat pricing undercounts the actual reachable population by 10-50×.

The full proposal, competitive anchors (Onyx, Glean, Viktor), and resolved open questions live in [RFC 0010](../rfcs/0010-workspace-credit-pool-pricing.md). This ADR captures the load-bearing call.

## Decision

Move to a **flat platform fee + workspace-shared credit pool** model. No per-seat charges. One workspace = one pool. The platform fee covers the product's non-usage value (hosting, connectors, security features, support); the credit pool covers usage (sync, embeddings, agent runs).

The new ladder:

| Tier | Platform fee | Default pool | Gates |
|---|---|---|---|
| Free trial | $0, no card | 500K credits, 14-day window | 1 connector, 1 destination |
| Starter | $99/mo | 250K/mo | 5 connectors, 1 destination |
| Team | $499/mo | 2M/mo | unlimited connectors, all destinations |
| Business | $1,999/mo | 10M/mo | + SSO, RBAC, audit log, perm inheritance |
| Enterprise | from $5K/mo, custom | custom | + DPA, SLA, dedicated CSM |

Inside Starter / Team / Business, customers can buy one-shot **credit top-ups** any time to add to their pool — three fixed sizes (Small 200K / $50, Medium 1M / $200, Large 3M / $500) with mild volume discount. Top-ups are `mode: 'payment'` Stripe Checkout (not subscriptions), so they're reversible and don't disturb recurring billing. Top-up credits roll over indefinitely. Annual prepay on the base tiers = 20% off across the board.

*(The initial draft had a Light / Heavy / Always-on subscription dropdown inside each tier; replaced with top-ups for speed-to-ship and reversibility. See "Status of related changes" below.)*

Two supporting changes ship with the new ladder:

- **Credit unit redenominated 100×.** A chat goes from "20,100 credits" to "~200 credits." Same economics, very different psychology on the usage screen. Existing customers migrate by multiplying both pool size and consumed amount; their bills don't move.
- **Two visual meters over one pool.** `/settings/billing` shows Indexing (sync) and Agent-runs (run) as separate progress bars, both depleting the same shared balance. Prevents the "I connected Slack and burned my whole month's budget" panic and unlocks honest "your runs are 80% of your pool" prompts.

## Consequences

**Positive:**
- ACVs land in Glean's zip code for companies that roll out the bot widely (a 240-employee company actively using the bot runs ~58M credits/mo → Business with a larger pool ~$8K–15K/mo = $96K–$180K ARR), without forcing Glean-style 100-seat-minimum sales cycles on the small-team buyer.
- Self-correcting via usage: a customer's *actual* rollout determines what they pay. Wider Slack deployment → bigger pool → higher tier. No upfront seat prediction or true-up reconciliation.
- The Slack / Teams / Chat install moment becomes a clean conversion trigger — we can read workspace member count via the destination APIs and surface a one-time, soft upgrade banner.
- Trial that actually demonstrates value: 500K credits + 14 days lets a prospect connect, backfill, and ask 25+ questions before the trial gate trips.
- Stripe + credit ledger don't need restructuring — only new products, a unit migration, and a category column on existing tables.

**Negative:**
- Smaller ACVs from companies that would have signed a $129K+ Glean contract — buyers expecting a sales touch can self-serve up to Business. Mitigated by the "Talk to sales" CTA on Business + Enterprise. Net positive at our stage; revisit once we have 50+ paying customers and can compare CAC payback by motion.
- Forever-free tier goes away at launch. Loses some top-of-funnel SEO ("free Slack AI bot"). Reintroduce in 90 days if paid-conversion data shows the infra cost of a true free tier is sustainable (1 connector, 50K credits/mo, no expiry).
- More tier complexity than Viktor's single $50/mo flat plan (4 paid tiers + dropdown). Worth it because it lets us gate SSO/RBAC/audit at the tier that pays for them — features we've already built and aren't monetizing.
- Reachable-headcount detection on Teams requires `User.Read.All` or `Directory.Read.All` Graph scopes at install. Admins can deny; we fall back to a self-report banner. Slack and Google Chat expose member counts without extra scopes.
- Pricing-page rewrite touches both `apps/web/app/settings/billing` and the marketing site at `holobase.dev` — two-surface coordination during rollout.

## Status of related changes

- Implementation backlog with day-sized tickets seeded in [RFC 0010 § Implementation backlog](../rfcs/0010-workspace-credit-pool-pricing.md#implementation-backlog).
- Rollout order: Stripe products → credit-unit migration → ledger category → exhaustion middleware → billing UI → bot-destination states → marketing page → trial signup flow. Soft-launch on one design-partner org before flipping the public page.
- Existing customer migration: multiply pool size + consumed amount by 100 at cutover. No visible bill change. Communicated via in-app banner + email a week before the migration.

### 2026-05-20 amendment: top-ups instead of pool-size variants

**Original:** the proposal called for a Light / Heavy / Always-on dropdown inside each paid tier — each option a separate recurring Stripe Price.

**Amended to:** one-shot credit top-up purchases customers can stack on any tier (Small / Medium / Large). Top-ups are `mode: 'payment'` Checkout Sessions, not subscriptions.

**Why amended:**
1. Variants required 9 recurring Stripe SKUs (3 tiers × 3 sizes), a new `billing_plan_variants` table, a new FK on `organization_subscriptions`, and provisioning/checkout/webhook forks — a 1–2 week build for an unproven assumption about how customers want to be priced.
2. Top-ups ship in hours: one table, one one-shot Stripe Price per package, one checkout endpoint, one webhook branch. Already done in B1.3 — see RFC 0010.
3. Top-ups are reversible: refund a charge, archive a SKU, change a price — all without touching live subscriptions. Variants are sticky: once customers are on `team-heavy` subs, migrating off is painful.
4. The "scale with rollout" story still works. A widely-deployed Slack bot burns credits → customer keeps hitting the top-up button → top-up fatigue naturally drives the tier upgrade (Starter → Team), which is where the real ARR lift lives. Top-ups are the canary, not the destination.

**What stays the same:** the four-tier ladder (Free trial / $99 Starter / $499 Team / $1,999 Business / Enterprise), the platform-fee model, the workspace-shared credit pool, the credit-unit redenomination plan, the two-meter UI, the trial mechanics, and the Slack-install conversion moment.

**Revisit trigger:** if usage data shows customers want monthly commitment over ad-hoc top-ups (signal: repeat-buyers buying the same size 3+ months in a row, or sales feedback that "we need predictable monthly credits"), reintroduce variants as a complement to top-ups — not a replacement.

## References

- [RFC 0010](../rfcs/0010-workspace-credit-pool-pricing.md) — full design, competitive anchors, resolved open questions, and implementation backlog
- [DESIGN.md](../../DESIGN.md) — billing UI must use the tokens defined here; no ad-hoc colors / radii
- [CLAUDE.md](../../CLAUDE.md) — pricing page lives on `holobase.dev`, not `holo.dev`
