# Design System — holo

## Product Context
- **What this is:** Open-source, self-hostable MCP context layer for AI agents. Community Edition is MIT; Enterprise Edition (collaboration, SSO, RBAC, analytics, query history, custom code, whitelabeling) is commercial — see [`LICENSING.md`](./LICENSING.md).
- **Who it's for:** Engineering teams maintaining one or more custom AI agents in production and tired of re-implementing the context layer per agent.
- **Space/industry:** Developer infrastructure. Adjacent to Onyx, Dust, PipesHub (OSS); Linear, Vercel, Stripe (dev-tools UX leaders); Glean, Notion AI (closed-source competition).
- **Project type:** Hybrid — dashboard for self-hosters (Connections, observability, marketplace) + marketing site for OSS adoption + public skills registry.

## Memorable thing

**"Serious infrastructure for serious AI work."**

Every choice below serves this. Type and whitespace do the work. Decoration is rare. Color is rarer. Motion is functional.

## Aesthetic Direction
- **Direction:** Brutally Minimal with editorial discipline
- **Decoration level:** Minimal (no decorative blobs, no gradients, no background patterns; subtle horizontal rules where structure demands them)
- **Mood:** Calm, precise, technically authoritative. Reads cold to non-technical visitors — that's a feature, not a bug.
- **Reference posture:** Linear's restraint + Vercel's geometric precision, but with its own face (no purple, no Vercel-coded geometry). NOT to be confused with: founder cosplay, polished SaaS, AI-marketing veneer.

## Typography

### Faces
- **Display / hero:** **General Sans** — Fontshare, free (OFL). Distinctive geometric forms; reads as serious without being severe. Chosen explicitly because it is NOT Inter and NOT Space Grotesk (the AI-tool default convergence trap).
- **Body / UI / labels:** **Geist** — Vercel, free (OFL). Tabular-nums for tables. Dev-infra-coded but not exclusively. Pairs with General Sans.
- **Code / mono / data:** **JetBrains Mono** — Apache-2.0. Industry standard. Strong character.

### Loading
```html
<link rel="preconnect" href="https://api.fontshare.com" />
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link href="https://api.fontshare.com/v2/css?f[]=general-sans@400,500,600,700&display=swap" rel="stylesheet" />
<link href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet" />
```

Self-host fallback (v0.2): bundle WOFF2 files in `apps/web/public/fonts/` to remove third-party dependency for self-hosters.

### Scale (modular, base 16px)

| Role | Size / Line | Weight | Family |
|---|---|---|---|
| Display 1 | 48 / 56 | 600 | General Sans |
| Display 2 | 36 / 44 | 600 | General Sans |
| H1 | 28 / 36 | 600 | General Sans |
| H2 | 22 / 30 | 500 | General Sans |
| H3 | 18 / 28 | 600 | Geist |
| Body | 15 / 24 | 400 | Geist |
| Body small | 13 / 20 | 400 | Geist |
| Caption | 12 / 16 | 500 (uppercase, tracking 0.04em) | Geist |
| Mono | 13 / 20 | 400 | JetBrains Mono |

### Letter-spacing
- Display sizes (≥ 28px): `-0.01em` (tightening prevents loose feel at large sizes)
- Body sizes: default
- Caption / labels: `+0.04em` (loose tracking signals secondary importance)

### Numerics
Body and tables use `font-variant-numeric: tabular-nums` always. Latencies, dollar amounts, counts, dates — never proportional digits.

## Color
- **Approach:** Restrained. One accent, used 3–5 times per screen. Dark mode primary; light mode secondary.
- **Anti-pattern:** No gradient hero. No purple/violet. No decorative color blocks. No more than one accent.

### Dark mode (primary)

| Role | Hex | Notes |
|---|---|---|
| `--bg` | `#0A0A0A` | Page background. Near-black, not pure black. |
| `--surface` | `#141414` | Cards, modals, elevated rows. |
| `--surface-2` | `#1C1C1E` | Secondary elevation, hover states. |
| `--border` | `#27272A` | Default borders, dividers. |
| `--border-strong` | `#3F3F46` | Hover/focus borders. |
| `--text` | `#FAFAF7` | Primary text. Warm-white, not pure white. |
| `--text-muted` | `#A1A1AA` | Secondary text. |
| `--text-subtle` | `#71717A` | Captions, placeholders, metadata. |
| `--accent` | `#3F47FF` | Electric indigo. Primary CTAs, focus rings, active nav, links. |
| `--accent-fg` | `#FFFFFF` | Text on accent backgrounds. |
| `--success` | `#10B981` | Success states. |
| `--warning` | `#F59E0B` | Warning states. |
| `--error` | `#EF4444` | Error states. |
| `--code-bg` | `#0F0F11` | Code block background. |

### Light mode

