---
name: Berry
description: Dark Operate workspace where people and agents share one board — person first, semantic status, mono figures.
colors:
  void: "#18181b"
  base: "#1A1A1D"
  chalk: "#F8F8F4"
  ash: "#A8A6A6"
  hairline: "#26262B"
  berry: "#C74A5E"
  amber: "#D9A441"
  verdant: "#4F9F7A"
  azure: "#5A92C9"
  ember: "#1C1811"
  thicket: "#151917"
  deep: "#121820"
  ripe: "oklch(70% 0.13 85)"
  slate: "#6A6767"
  shell-rail: "#111113"
  status-danger: "oklch(0.68 0.15 28)"
  primary-foreground: "#ffffff"
typography:
  display:
    fontFamily: "DM Serif Display, Georgia, serif"
    fontSize: "1.5rem"
    fontWeight: 400
    lineHeight: 1.1667
    letterSpacing: "normal"
  headline:
    fontFamily: "JetBrains Mono, ui-monospace, monospace"
    fontSize: "1.125rem"
    fontWeight: 500
    lineHeight: 1.333
  title:
    fontFamily: "JetBrains Mono, ui-monospace, monospace"
    fontSize: "0.875rem"
    fontWeight: 500
    lineHeight: 1.429
  body:
    fontFamily: "JetBrains Mono, ui-monospace, monospace"
    fontSize: "0.8125rem"
    fontWeight: 400
    lineHeight: 1.2
  label:
    fontFamily: "JetBrains Mono, ui-monospace, monospace"
    fontSize: "0.75rem"
    fontWeight: 500
    lineHeight: 1.333
    letterSpacing: "0.05em"
rounded:
  sm: "6px"
  md: "8px"
  lg: "10px"
  xl: "14px"
  full: "9999px"
spacing:
  "1": "4px"
  "1.5": "6px"
  "2": "8px"
  "3": "12px"
  "4": "16px"
  "6": "24px"
  "8": "32px"
components:
  button-primary:
    backgroundColor: "{colors.berry}"
    textColor: "{colors.primary-foreground}"
    rounded: "{rounded.md}"
    padding: "8px 16px"
    height: "36px"
  button-primary-hover:
    backgroundColor: "color-mix(in oklab, #C74A5E 90%, transparent)"
    textColor: "{colors.primary-foreground}"
    rounded: "{rounded.md}"
  button-secondary:
    backgroundColor: "{colors.hairline}"
    textColor: "{colors.chalk}"
    rounded: "{rounded.md}"
    padding: "8px 16px"
    height: "36px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.chalk}"
    rounded: "{rounded.md}"
    padding: "8px 16px"
    height: "36px"
  button-destructive:
    backgroundColor: "{colors.status-danger}"
    textColor: "{colors.primary-foreground}"
    rounded: "{rounded.md}"
    padding: "8px 16px"
    height: "36px"
  input-default:
    backgroundColor: "{colors.void}"
    textColor: "{colors.chalk}"
    rounded: "{rounded.md}"
    padding: "4px 12px"
    height: "36px"
  urgency-band:
    backgroundColor: "color-mix(in oklab, {colors.amber} 10%, {colors.base})"
    textColor: "{colors.chalk}"
    rounded: "0"
    padding: "12px 16px"
  chip-segment:
    backgroundColor: "{colors.hairline}"
    textColor: "{colors.chalk}"
    rounded: "{rounded.md}"
    padding: "4px 10px"
    height: "24px"
---

# Design System: Berry

## Overview

**Creative North Star: "The Person-First Stack"**

Berry's Operate UI is a dark operations workspace for humans and AI agents on one board. Hierarchy is vertical and intentional: what needs a person comes first, then failures, then spend and quieter context. Equal metric-tile dashboards are refused — reading order *is* the design. Density is appropriate for an operations tool; brand shows up in precise semantic color, the BerryMark glyph, and tabular mono figures, not in decorative chrome.

The default product theme is Berry Dark (`void` canvas, `base` surfaces, `chalk` text). Berry Light exists as an accessible print-like inversion; the shell (rail and top bar) stays dark chrome in either theme. Color meaning travels through semantic tokens (`status-*`, `actor-*`, `review-*`, `column-tint-*`) so a status mark, column tint, and urgency band never disagree. Berry red is brand and primary action — never the error color.

**Key Characteristics:**

- Person-first vertical urgency before quieter lists and ledgers
- Berry Dark Operate: void/base/chalk with hairline borders, not purple accents
- One interface face (JetBrains Mono) plus rare DM Serif Display for wordmark and page display titles
- Semantic status / actor / review tokens; column-tint urgency bands
- BerryMark brackets for run and attention state; `berrypulse` only when something still needs a person
- Flat surfaces with hairline hierarchy; shadows reserved for floating chrome

## Colors

A muted dark workspace palette with one brand rose and three operational accents (human/awaiting, done, agent/running). Semantic aliases keep meaning stable across themes.

### Primary

- **Berry** (`#C74A5E`): Brand mark, wordmark stop, and at most one primary action per view. Never used for failure or destructive affordances.

