# 0003 — Skills as a layer on top of the context layer, not a replacement for it

> **Note (2026-04-29):** Earlier drafts of this ADR used the word "substrate" for what we now consistently call the "context layer." The decision recorded here is unchanged; only the term was updated for clarity. See ADR-0004 for the wedge reframe.

**Status:** Accepted · **Date:** 2026-04-29

## Context

Holo's product framing draws on two YC RFSs:
- Hu's *AI Operating System for Companies*: a queryable context layer with closed-loop intent vs. reality
- Blomfield's *Company Brain*: extracting procedural knowledge ("how refunds get handled") into executable skills

The question: is Holo a context layer product (v0.1–v0.4) that *adds* a skill layer (v0.5+), or is the skill layer the actual product, with context layer as plumbing?

## Decision

The context layer is the foundation. Skills are a first-class layer on top, shipped in v0.5. Both are necessary; neither is sufficient.

The context layer (connectors + retrieval + ACL) is what makes any other layer possible. Without it, skills are synthesized from incomplete data, get stale, and can't be revalidated when the underlying procedures change.

The skill layer is what makes the context layer *useful for automation*. Querying alone is what Glean and Dust do. Holo's differentiation begins at v0.5.

The closed loop (v0.6) is what makes Holo an *operating system*. Plans declare intent; context layer captures reality; skills make it actionable; the loop detects drift between the three.

Skills do not replace search. Both ship as MCP tools. Agents use search for "what was said" and skills for "what to do." The two are complementary surfaces over the same context layer.

## Consequences

**Positive:**
- Clear architectural separation. `packages/skills` depends on `packages/retrieval-core`, not the other way around.
- v0.1–v0.4 has independent value as a self-hostable open-source RAG-over-company-data product. v0.5+ extends it.
- Skill quality benefits from context layer quality. Improvements to retrieval, chunking, and contextualization compound into better synthesis inputs.
- The framing supports both YC RFSs cleanly without forcing one to subsume the other.

**Negative:**
- Risk that the project is perceived as "another RAG product" until v0.5 ships, slowing early adoption among the agent-first audience.
- Skills layer takes 6 weeks of dedicated work; if it slips, the differentiation slips.

**Mitigation:**
- README and VISION explicitly frame Holo as context layer + skills + loop from day one, even while only the context layer is implemented.
- `packages/skills` exists as an empty package with a detailed README from v0.1, signaling intent to contributors and users.
- v0.4 launch messaging emphasizes "this is the foundation; the operating system arrives in v0.5."
- Dogfood skills against Holo's own internal procedures the moment v0.5 ships.

## Skill format

Holo adopts Anthropic's Skill format (`SKILL.md` with frontmatter, procedure, example tools) as the on-disk representation. This means:
- Skills are human-readable and human-editable
- Skills can be exported/imported between Holo instances
- Skills can be shared across companies (community skill library, post-v0.5)
- Agents already trained to read this format work with Holo skills natively
