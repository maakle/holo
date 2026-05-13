# Licensing

Holo ships in two editions. Both live in this repository; what differs is the
license that governs each set of files.

| Edition | Who it's for | License | Location |
|---|---|---|---|
| **Community Edition (CE)** | Anyone — individuals, startups, in-house teams. Always free to self-host, fork, modify, and redistribute. | [MIT](./LICENSE) | Everything in this repo **except** `**/ee/**` |
| **Enterprise Edition (EE)** | Companies that need the EE-only governance, identity, and customization surfaces. Free to evaluate and develop against; production use requires a paid subscription. | [Enterprise License](./LICENSE-EE) | Anything under a directory named `ee/` |

If a file's path does not contain `/ee/`, it is MIT. If it does, it is EE.
There is no third tier.

---

## Community Edition (MIT) — what's always free

The Community Edition is the entire context-layer product: connectors, hybrid
search, MCP + REST gateway, the dashboard, the worker, OAuth provider, skill
synthesis and execution, and per-call audit logging. Everything required to
run Holo against your own data and serve every agent on your team is in CE.

Concretely:

- **All 20 connectors** (GitHub, GitLab, Slack, Notion, Grain, Pylon, HubSpot,
  Linear, Mintlify, Prismic, Zendesk, Webcrawl, Google Drive, Airtable, Google
  Chat, Asana, Jira, Confluence, Stripe, Salesforce) and any future connector
  added to `packages/connectors`.
- **Hybrid retrieval** (pgvector + tsvector fused with RRF), ACL-aware index,
  per-user OAuth ACL fan-out.
- **MCP gateway** (`POST /mcp`) and **REST/OpenAPI** (`/v1/*`).
- **OAuth 2.1 + PKCE provider** with Dynamic Client Registration for MCP
  clients.
- **Per-call audit log** — every tool invocation is attributable and
  replayable from the dashboard. (CE ships the immutable event store; EE adds
  the long-retention, exportable Query History surface — see below.)
- **Skill synthesis + execution + marketplace publish** (`packages/skills`).
- **`@holo/cli`** for one-command self-host.
- **Single sign-in via email OTP and GitHub OAuth** (Better Auth).
- **Multi-tenant organizations** (one or many orgs per deployment).

If you can run `docker compose up` and serve agents from it, you are using CE.
CE is MIT — keep it, fork it, ship a product on top of it, change it, do not
ask permission.

---

## Enterprise Edition — what's gated

EE features live under `ee/` directories in the relevant package (e.g.
`apps/web/src/app/ee/`, `packages/auth/ee/`). They are gated behind a paid
Enterprise license and are intended for organizations with formal compliance,
identity, or branding requirements.

Planned EE surfaces (rolled out incrementally; see `docs/ROADMAP.md` for
sequencing):

- 👥 **Collaboration.** Share chats and agents with other members of your
  organization. Workspace-level handoff, read/comment/edit roles per shared
  object.
- 🔐 **Single Sign-On.** SSO via Google OAuth, OIDC, or SAML. Group syncing
  and just-in-time user provisioning via SCIM.
- 🛡️ **Role-Based Access Control.** RBAC for sensitive resources — which
  members can see which agents, invoke which actions, edit which skills.
- 📊 **Analytics.** Usage graphs broken down by team, LLM provider, agent,
  skill, and connector. Costs, calls, latencies, error rates.
- 🕵️ **Query History.** Long-retention, exportable audit of every agent and
  human query — who asked what, what context was used, what was returned.
  Built on the CE audit log; adds retention windows, exports, and SIEM hooks.
- 💻 **Custom code.** Run custom pre- and post-processing on queries and
  results — strip PII, reject sensitive queries, apply company-specific
  policy, plug in custom analyses.
- 🎨 **Whitelabeling.** Customize the look and feel — name, logo, favicon,
  banners, brand color, custom domain — for internal portals or for shipping
  Holo as part of your own product.

If a feature in the list above ever appears in `packages/`, `apps/`, or
elsewhere **outside** an `ee/` directory, it is CE and MIT. The license is
determined by the file path, not by the marketing position.

---

## Contributions

Contributions to CE files are accepted under MIT. Contributions to EE files
require the same CLA but grant the maintainer the additional rights spelled
out in `LICENSE-EE` § 3. See `CONTRIBUTING.md` for the contribution flow.

## Trademark

"Holo" and the Holo logo are trademarks of the project maintainers. The MIT
license on the CE source does not grant trademark rights — forks should
choose a different name and logo if redistributed.

## Questions

Open an issue at <https://github.com/maakle/holo> or email the maintainers.