| Role | Hex |
|---|---|
| `--bg` | `#FAFAF7` |
| `--surface` | `#FFFFFF` |
| `--surface-2` | `#F4F4F0` |
| `--border` | `#E4E4E7` |
| `--border-strong` | `#D4D4D8` |
| `--text` | `#0A0A0A` |
| `--text-muted` | `#71717A` |
| `--text-subtle` | `#A1A1AA` |
| `--accent` | `#3F47FF` (same — accent does not invert) |
| `--success` | `#059669` |
| `--warning` | `#D97706` |
| `--error` | `#DC2626` |
| `--code-bg` | `#F4F4F0` |

### Accent usage rules

The accent color (`#3F47FF`) appears at most **3–5 times per screen**. Acceptable uses:
- Primary CTA button (one per screen)
- Focus ring on active input
- Active nav indicator (single underline or left bar)
- Inline link
- Active-state icon

If you find yourself using accent on a 6th element, something is wrong. Remove the weakest use.

### Why electric indigo, not purple

Linear and Glean both use purple/violet. Stripe uses indigo around `#635BFF`. holo uses a more saturated, blue-leaning indigo (`#3F47FF`) to read as more technical and less "AI marketing" than violet. Anti-AI-slop: no gradient versions, no shifting accent across the surface.

## Spacing
- **Base unit:** 4px
- **Density:** compact-comfortable (denser than Stripe, looser than Linear)
- **Scale:** `2 4 6 8 12 16 20 24 32 48 64 96` (px)
- **Tailwind tokens:** match this scale exactly. `p-2` = 8px, `p-4` = 16px, etc.

### Density rules
- Dashboard tables: 14px row height, 12–16px horizontal padding
- Marketing sections: 64–96px vertical between sections
- Card internal padding: 16–24px depending on content density

## Layout
- **Approach:** Hybrid — grid-disciplined for dashboard surfaces, editorial for marketing pages
- **Dashboard grid:** 8 columns, max width 1280px, 24px gutters
- **Marketing grid:** 12 columns, max width 1024px for content (1280px for full-bleed sections), 16–24px gutters
- **Border radius scale:**

| Token | Value | Use |
|---|---|---|
| `sm` | 4px | Inputs, small chips, badges |
| `md` | 6px | Buttons, cards, code blocks |
| `lg` | 8px | Modals, prominent containers |
| `full` | 9999px | Avatars only — never on cards or buttons |

### Anti-patterns
- No bubble-radius on every element (full-rounded buttons signal "I gave up on hierarchy")
- No 3-column icon grid for features (the AI-slop SaaS layout)
- No centered-everything on landing pages
- No drop shadows except on elevated overlays (modals, dropdowns, selected rows)

## Motion
- **Approach:** Minimal-functional. Motion exists to aid comprehension, not to reward attention.
- **Easing:**
  - `enter`: `cubic-bezier(0.16, 1, 0.3, 1)` (gentle ease-out for things appearing)
  - `exit`: `cubic-bezier(0.7, 0, 0.84, 0)` (sharp ease-in for things disappearing)
- **Duration:**
  - `micro`: 100ms (color changes, button press)
  - `short`: 200ms (dropdowns, popovers)
  - `medium`: 300ms (modal entrance, page transitions)
- **Forbidden:** spring physics, bounce, scroll-driven choreography, decorative animations.

## Components

### Buttons
Three variants only: `primary` (accent bg), `secondary` (surface bg + border), `ghost` (transparent, used for tertiary actions). Sizes: default (8px / 14px padding), small (6px / 12px). No XL or "huge" buttons.

### Inputs
Border, no background fill in dark mode. Focus state: `outline: 2px solid var(--accent); outline-offset: -1px;` plus a transparent border so the layout doesn't shift on focus.

### Tables
- `tabular-nums` always
- Row hover: `--surface-2` background
- Selected row: `--surface-2` background + `--accent` left border
- Header row: 12px caption-style labels, uppercase, tracking 0.06em
- Cell padding: 14px vertical / 16px horizontal

### Badges
Two states only: filled-color (`color-mix(success/warning/error 12% transparent)` background + colored text) for status, neutral (surface-2 + border + muted text) for metadata.

### Code blocks
JetBrains Mono 13px / 20px. `--code-bg`. 4px border radius. 12px internal padding. Inline code: same font + 0.92em + `--surface-2` background.

## Decisions Log

| Date | Decision | Rationale |
|---|---|---|
| 2026-04-29 | Initial design system created | Created by /design-consultation. Memorable thing: "serious infrastructure for serious AI work." Aesthetic: brutally minimal + editorial discipline. Type: General Sans / Geist / JetBrains Mono (deliberately not Inter or Space Grotesk). Color: restrained, dark-mode primary, electric indigo `#3F47FF` accent (deliberately not purple/violet). |
