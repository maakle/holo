# 0003 — Skills as a layer on top of the substrate, not a replacement for it

**Status:** Accepted · **Date:** 2026-04-29

## Context

Memex's product framing draws on two YC RFSs:
- Hu's *AI Operating System for Companies*: a queryable substrate with closed-loop intent vs. reality
- Blomfield's *Company Brain*: extracting procedural knowledge ("how refunds get handled") into executable skills

The question: is Memex a substrate product (v0.1–v0.4) that *adds* a skill layer (v0.5+), or is the skill layer the actual product, with substrate as plumbing?

## Decision

The substrate is the foundation. Skills are a first-class layer on top, shipped in v0.5. Both are necessary; neither is sufficient.

The substrate (connectors + retrieval + ACL) is what makes any other layer possible. Without it, skills are synthesized from incomplete data, get stale, and can't be revalidated when the underlying procedures change.

The skill layer is what makes the substrate *useful for automation*. Querying alone is what Glean and Dust do. Memex's differentiation begins at v0.5.

The closed loop (v0.6) is what makes Memex an *operating system*. Plans declare intent; substrate captures reality; skills make it actionable; the loop detects drift between the three.

Skills do not replace search. Both ship as MCP tools. Agents use search for "what was said" and skills for "what to do." The two are complementary surfaces over the same substrate.

## Consequences

**Positive:**
- Clear architectural separation. `packages/skills` depends on `packages/retrieval-core`, not the other way around.
- v0.1–v0.4 has independent value as a self-hostable open-source RAG-over-company-data product. v0.5+ extends it.
- Skill quality benefits from substrate quality. Improvements to retrieval, chunking, and contextualization compound into better synthesis inputs.
- The framing supports both YC RFSs cleanly without forcing one to subsume the other.

**Negative:**
- Risk that the project is perceived as "another RAG product" until v0.5 ships, slowing early adoption among the agent-first audience.
- Skills layer takes 6 weeks of dedicated work; if it slips, the differentiation slips.

**Mitigation:**
- README and VISION explicitly frame Memex as substrate + skills + loop from day one, even while only the substrate is implemented.
- `packages/skills` exists as an empty package with a detailed README from v0.1, signaling intent to contributors and users.
- v0.4 launch messaging emphasizes "this is the foundation; the operating system arrives in v0.5."
- Dogfood skills against Memex's own internal procedures the moment v0.5 ships.

## Skill format

Memex adopts Anthropic's Skill format (`SKILL.md` with frontmatter, procedure, example tools) as the on-disk representation. This means:
- Skills are human-readable and human-editable
- Skills can be exported/imported between Memex instances
- Skills can be shared across companies (community skill library, post-v0.5)
- Agents already trained to read this format work with Memex skills natively
