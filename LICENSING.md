# Licensing

Holo ships in two editions. Both live in this repository; what differs is the
license that governs each set of files.

| Edition | Who it's for | License | Location |
|---|---|---|---|
| **Community Edition (CE)** | Anyone — individuals, startups, in-house teams. Always free to self-host, fork, modify, and redistribute under the terms of AGPL-3.0. | [AGPL-3.0](./LICENSE) | Everything in this repo **except** `**/ee/**` |
| **Enterprise Edition (EE)** | Companies that need the EE-only governance, identity, and customization surfaces. Free to evaluate and develop against; production use requires a paid subscription. | [Enterprise License](./LICENSE-EE) | Anything under a directory named `ee/` |

If a file's path does not contain `/ee/`, it is AGPL-3.0. If it does, it is
EE. There is no third tier.

---

## Community Edition (AGPL-3.0) — what's always free

The Community Edition is the entire context-layer product: connectors, hybrid
search, MCP + REST gateway, the dashboard, the worker, OAuth provider, and
skill synthesis and execution. Everything required to run Holo against your
own data and serve every agent on your team is in CE.

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
- **Agent observability** — the last-100-invocations view, side-by-side
  query/result diff, and per-skill execution history. Enough to debug and
  understand what your agents are doing day-to-day. The compliance-grade
  per-call audit log (tamper-evident hash chain, long retention, SIEM
  exports) lives in EE.
- **Skill synthesis + execution + marketplace publish** (`packages/skills`).
- **`@holo/cli`** for one-command self-host.
- **Single sign-in via email OTP and GitHub OAuth** (Better Auth).
- **Multi-tenant organizations** (one or many orgs per deployment). Invites,
  removals, and an owner role for the org creator are CE; invited users join
  as full collaborators (`admin`) so a self-hosted team isn't gated on the
  org creator for every action. Differentiated roles — restricted "member"
  tiers, custom roles, per-resource scoping — are EE; see RBAC below.

If you can run `docker compose up` and serve agents from it, you are using CE.

### What AGPL-3.0 means in practice

AGPL-3.0 is the GNU Affero General Public License v3.0 — a copyleft open-source
license approved by both the OSI and the FSF. The short version:

- **Self-hosting for your company is fine.** Run holo on your own infrastructure
  for your own users, modify it however you like, never publish a thing. AGPL
  has nothing to say about purely internal use.
- **If you offer holo (or a derivative) as a network service to third parties**
  — i.e. you host it for users outside your organization — you must make the
  full corresponding source code of the version you're running available to
  those users under AGPL-3.0.
- **Forks must stay under AGPL-3.0.** You can change the code, but you can't
  relicense the result under a more permissive license.
- **No trademark grant.** AGPL doesn't license the "Holo" name or logo; forks
  intended for redistribution should use a different name.

If you want to build a hosted commercial product on top of holo without the
AGPL source-disclosure obligation, contact the maintainers about a commercial
license.

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
- 🛡️ **Role-Based Access Control.** Differentiated roles and per-resource
  scoping — restricted "member" tiers below admin, custom roles, and
  RBAC for sensitive resources (which members can see which agents,
  invoke which actions, edit which skills). CE invites everyone as a
  full collaborator under the org owner; EE is what you reach for when
  some members need less than full access.
- 📊 **Analytics.** Usage graphs broken down by team, LLM provider, agent,
  skill, and connector. Costs, calls, latencies, error rates.
- 🕵️ **Per-call audit log + Query History.** Tamper-evident hash chain
  over every tool invocation; long-retention, exportable audit of every
  agent and human query — who asked what, what context was used, what was
  returned. Configurable retention windows, exports, and SIEM hooks. CE
  ships agent observability for day-to-day debugging; EE is what you need
  for compliance.
- 💻 **Custom code.** Run custom pre- and post-processing on queries and
  results — strip PII, reject sensitive queries, apply company-specific
  policy, plug in custom analyses.
- 🎨 **Whitelabeling.** Customize the look and feel — name, logo, favicon,
  banners, brand color, custom domain — for internal portals or for shipping
  Holo as part of your own product.

If a feature in the list above ever appears in `packages/`, `apps/`, or
elsewhere **outside** an `ee/` directory, it is CE and AGPL-3.0. The license
is determined by the file path, not by the marketing position.

### How EE is enforced

EE features are gated by the `HOLO_EE_LICENSE_KEY` environment variable. Any
non-empty value enables them; the runtime does not validate the key against a
license server, check expiry, or count seats. This is intentional — the
license is **contractual, not cryptographic**. Production use without a paid
subscription violates the terms in `LICENSE-EE` regardless of what env vars
you set, and the source is public, so any technical check could be patched
out by a determined fork. Catching that is the job of the license agreement,
not the binary.

A signed-license-key system (Ed25519 JWTs with feature scopes, expiry, and
seat counts) is planned for when the first paying EE customer's requirements
warrant building it. Until then, the bar to enable EE in dev or evaluation is
deliberately low so customers can self-serve a trial.

---

## Contributions

Contributions to CE files are accepted under AGPL-3.0. Contributions to EE
files require the same CLA but grant the maintainer the additional rights
spelled out in `LICENSE-EE` § 3. See `CONTRIBUTING.md` for the contribution
flow.

## Trademark

"Holo" and the Holo logo are trademarks of the project maintainers. The
AGPL-3.0 license on the CE source does not grant trademark rights — forks
intended for redistribution should choose a different name and logo.

## Questions

Open an issue at <https://github.com/maakle/holo> or email the maintainers.
