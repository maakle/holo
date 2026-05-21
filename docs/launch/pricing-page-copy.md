# Marketing pricing page copy (M1)

**Status:** Ready to paste into the holobase.dev pricing page. The Next.js
monorepo here has no marketing surface — the storefront ships separately, so
this file is the handoff artifact rather than implemented code.

Below is the structure + copy to land on `holobase.dev/pricing`. Keep token /
spacing decisions consistent with `DESIGN.md`.

---

## Header

> ### Pricing that scales with how widely you deploy holo
>
> One workspace, one shared credit pool. Connect your tools, give your team a
> Slack / Teams / Google Chat bot, and pay for the credits everyone actually
> uses — not per-seat.

## Trial CTA

> **Start free — no credit card.**
> 14 days. 500K credits. Every feature unlocked. Bring your real data; the
> trial is built for it.
>
> `[ Start trial ]`     14 days · no card · 500K credits

## Tier cards (4 across, Team highlighted)

### Free trial

- $0 · no card
- **500K credits**, one time
- **14 days** full access
- 1 connector, 1 destination

> Bring a real dataset. Connect Slack, sync a Notion workspace, ask the bot
> 50 questions. If holo is useful, upgrade. If not, your data is preserved
> for 90 days post-trial.

### Starter

- **$99 / month**
- 250K credits / month
- 5 connectors
- 1 destination (Slack *or* Teams *or* Google Chat)

> For small teams running holo as a side workflow. Top-ups available any time.

### Team — *Most popular*

- **$499 / month**
- 2M credits / month
- Unlimited connectors
- All destinations (Slack + Teams + Google Chat)

> For growing companies. The bot serves everyone in the workspace; admins
> manage from the dashboard.

### Business

- **$1,999 / month**
- 10M credits / month
- Everything in Team
- SSO, RBAC, audit log, permission inheritance

> For organizations that need security review and the right paperwork.

### Enterprise

- Custom
- Unlimited credit pool
- DPA, SLA, dedicated CSM

> `[ Talk to sales ]`

## Credit top-ups (sub-section)

> ### Need more credits this month?
> Buy a top-up — added to your pool immediately, never expires.
>
> | Top-up | Credits | Price | Per 1K |
> |---|---|---|---|
> | Small | 200K | $50 | $0.25 |
> | Medium | 1M | $200 | $0.20 |
> | Large | 3M | $500 | $0.17 |

## FAQ snippets to include

**How do credits work?**
> Every chat turn and every artifact your connectors ingest costs credits.
> A typical chat is ~200 credits. Your monthly grant refills on your renewal
> date; unused credits don't roll over unless you bought them as a top-up.

**What happens if I run out of credits?**
> The bot pauses, sync pauses, the dashboard stays usable. Buy a top-up or
> upgrade your tier to resume — no overage billing, ever.

**Can I downgrade?**
> Yes, self-serve. The change takes effect next billing cycle.

**What about per-user pricing?**
> Per-user pricing punishes the wrong thing — broader Slack bot deployment
> shouldn't make holo more expensive per query. We charge for the credit pool
> your workspace uses; deploy as widely as you want.

---

**Comparison anchors (use sparingly, don't lead with this):**

> Holo vs Glean
>
> Glean prices per-user (~$45–50/user/month, 100-seat minimum, $100K+ ACVs).
> A 240-person company on holo Team pays $499/month for the *workspace*, with
> the bot serving everyone — about 26× cheaper at that scale.
>
> Honest tradeoff: Glean has deeper enterprise tooling and a longer track
> record. Holo is for teams that want the same value without the seat math.