### Secondary

- **Amber** (`#D9A441`): Human input, blocked, awaiting review, attention. Maps to `status-warning`, `actor-human`, `review-pending`.
- **Azure** (`#5A92C9`): Agent activity in progress. Maps to `status-info`, `actor-agent`, focus ring.
- **Verdant** (`#4F9F7A`): Done, accepted, merged. Maps to `status-success`, `review-approved`.

### Tertiary

- **Ember** (`#1C1811`): Human-held or review-waiting surface tint.
- **Deep** (`#121820`): Agent output and active-run surface tint.
- **Thicket** (`#151917`): Completed/merged surface tint.
- **Ripe** (`oklch(70% 0.13 85)`): One bright empty-state or primary editorial surface (rare).

### Neutral

- **Void** (`#18181b`): Dark app canvas and gutters (`--background` in Berry Dark).
- **Base** (`#1A1A1D`): Primary workspace surface (`--container` / `--card`).
- **Chalk** (`#F8F8F4`): Primary text on dark.
- **Ash** (`#A8A6A6`): Supporting body and captions on dark (stay above 4.5:1).
- **Hairline** (`#26262B`): Rules and borders; never body text.
- **Slate** (`#6A6767`): Metadata on light surfaces only.
- **Shell rail** (`#111113`): Dark chrome rail behind the workspace.
- **Status danger** (`oklch(0.68 0.15 28)` on dark): Failed, blocked, destructive — separate from Berry.

### Named Rules

**The Berry-Is-Not-Error Rule.** Berry red is brand and primary action only. Failures and destructive actions use `status-danger` / `destructive`.

**The One Primary Rule.** At most one Berry-filled primary action per view; rarity keeps the accent meaningful.

**The Semantic Tone Rule.** Status never invents its own hex. Tone comes from `statusTone()` → `--status-*` / `--column-tint-*` so marks, bands, and columns agree.

## Typography

**Display Font:** DM Serif Display (Georgia fallback)
**Body Font:** JetBrains Mono (ui-monospace fallback)
**Label/Mono Font:** Same as body — `--font-sans` and `--font-mono` both resolve to JetBrains Mono

**Character:** A single mono interface face for controls, body, metadata, identifiers, logs, and durations. Serif appears only for the wordmark, page display titles (task/goal/plan/project), and quoted agent handoff — never in buttons, tables, or dense queue rows.

### Hierarchy

- **Display** (400, 24/28 px, `data-heading="display"`): Page display titles and rare empty-state emphasis.
- **Headline** (500, 18/24 px `h1`): Page titles in stacked headers.
- **Title** (500, 14/20 `h3` → 16/24 `h2`): Section and dialog titles; Usage band labels sit at body size with `font-medium`.
- **Body** (400, 13 px / 1.2): Default for controls, lists, and copy. `text-base` (14 px) is reserved for rail items and tab titles.
- **Label** (500, 12/16 px, tracked caps, `data-heading="label"`): In-page group labels ("Sub-tasks", "Files", "Activity").

Sizes come from the element (`h1`–`h4` / `data-heading`), never from ad-hoc `text-*` size utilities in components. Body weight is 400; headings and labels take one step to 500. Tabular figures (`tabular-nums`) for costs, counts, durations, and percentages.

### Named Rules

**The Element-Size Rule.** Type size is carried by the element or `data-heading`, not by utility classes — ESLint refuses component-level `text-*` size utilities.

**The Serif Rarity Rule.** DM Serif Display never appears in buttons, controls, tables, dense queue rows, or in-page section titles.

## Layout

Operate pages sit in `MainLayout` with stacked headers (compact ~40 px mobile / 56 px desktop rows). Usage's first viewport is title + tabs + filters, then a vertical urgency stack (`gap-6`, `px-6 py-6`), then quieter lists below a hairline (`border-t border-border/60 pt-6`). Two-column quieter grids kick in at `lg`.

Spacing rides Tailwind's 4 px base. Working rhythm: 8 px default internal gap, 12–16 px field/card padding, 24 px page section padding, 32 px large separation. Control heights: 36 px default desktop fields/buttons, 32 px dense toolbars, 24–28 px low-priority utilities only. Icons default 16 px.

Desktop sidebar 244 px (collapsed rail 48 px); mobile drawer 260 px; workspace inset 8 px. Detail drawers cap at `--drawer-max-width: 1024px`. Navigation behavior shifts below 1024 px.

### Named Rules

**The Urgency-Stack Rule.** Operator surfaces that summarize "what needs me" stack full-width urgency bands top-to-bottom (awaiting → failures → spend). Do not replace that stack with a grid of equal metric tiles.

**The Hairline Rest Rule.** Quieter context (in-flight lists, task distribution, charts, leaderboards) sits below a hairline, not competing in the first urgency stack.

## Elevation & Depth

Depth is mostly tonal and bordered, not shadowed. Surfaces are flat at rest; hierarchy comes from void → base → muted fills, hairline borders, and column-tint washes (status hue mixed ~10% into `--container` for bands/board columns, ~5% for list groups).

