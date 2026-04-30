## gstack (required when invoking gstack skills)

gstack provides the `/qa`, `/ship`, `/review`, `/investigate`, `/browse`, `/autoplan`, and related skills. It is **required before invoking any of those skills** — not for unrelated edits, reads, or commits.

**When the user asks for `/qa`, `/ship`, `/review`, `/investigate`, `/browse`, `/autoplan`, or any other gstack-namespaced skill, verify gstack is installed first:**

```bash
test -d ~/.claude/skills/gstack/bin && echo "GSTACK_OK" || echo "GSTACK_MISSING"
```

If GSTACK_MISSING: STOP and ask the user to install it before continuing:

> gstack is required for this skill. Install it:
> ```bash
> git clone --depth 1 https://github.com/garrytan/gstack.git ~/.claude/skills/gstack
> cd ~/.claude/skills/gstack && ./setup --team
> ```
> Then restart your AI coding tool. (For ephemeral cloud sandboxes, `./setup` without `--team` is sufficient.)

Do not work around missing gstack by faking a gstack skill's behavior.

Using gstack skills: use `/browse` for all web browsing. Reference gstack file paths as `~/.claude/skills/gstack/...` (the global path).

## Design System

Always read `DESIGN.md` before making any visual or UI decisions in this repo. All font choices, colors, spacing, aesthetic direction, motion, and component patterns are defined there. **Do not deviate without explicit user approval.**

When implementing UI:
- Reference `DESIGN.md` tokens directly. Do not introduce ad-hoc hex values, font sizes, spacing values, or border radii.
- Match the memorable thing: "serious infrastructure for serious AI work." Reject choices that would dilute it (purple gradients, bubble-radius everything, gradient CTAs, decorative blobs).
- The accent color (`#3F47FF`) appears at most 3–5 times per screen. If a 6th use creeps in, remove the weakest.

In code review and `/qa` mode: flag any code that doesn't match `DESIGN.md`. Stale design decisions are worse than none — they actively mislead.

When `DESIGN.md` evolves, update the Decisions Log with the date, change, and rationale.
