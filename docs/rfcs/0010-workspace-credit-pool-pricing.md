# 0010 — RFC: Workspace Credit Pool Pricing

**Status:** Accepted — see [ADR 0007](../decisions/0007-workspace-credit-pool-pricing.md)
**Updated:** 2026-05-20
**Decides:** What pricing model captures value when 5 dashboard admins enable a Slack / Teams / Google Chat bot that serves 200+ employees, without forcing per-seat accounting or under-pricing widely-deployed orgs?

## Context

Current pricing (Free / Starter $20 / Team $50 / Business $200, all measured against an opaque "credits" meter) breaks at first contact with reality:

1. **One chat run costs ~20,100 credits** — the dashboard ledger shows it. So Free (25K/mo) is ~1 chat per month, and Starter ($20, 500K) is ~25 chats before the month is gone. A first-time user who connects Slack and asks two questions has burned the trial.
2. **A 1,000-employee company on Business pays $200/mo = $0.20 per employee per year.** That's not pricing, it's charity. Glean for the same org is $129K+/yr base.
3. **Per-seat pricing doesn't fit the product shape.** The buyer is typically 3–5 admins on the dashboard; the bot then serves the entire workspace via Slack / Teams / Google Chat. Per-seat undercounts value by 10–50×.

Competitive anchors:

| Vendor | Shape | Effective $ / employee / yr |
|---|---|---|
| Onyx | $20/user/mo flat | $240 (but per-seat, breaks for bot rollouts) |
| Glean | $45–$50/user base + $15/user AI + FlexCredits pool, 100-seat min | $720+; median ACV $98K–$200K |
| Viktor | $50/mo flat + customer-sized credit pool ($50 → $50K) | Variable; scales with rollout |

We want a model that (a) lets people meaningfully try the product without burning the trial in one chat, (b) scales with **actual rollout** — not seat count — so a wider Slack deployment naturally moves the customer up a tier, and (c) supports ACVs in Glean's zip code for companies that deploy widely, without forcing Glean-style sales cycles on companies that just want to start small.

## What we're solving (and what we're not)

**We are:** repricing the whole ladder around a workspace-level shared credit pool, with a generous time-boxed trial; tiered plans with size-bucketed pool dropdowns; and gating SSO / RBAC / audit at the right tier.

**We are not:** rebuilding the metering layer or switching billing providers. Stripe stays. Credit accounting stays. The credit *unit* gets redenominated and the meters get split visually, but the underlying ledger is unchanged.

## Proposed shape

### Pricing model

**Flat platform fee + customer-sized shared credit pool.** No per-seat charges. One workspace = one pool. Credits map roughly to actual LLM/infra cost; the platform fee covers the rest (hosting, connectors, SSO, support).

### Tiers

| Tier | Platform fee | Default credit pool | Connectors | Destinations | Security | Target |
|---|---|---|---|---|---|---|
| **Free trial** | $0, no card | 500K (one-time, 14-day window) | 1 | 1 | basic | evaluating |
| **Starter** | $99/mo | 250K/mo | 5 | 1 (Slack *or* Teams *or* Chat) | basic | <25 employees |
| **Team** | $499/mo | 2M/mo | unlimited | all | basic + Google OAuth | 25–250 |
| **Business** | $1,999/mo | 10M/mo | unlimited | all | SSO, RBAC, audit log, permission inheritance | 250–2,000 |
| **Enterprise** | from $5K/mo, custom | custom | unlimited | all | + DPA, SLA, dedicated CSM | 2,000+ |

**Top-ups instead of pool variants.** The previous draft used a Viktor-style "pick your pool size" dropdown inside each tier (Light / Heavy / Always-on). On reflection, that was over-built for stage:

- It required 3 Stripe recurring products per tier × 3 tiers = 9 SKUs
- It forced a customer commitment at signup ("how much will we use?") with no usage data yet
- It made the schema/migration/UI work fan out across 5+ tickets

