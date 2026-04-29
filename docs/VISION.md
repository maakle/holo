# Why Holo exists

Engineering teams are not building one custom AI agent. They're building several. A Slack-triggered Cursor agent that answers product questions from the codebase. A Notion-based agent that prepares interview rubrics from Grain recordings. A customer-success agent over support tickets and CRM data. Each agent solves a different workflow, and each one — quietly, expensively — re-implements its own context-fetching pipeline against the company's tools.

The cost is not the first agent. The cost is the second, third, and fifth. Every new agent is gated on a new integration. Cross-agent context (a sales-prep agent learning from a support-question agent's recent answers) is impossible because the context layer is a per-agent fork. When a Notion page moves or a Slack channel archives, every agent breaks individually.

Existing unified-search and "company brain" products tried to fix this with a search box. The search box is the wrong abstraction. Engineers don't want to query a company; they want their agents to *act* on a company's current state, with permissions intact, without rebuilding the retrieval layer for every new use case. The thing missing is not a place to look up information. It's a shared context layer the agents your team already runs can all point at.

Holo is that layer. A self-hostable context layer that ingests the tools your work actually lives in (Slack, GitHub, Notion, Grain, Pylon, HubSpot, more) and exposes a small MCP surface — search, fetch, recent-activity, ownership, change-detection — that any custom agent can call. One ingestion pipeline, many agents. Permissions preserved, provenance tracked, source-of-truth always the originating tool.

On top of the context layer, holo extracts the procedural knowledge that emerges from how a team has actually worked over thousands of past artifacts. Recurring agent behaviors — how a refund gets approved, how a security review unfolds, how an interview rubric gets applied — get distilled into MCP-invokable skills agents can call directly. Skills stay current as the procedures evolve. The team builds, the context layer watches, the skills accumulate.

The deployment is open-source and self-hostable, because no engineering team should send their entire company knowledge to a third party to make their agents work. The interface is MCP, because that's what every agent already speaks. The first user is the team that's already running custom agents and tired of writing the same retriever twice.

**Layer today, operating system tomorrow.** The context layer is the wedge. What grows on top of it — agent observability, replay, a marketplace where teams share anonymized procedural skills, drift detection between stated intent and actual artifacts — is the operating system that companies live in alongside their agents. Hu's RFS named this "AI Operating System for Companies." Blomfield's RFS named "Company Brain." Both are right; both are downstream of getting the context layer right first.

The companies that win the next decade will be the ones whose agents had the right context first. Holo is the context layer that makes that possible — for the agents your team is already shipping, and for the ones you haven't built yet.

— *Building this in public.*

The name is borrowed from the Star Wars *holocron* — a small object encrypted with knowledge from many sources, accessed by anyone with the right key. We shortened it to *holo*. The metaphor matches the product mechanic exactly: many sources of company context converging on one object that any agent on your team can call.
