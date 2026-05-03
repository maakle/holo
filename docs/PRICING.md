# Pricing

> **Status:** Placeholder. Real numbers arrive after v0.1 has paying-signal conversations.

## Self-hosted (always free)

`docker compose up` and `npx holo init` give you the same holo that runs in our cloud. **AGPL-3.0. No "open core" gating** — every feature in this repo is in the self-hostable build, including:

- All connectors (Slack, GitHub, Notion, Grain, Pylon, HubSpot at v0.1; more to come)
- Hybrid search across every ingested source
- Skill synthesis + skill marketplace browse + publish
- Agent observability dashboard with replay diff
- MCP server + REST/OpenAPI surface

If you self-host, you pay for your own infrastructure (Postgres, Redis, an LLM API key) and your own time. Holo itself is free.

## Managed cloud (coming in v0.2)

When v0.2 ships, we'll offer hosted holo for teams that want the product without the self-host operational burden.

**Likely pricing model** (placeholder, subject to validation with v0.1 users):

| Tier | Target | Likely price | What you get |
|------|--------|-----|--------------|
| **Free** | Solo devs, evaluation | $0 | 1 connector, 1 agent, 1 GB ingestion, community Slack |
| **Team** | 30–80-person companies (the wedge ICP) | **~$20–50 / agent / month** OR **~$200–500 / org / month flat** | Unlimited connectors, unlimited agents, ingestion up to ~50 GB, email support, SOC 2 (when ready) |
| **Enterprise** | Larger orgs with compliance asks | Custom | SSO, custom data-residency region, audit log export, dedicated support, SLA |

**Why "per-agent" or "per-org flat" instead of per-seat:**
Holo's value is grounding *agents*, not human users. A single CTO might run 5 agents and spawn the value of a 50-person team. Per-seat pricing punishes the buyer-builder-sufferer collapse that makes holo's wedge work. Per-agent or per-org aligns price with the value lever.

**Why a free tier:**
The OSS adoption story is the wedge. Free tier on managed cloud lets devs evaluate without standing up infrastructure. They graduate to paid when they have 2+ agents in production.

## Pricing principles (load-bearing for any future pricing decision)

1. **Self-host stays fully featured forever.** No "Enterprise edition" gating in the OSS build. The managed cloud is convenience-as-product, not feature-gating-as-product.
2. **Price aligns with value to the buyer, not cost to us.** Per-agent (or per-org flat) tracks what the buyer actually gets out of holo. Per-seat would punish multi-agent teams — exactly the ICP we want.
3. **Free tier never expires.** A free tier with a usage cap is fine. A free tier that converts to paid after 14 days is hostile.
4. **The marketplace is free for everyone, forever.** Skill marketplace publish + browse is part of the platform, not a tier feature. Network effects depend on it being free.
5. **Enterprise pricing is custom.** Don't publish enterprise prices; large customers have specific compliance and data-residency asks that don't fit a tier card.

## Open questions (resolve with v0.1 users)

- Per-agent vs. per-org flat — which does the buyer prefer? Likely per-org flat, because procurement is simpler.
- Ingestion cap — is "GB ingested per month" the right meter? Or "documents synced"? Or "MCP queries served"?
- Free-tier limit — 1 connector / 1 agent might be too restrictive for evaluation. Test with v0.1 users.
- SOC 2 timeline — managed cloud at non-SOC-2 is fine for early adopters; enterprise needs it. When?

These are decisions to make *with* the first paying customer, not decisions to lock in before talking to one.