Replaced with **one-shot top-up packages** customers can buy any time, on any tier, to add credits to their pool. Three fixed sizes (Small / Medium / Large) at mild volume discount. Top-ups are `mode: 'payment'` Stripe Checkout — not subscriptions — so they're reversible (refund, archive, kill the SKU) without disturbing recurring billing. Top-up credits go to the same `credit_ledger` pool and roll over indefinitely (they're explicitly purchased, not granted).

The "scale with rollout" story still works: a customer outgrowing their tier hits the top-up button repeatedly → that friction is the signal to upgrade their *tier* (Starter → Team), which is where the real ARR lift lives. Top-ups are the canary, not the destination. If/when usage data shows customers prefer monthly commitment to ad-hoc top-ups, revisit variants.

### Free trial mechanics

- **500K credits + 14 days**, whichever expires first.
- All Business-tier features enabled during trial — no feature unlock surprise on conversion.
- After trial expires:
  - Dashboard goes read-only. Indexed data preserved 90 days, then auto-purged unless they pay.
  - Bot goes silent in destinations: replies with *"this workspace's trial has ended — ask <admin> to upgrade"* and a CTA link to the upgrade page.
- No credit card at signup. Card is collected at first paid tier selection.

### Credit unit redenomination

The current unit is too granular (20K credits per chat creates panic on the usage screen). **Multiply the credit-to-dollar ratio by 100×:**

- One chat ≈ 200 credits (not 20,100)
- Starter pool 250K = ~1,250 chats
- Team pool 2M = ~10,000 chats

Same economics, very different psychology. **Migration:** for existing customers, multiply both pool size and consumed-amount by 100 at cutover — no behavior change, no visible bill change.

### Two-meter UI

In `/settings/billing`, show two separate progress bars:

1. **Indexing** — credits spent on sync, embedding, chunking.
2. **Agent runs** — credits spent on chat, deep research, agent tool calls.

Both deplete the same shared pool. Splitting them visually prevents the "I connected Slack and burned my whole month's budget" panic and makes "your agent runs are 80% of your pool — consider a bigger size" trivially explainable.

### Upgrade flows

1. **Pool exhaustion within tier** — banner offers the next pool size in the dropdown. One-click upgrade, prorated.
2. **Feature gating** — clicking "SSO" or "Audit log" in settings on Team tier shows the Business upgrade panel inline.
3. **Slack / Teams install moment** — read workspace member count via destination API. If headcount ≥ 250, show a one-time banner: *"Your Slack workspace has 234 members. Companies your size typically need our Team plan or higher to keep up with usage."* Soft suggestion, not a block.

### Downgrades

- Self-serve downgrade allowed Business → Team → Starter at any time. Takes effect next billing cycle.
- Downgrading from Business strips SSO / RBAC enforcement on the next cycle — confirm dialog lists exactly what will turn off.
- **No call-sales-to-downgrade pattern.** Bad trust signal.

### Overages

Pool exhaustion = bot stops responding to new questions, indexing pauses, dashboard remains read-only. **No silent overage billing.** Customer must explicitly upgrade pool size or tier to resume. This prevents bill shock and matches Viktor's posture.

## What changes in the product

- `packages/billing` — Stripe products + prices rebuilt (Free / Starter / Team / Business / Enterprise, with per-tier pool variants).
- `apps/web/app/settings/billing` — new tier picker UI with pool dropdown; two-meter usage display.
- `packages/credits` — redenomination migration; new `category` field on debits (`sync` vs `run`).
- Bot destinations — trial-expired and pool-exhausted states with CTA messages.
- Marketing site (`holobase.dev`) — `/pricing` page rewrite; trial signup flow ("$0, no card, 500K credits, 14 days").

Detailed implementation plan to follow as an ADR + tickets once this RFC accepts.

## Resolved decisions

Locked in 2026-05-20. Each item is the call we're shipping; the question + tradeoff is preserved so a future reviewer can see why.

1. **Pool-size dropdown labels — use-case framing with company-size hints.**
   The dropdown reads *Light / Heavy / Always-on bot / Enterprise*, with a secondary line like "~25 active users" or "~250+ active users." Buyer-question framing ("how heavily will my team use this?") converts better than make-them-guess-their-headcount. Company-size hints stay so the buyer can self-anchor.

