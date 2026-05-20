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

#### B2. Credit unit redenomination migration
**Area:** `area:billing` · **Estimate:** 0.5d
- Drizzle migration `00NN_credit_unit_redenomination.sql` — multiply `org_credit_balances.pool_size`, `consumed`, and every row in `credit_ledger.amount` by 100.
- Migration `_journal.json` entry (per `feedback_drizzle_handauthored_migrations.md` — Drizzle's runner ignores SQL not registered in the journal).
- Update `creditUnitDollarRatio` constant in `packages/credits/src/constants.ts`.
- **Done when:** existing test fixtures still pass with `× 100` applied; usage screens render unchanged dollar amounts.

#### B3. Credit ledger category column
**Area:** `area:billing` · **Estimate:** 0.5d
- Add `category` enum `('sync', 'run')` to `credit_ledger`.
- Backfill from existing debits: `sync` = anything sourced from `packages/sync-scheduler`; `run` = anything sourced from `packages/agent-tools` or `packages/chat`.
- Update both call sites to set the category on new debits.
- **Done when:** new debits land with non-null categories and the backfill SQL is in the migration journal.

#### B4. Pool exhaustion + read-only mode
**Area:** `area:billing` · **Estimate:** 1d
- Middleware in `apps/api/src/middleware/credit-guard.ts` that returns `HOLO_CREDIT_POOL_EXHAUSTED` on any `category='run'` write when the pool is at zero.
- `category='sync'` pauses sync scheduler runs with the same error.
- Dashboard reads remain allowed.
- **Done when:** integration test in `packages/credits/test/exhaustion.test.ts` covers both paths.

### Web app — billing UI

#### W1. New tier picker page
**Area:** `area:web` · **Estimate:** 1d
- Rewrite `apps/web/app/settings/billing/page.tsx` with the 4-tier card layout per the table above.
- Annual / monthly toggle.
- "Talk to sales" CTA on Business + Enterprise.
- Match `DESIGN.md` tokens; no ad-hoc hex or radius values.
- **Done when:** `/settings/billing` renders all four tiers and the upgrade CTA hits the new Stripe products from B1.1.

#### W4. "Buy more credits" top-up UI
**Area:** `area:web` · **Estimate:** 0.5d
- Card on `/settings/billing` showing the three top-up packages (read from `credit_topup_packages` where `is_active = true`, ordered by `sort_order`).
- "Buy" button POSTs to `/api/stripe/topup/checkout` and redirects to the returned Stripe URL.
- Toast on return via `?topup=success` (or `?topup=cancel`).
- Match `DESIGN.md` tokens.
- **Done when:** any tier can buy a top-up, the webhook fires, and the credit balance increments in the dashboard within ~2s of return.

#### W2. Two-meter usage display
**Area:** `area:web` · **Estimate:** 0.5d
- Two progress bars on `/settings/billing/usage`: Indexing (sync category) and Agent runs (run category).
- Both deplete the shared pool; show the combined total below.
- Tooltip explains the split.
- **Done when:** the bars sum to the consumed amount of the pool and the colors come from `DESIGN.md`.

#### W3. Trial state UI
**Area:** `area:web` · **Estimate:** 0.5d
- Banner on every dashboard page during trial: "X days left · Y credits remaining."
- After expiry: read-only banner with upgrade CTA; index data retention countdown ("data preserved for 90 days").
- **Done when:** banners render correctly in trial / expired states and the upgrade CTA flows to W1.

### Bot destinations

#### D1. Pool-exhausted + trial-expired bot responses
**Area:** `area:connectors` · **Estimate:** 0.5d each (Slack / Teams / Google Chat = 1.5d total)
- All three bot destinations check `credit-guard` before responding to a new message.
- If exhausted/expired: post the templated message with an admin CTA link to `/settings/billing`.
- **Done when:** unit tests in `packages/connectors/test/{slack,teams,googleChat}-bot-states.test.ts` cover both states.

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

#### M1. Pricing page rewrite on holobase.dev
**Area:** `area:marketing` · **Estimate:** 1d
- Public `/pricing` page mirroring the 4-tier layout from W1 (read-only — no Stripe call).
- "Start free trial — no credit card" CTA flowing to signup.
- Comparison table vs Onyx / Glean (light touch, factual).
- **Done when:** the page is live at https://holobase.dev/pricing and matches W1's visual structure.

#### M2. Trial signup flow
**Area:** `area:marketing` · **Estimate:** 0.5d
- Strip the credit-card requirement from `/signup`.
- On account creation: provision 500K credit pool with 14-day expiry.
- Send a "your trial has started" email with first-connector setup link.
- **Done when:** end-to-end signup → first-connector takes <60s with no card.

### Telemetry & ops

#### T1. Pricing funnel events
**Area:** `area:analytics` · **Estimate:** 0.5d
- New events: `trial.started`, `trial.expired`, `pool.exhausted`, `tier.upgraded`, `tier.downgraded`, `dropdown.pool-size-changed`.
- Wire into `packages/analytics`.
- **Done when:** events show up in the analytics dashboard with org_id + tier dimensions.

#### T2. CS-triggered trial extension
**Area:** `area:ops` · **Estimate:** 0.5d
- Internal admin endpoint `POST /admin/orgs/:id/trial-extend` (CS auth only).
- Adds 250K credits + 7 days, max once per org.
- Audit log entry.
- **Done when:** the endpoint is callable from the internal admin UI and the audit log captures who extended.

**Rollout order:** B1 → B2 → B3 → B4 → W1 → W2 → W3 in parallel with D1+D2+D3 → M1+M2 → T1+T2. Soft launch on a single design-partner org first; flip the public pricing page after one billing cycle of clean data.

## Decisions log

| Date | Change | Why |
|---|---|---|
| 2026-05-20 | Initial draft. Move from per-seat-ish tiered pricing ($20–$200) to workspace credit-pool model (Free trial / $99 / $499 / $1,999 / custom) | Current pricing leaves 5–50× ARR on the table at scale; trial is unusable (one chat exhausts free tier); per-seat shape doesn't match the bot deployment model |
| 2026-05-20 | All 7 open questions resolved; status moved to Accepted; ADR 0007 cut | Walked through each tradeoff in session; recommendations held up under second-look |
| 2026-05-20 | Replaced pool-size variants with one-shot credit top-ups (B1.3 supersedes B1.2) | Variants over-built for stage: 9 Stripe SKUs + forced customer commitment + schema/UI fan-out across 5 tickets. Top-ups ship in hours, are reversible, and the upgrade story still works via top-up-fatigue driving tier upgrades. Revisit variants once usage data justifies. |