### Shadow Vocabulary

- **Control rest** (`shadow-xs`): Default on primary/outline buttons and inputs.
- **Floating chrome** (`shadow-sm`): Active tab trigger fill; floating sidebar surfaces.
- **Overlay** (`shadow-lg`): Dialogs and popovers.

### Named Rules

**The Flat-By-Default Rule.** Borders and tints provide hierarchy. Shadows appear on interactive chrome and overlays, not as decoration under content cards.

## Shapes

Root radius is 10 px (`--radius: 0.625rem`). Derived: 6 px (`sm`), 8 px (`md`), 10 px (`lg`), 14 px (`xl`); pills and avatars use full. Most controls use 8 px (`rounded-md`); cards/dialogs use 10 px; badges/avatars use pill. Urgency bands are square-edged full-bleed sections (no card radius) so they read as stack strata, not floating cards. Chart indicator chips may use 2 px radius as deliberate micro-geometry.

## Components

Operate components are restrained and token-driven: Berry for the rare primary, semantic status for meaning, mono for scanability.

### Buttons

- **Shape:** Gently curved (8 px / `rounded-md`)
- **Primary:** Berry fill, white label, `h-9` (36 px), `shadow-xs`; hover Berry at 90%
- **Secondary:** Hairline fill on dark, chalk text
- **Ghost:** Transparent; accent wash on hover
- **Destructive:** `status-danger` fill — never Berry
- **Focus:** 3 px ring at `ring` (azure) / 50% opacity; destructive variants use danger ring
- **Dense:** `xxs`/`xs` (24–28 px) only for segmented strips and low-priority utilities

### Chips / Segmented control

- **Style:** Bordered strip (`rounded-md`, `p-0.5`); active segment secondary fill, inactive ghost
- **State:** `aria-pressed` toggles; changes how data is shown, not what is saved
- **Height:** 24 px segments (`size="xxs"`)

### Cards / Containers

- **Corner Style:** Dialogs/cards ~10 px; urgency bands 0 (square stack)
- **Background:** `base` / `--container`; urgency bands use `column-tint-{tone}`
- **Shadow Strategy:** Flat; see Elevation
- **Border:** `border` / hairline at ~70% opacity on bands
- **Internal Padding:** Bands `px-4 py-3`; page stacks `px-6 py-6`

### Inputs / Fields

- **Style:** `h-9`, `rounded-md`, border `input`, background `background`, chalk text, `shadow-xs`
- **Focus:** Border shifts to `ring` (azure)
- **Placeholder:** `foreground` at ~40% opacity — never low-opacity muted ash (reads as black on void)
- **Invalid:** Destructive border + ring
- **Native fill:** Form controls set `color` and `-webkit-text-fill-color` from `--foreground`

### Navigation

- **Shell:** Dark rail (`shell-rail` / sidebar tokens), chalk labels, Berry for active/primary rail accents
- **Page headers:** Stacked full-width rows with hairline bottoms; `h1` title then tabs/filters
- **Tabs:** Muted track (`h-9`, `rounded-lg`); active trigger background fill + `shadow-sm`

### Urgency band (signature)

- **Role:** Full-width Operate summary stratum — label + large tabular figure + optional hint/body
- **Tone:** `warning` | `danger` | `info` | `success` | `neutral` → column-tint background + status-colored value
- **Pulse:** 6 px warning dot with `berrypulse` (1.4s ease-in-out) when the band still needs a person and count > 0; disabled under `prefers-reduced-motion`
- **Figures strip:** Secondary tabular numbers under a hairline inside the band — no nested card chrome

### BerryMark (signature)

- **Shape:** Bracket silhouette with centre dot (solid / hollow / crossed)
- **Tones:** `brand` | `neutral` | `working` (azure) | `attention` (amber) | `complete` (verdant) | `danger`
- **Sizes:** `sm` 16 px, `md` 24 px, `lg` 36 px
- **Use:** Run state, approvals attention, empty/error anchors — same glyph everywhere so agent work reads as first-class

## Do's and Don'ts

### Do:

- **Do** put what needs a person above failures, spend, and quieter lists on operator summaries.
- **Do** color by semantic tokens (`status-*`, `actor-*`, `review-*`, `column-tint-*`), not raw palette utilities.
- **Do** use tabular mono figures for costs, counts, durations, and rates.
- **Do** use BerryMark for run/attention state with the shared tone map.
- **Do** honor `prefers-reduced-motion` for `berrypulse` and other motion.
- **Do** keep Berry as the rare primary action and brand mark.

### Don't:

- **Don't** ship equal metric-tile dashboards where urgency order should lead.
- **Don't** use Berry red for errors, destructive actions, or failure rates.
- **Don't** introduce purple/indigo accent themes or decorative glow stacks — Berry Dark is void/base/chalk with amber/azure/verdant semantics.
- **Don't** put DM Serif Display in controls, tables, or dense queues.
- **Don't** communicate state by color alone — keep glyph, label, or non-color cue with the tone.
- **Don't** fade placeholders with low-opacity `muted-foreground` on void.