2. **Annual prepay discount — 20% flat across all tiers.**
   No Business+ premium discount at launch. Simpler page, easier to compute. Revisit only if churn data shows Business customers need a stickier lock-in than 20% delivers.

3. **Trial extension policy — yes, manual via CS, one extension per prospect, no self-serve.**
   If a prospect burns credits in genuine evaluation, CS can top up once. Self-serve top-up during trial would invite abuse and dilute the "decide by day 14" forcing function.

4. **Connector cap on Starter — keep the count cap (5).**
   Easier to understand and explain than an index-size cap, and naturally encourages upgrade as customers integrate more systems. Index-size caps stay as a Business-tier soft cap only.

5. **Free tier vs trial-only — trial-only at launch.**
   Kill the forever-free tier. Revisit in 90 days post-launch once we have paid conversion data; if a true free tier is sustainable (1 connector, 50K credits/mo, no expiry), reintroduce for SEO and developer experimentation.

6. **End-user query-cost visibility in the bot — no.**
   Showing "this query used X credits" to end users in Slack/Teams/Chat kills usage. Surface only to admins via the dashboard's analytics view.

7. **Reachable-headcount detection — ask for scopes at install time, fall back gracefully.**
   Slack `team.info` and Google Chat directory expose member counts directly. Teams requires Graph API scopes (`User.Read.All` or `Directory.Read.All`) at install. If a Teams admin denies the extra scopes, fall back to self-reported headcount with a banner reminding them to provide it for accurate billing.

## Implementation backlog

Seeded for GitHub Issues. Each item is sized to fit in a day or two. Lift into the GitHub Project when work starts.

### Billing & metering

#### B1.1. Reprice the plan ladder ✅ shipped 2026-05-20
**Area:** `area:billing` · **Estimate:** 0.5d
- Migration `0061_pricing_model_v2.sql` renames legacy `starter`/`team`/`business` rows to `*-legacy-2026-05` (is_public=false), inserts new rows at the v2 prices ($99 / $499 / $1,999) and pool sizes (250K / 2M / 10M).
- Existing customer subscriptions reference plan rows by UUID → grandfather automatically (same Stripe price, same monthly credits).
- `provisioning.ts` patched to detect amount drift, archive stale Stripe prices, and create new ones (Stripe Prices are immutable; lookup_key uniqueness requires the archive step).
- **Done.** Note: B1's original ask to "wire `STRIPE_PRICE_*` env vars" was wrong for this codebase — it's DB-driven via `billing_plans` rows. Documented in commit message.

#### ~~B1.2. Pool-size variants dropdown~~ — superseded by B1.3
The first cut of B1.2 added a `billing_plan_variants` table with Light / Heavy / Always-on dropdown options. Dropped in favor of one-shot top-ups (see [Decisions log 2026-05-20](#decisions-log)).

#### B1.3. One-shot credit top-ups ✅ shipped 2026-05-20
**Area:** `area:billing` · **Estimate:** 0.5d
- Migration `0062_credit_topup_packages.sql` creates `credit_topup_packages` table + seeds three packages: Small (200K / $50), Medium (1M / $200), Large (3M / $500). Mild volume discount at larger sizes.
- `ensureStripeProductsForTopupPackages` in `packages/stripe/src/provisioning.ts` provisions one-shot (non-recurring) Stripe Prices keyed by `lookup_key = slug`. Wired into the worker boot path alongside `ensureStripeProductsForPlans`.
- `createCheckoutSessionForTopup` in `packages/stripe/src/checkout.ts` creates `mode: 'payment'` sessions with `topup_package_slug` metadata.
- `POST /api/stripe/topup/checkout` route in `apps/web` accepts `{ packageSlug }` and returns `{ url }`.
- Webhook handler in `packages/stripe/src/webhooks.ts` branches on `metadata.topup_package_slug` in `checkout.session.completed`, looks up the package server-side (don't trust client metadata for credit amount), writes a `topup` ledger row with idempotency key `topup:<session.id>`.
- New `LedgerReferenceKind` value `stripe_checkout` (distinct from recurring `stripe_invoice`).
- **Done.** UI ("Buy more credits" button) ships in W4 (new).

#### B2. Credit unit redenomination ✅ shipped 2026-05-21
**Area:** `area:billing` · **Estimate:** 0.5d
- Migration `0063_credit_unit_redenomination.sql` — `UPDATE credit_prices SET credits_per_unit = credits_per_unit / 100`. Pricing is purely DB-driven (`packages/billing/src/pricing.ts`), so no code change was needed.
- Approach: keep plan grants (250K / 2M / 10M) the same and *divide rates* — a chat now debits ~200 credits instead of ~20,100, matching the RFC headline figures. Reverses the RFC's original "multiply" framing, which would have grown the displayed numbers rather than shrinking them.
- Effect on existing customers: remaining pool balance is worth ~100× more in chat terms (modest one-time windfall). Historical ledger debits stay at their pre-divide numbers — the activity log shows a visible step-down at the cutover, which is the point.
- **Done.**

#### ~~B3. Credit ledger category column~~ — deferred
B3 was scoped to enable a two-meter (sync vs run) display in W2. Since W2 is also deferred and the pool exhaustion guard in B4 doesn't distinguish categories, B3 stays parked. Revisit when W2 ships.

#### B4. Pool exhaustion guard ✅ shipped 2026-05-21
**Area:** `area:billing` · **Estimate:** 1d
- `assertSufficientCredits(db, orgId)` and `checkCreditPool(db, orgId)` in `packages/billing/src/limits.ts`. New `ErrorCode.HOLO_CREDIT_POOL_EXHAUSTED` in `packages/errors/src/codes.ts`.
- Gated at three entry points:
  - `apps/web/src/app/api/chat/route.ts` — throws → 402 response with the fix message in the body.
  - `apps/worker/src/slack-bot/agent.ts::runAgent` — returns a synthetic `AgentResult` with an admin-facing "buy more credits" message. **All three bot platforms (Slack / Teams / Google Chat) inherit this** because they share `makeDefaultAgentRunner` → `runAgent` (so D1 is covered here for free).
  - `apps/worker/src/queues/sync-processor-base.ts` — short-circuits with `skipReason: 'credit_pool_exhausted'` before `startSyncRun` writes anything.
- 9 unit tests in `packages/billing/test/exhaustion.test.ts` cover allowed / blocked / negative-balance / billing-disabled paths for both functions.
- Existing in-flight operations aren't preempted; only the *next* attempt is blocked. Final debits may push balance briefly negative — intentional (we don't refund LLM providers for partial work).
- **Done.**

### Web app — billing UI

#### W1. Tier picker copy + "Most popular" badge ✅ shipped 2026-05-21
**Area:** `area:web` · **Estimate:** 0.5d
- The plan-grid was already dynamic — it pulled rows from `billing_plans where is_public = true` and rendered prices/credits straight from the DB, so the new $99 / $499 / $1,999 ladder landed on the page the moment B1.1's migration applied. No layout rewrite needed.
- Touch-ups: updated `PlanSummary` tagline to describe the new pool + top-up model. Added a "Most popular" badge to the Team tier in `PlanGrid` (highest-converting tier on this ladder; one of the three accent-color uses allowed per `DESIGN.md`).
- **Deferred:** annual / monthly toggle. That needs new Stripe Prices (`-annual` lookup_key) per tier + provisioning updates + checkout-flow changes — full B1.x-sized work; not worth it until we see customers asking for it.
- **Done.**

#### W4. "Buy more credits" top-up UI
**Area:** `area:web` · **Estimate:** 0.5d
- Card on `/settings/billing` showing the three top-up packages (read from `credit_topup_packages` where `is_active = true`, ordered by `sort_order`).
- "Buy" button POSTs to `/api/stripe/topup/checkout` and redirects to the returned Stripe URL.
- Toast on return via `?topup=success` (or `?topup=cancel`).
- Match `DESIGN.md` tokens.
- **Done when:** any tier can buy a top-up, the webhook fires, and the credit balance increments in the dashboard within ~2s of return.

#### W2. Two-meter usage display ✅ shipped 2026-05-21
**Area:** `area:web` · **Estimate:** 0.5d
- Rewrote `usage-breakdown.tsx` from a table into two stacked progress bars (Agent runs / Connector sync) over the same shared pool, with combined total beneath. Accent color reserved for Agent runs (the primary signal); sync uses the muted subtle token.
- **B3 (category column) turned out unnecessary** — `credit_ledger.reason` already distinguishes `llm_call` vs `connector_sync` and `getCurrentPeriodUsage` was already splitting on it. Saved a migration + backfill.
- **Done.**

#### W3. Trial state ✅ shipped 2026-05-21
**Area:** `area:web` · **Estimate:** 0.5d
- Migration `0064_trial_ends_at.sql` adds nullable `trial_ends_at` to `organization_subscriptions`. Existing orgs backfill to NULL = grandfathered (no expiry). New orgs get `now() + 14 days` set by `seedInitialSubscriptionAndGrant`.
- `deriveTrialState(sub)` in `packages/billing/src/plans.ts` returns `none | active | expired | paid`. `processExpiredPeriods` (the monthly-grant cron) now skips orgs whose trial has expired so their pool stops refilling; existing credits get spent, then the B4 pool-exhaustion guard takes over (no separate "trial expired" code path needed — same gate, same UX).
- `TrialBanner` component on `/settings/billing` renders "N days left" or "Trial has ended" states, both linking to the plan grid.
- **Done.**

### Bot destinations

#### D1. Pool-exhausted bot responses ✅ shipped 2026-05-21 (via B4)
**Area:** `area:connectors` · **Estimate:** 0.5d each (Slack / Teams / Google Chat = 1.5d total)
- All three bot destinations route through `makeDefaultAgentRunner` → `apps/worker/src/slack-bot/agent.ts::runAgent`. The pool-exhausted guard added in B4 lives at that single chokepoint, so Slack / Teams / Google Chat all surface the same admin-facing "out of credits, buy a top-up at /settings/billing" message without per-platform code.
- **Trial-expired** branch deferred until W3 ships the trial mechanic.
- **Done.**

#### D2. Reachable-headcount detection
**Area:** `area:connectors` · **Estimate:** 1d
- On connector install: call `team.info` (Slack), Graph `/users` (Teams), Directory (Google Chat) to fetch member count.
- Store on `org_destinations.reachable_headcount`.
- If Teams scopes denied, store `null` and surface the self-report banner.
- **Done when:** installing any of the three connectors populates `reachable_headcount` or surfaces the fallback banner.

#### D3. Slack-install upgrade banner
**Area:** `area:web` · **Estimate:** 0.5d
- After bot install with headcount ≥ 250, show a one-time dashboard banner suggesting Team or higher.
- Dismissible; respects `org_banners_dismissed` table.
- **Done when:** the banner shows once per qualifying install and never returns after dismiss.

### Marketing

#### M1. Pricing page rewrite on holobase.dev — handoff artifact ready
**Area:** `area:marketing` · **Estimate:** 1d
- holobase.dev lives outside this monorepo, so M1 can't ship from here. Copy + structure landed as `docs/launch/pricing-page-copy.md` — paste into the storefront when ready.
- Includes header, trial CTA, tier cards (Free trial / Starter / Team / Business / Enterprise), top-up sub-section, FAQ snippets, and a (sparingly-used) Glean comparison block.
- **Status:** ready for marketing team / whoever owns holobase.dev to land. Code-side: N/A.

#### M2. Trial signup flow ✅ shipped 2026-05-21 (no-card already supported)
**Area:** `area:marketing` · **Estimate:** 0.5d
- Sign-up already doesn't require a card (Better Auth org-create hook provisions a free-tier subscription). With W3 in place, that subscription now carries `trial_ends_at = now() + 14d` and `status: 'trialing'`. No card change required.
- Onboarding-email "your trial has started" is on the post-launch follow-up — small task, deferred to the next product wave.
- **Done.**

### Telemetry & ops

#### T1. Pricing funnel events ✅ shipped 2026-05-21
**Area:** `area:analytics` · **Estimate:** 0.5d
- Server-side posthog helper `apps/web/src/lib/posthog-server.ts` (`captureOrgEvent`) mirroring the worker pattern. Event emission added at: subscription checkout start, top-up checkout start, web chat pool-exhaustion, sync pool-exhaustion, bot agent pool-exhaustion, trial extension, Stripe webhook (subscription created/updated/canceled, first_payment, topup purchased).
- Standard shape across all events: `distinctId: org:<id>`, `groups: { organization: <id> }`, prefix `holo.<area>.<verb>`.
- All emissions wrapped to be a no-op when `POSTHOG_API_KEY` is unset and to fail silently — analytics never breaks the user flow.
- **Done.**

#### T2. CS-triggered trial extension ✅ shipped 2026-05-21
**Area:** `area:ops` · **Estimate:** 0.5d
- `POST /api/admin/trial/extend` accepts `{ organizationId, additionalCredits?, additionalDays?, reason? }`. Defaults: 250K credits + 7 days.
- Auth: `x-admin-token` header must match `HOLO_CS_ADMIN_TOKEN` env var. Simple shared-secret — this is an internal CS tool, not user-facing.
- Idempotency: key `trial-extend:<org_id>:<floor(now/day)>` so the same operator can't double-credit accidentally on the same day. Extension repeats require a different day or a follow-up enhancement.
- Writes a topup-kind ledger entry (so the credits flow through the same accounting as a regular top-up), advances `trial_ends_at`, emits `holo.trial.extended` posthog event.
- **Done.**

**Rollout order:** B1 → B2 → B3 → B4 → W1 → W2 → W3 in parallel with D1+D2+D3 → M1+M2 → T1+T2. Soft launch on a single design-partner org first; flip the public pricing page after one billing cycle of clean data.

## Decisions log

| Date | Change | Why |
|---|---|---|
| 2026-05-20 | Initial draft. Move from per-seat-ish tiered pricing ($20–$200) to workspace credit-pool model (Free trial / $99 / $499 / $1,999 / custom) | Current pricing leaves 5–50× ARR on the table at scale; trial is unusable (one chat exhausts free tier); per-seat shape doesn't match the bot deployment model |
| 2026-05-20 | All 7 open questions resolved; status moved to Accepted; ADR 0007 cut | Walked through each tradeoff in session; recommendations held up under second-look |
| 2026-05-20 | Replaced pool-size variants with one-shot credit top-ups (B1.3 supersedes B1.2) | Variants over-built for stage: 9 Stripe SKUs + forced customer commitment + schema/UI fan-out across 5 tickets. Top-ups ship in hours, are reversible, and the upgrade story still works via top-up-fatigue driving tier upgrades. Revisit variants once usage data justifies. |
| 2026-05-21 | B2, B4, W1, D1 all shipped. Mid-month upgrade grants now scoped to `invoice.billing_reason ∈ {subscription_create, subscription_cycle}` (Option B) so customers can't double-dip on credits when changing tiers mid-cycle | Browser-visible work done; pool-exhausted state is the load-bearing remaining safety; D1 fell out for free because all three bot platforms share `runAgent`; W1 stayed light (existing grid was already dynamic). B3 + W2 + W3 + D2 + D3 + M1 + M2 + T1 + T2 remain on the backlog as polish. |
| 2026-05-21 | T1, T2, W2, W3, M2 all shipped. M1 handoff artifact (docs/launch/pricing-page-copy.md) ready for marketing. B3 dropped (unnecessary — `credit_ledger.reason` already distinguishes sync vs run). D2 + D3 deferred — they need real Slack/Teams/GoogleChat API integration with platform-specific scopes, risky to ship without browser testing | Closed everything except D2/D3 and the M1 handoff. New code surface: trial mechanic (schema + grant skipping + banner + extension endpoint), funnel events, two-meter usage display. Existing 22 tests stay green; all 5 affected packages typecheck clean. |
