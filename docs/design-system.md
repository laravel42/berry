# Berry design-system baseline

This document inventories the imported Circle frontend as implemented on 2026-08-22 and
defines the boundary between reusable UI infrastructure and Berry's own product identity.
It is a source audit, not a claim that every inherited choice is a final Berry standard.

The implementation sources of truth are `frontend/app/globals.css`,
`frontend/components/ui`, and `frontend/components/layout`. Circle remains attributed under
its MIT license in `frontend/LICENSE.md` and in the application sidebar.

## Principles

- Keep semantic tokens and accessible Radix behavior; avoid styling features with raw color
  values or one-off state treatments.
- Berry should be recognizable through its own color, type hierarchy, icon treatment,
  navigation, terminology, and interaction model—not through a close visual reproduction of
  another issue tracker.
- Dense information is appropriate for an operations workspace, but 24–28 px controls are
  compact variants, not the default for primary actions or touch surfaces.
- Human work, agent work, reviews, and run state need equal first-class visual semantics.

## Foundations

### Color

The Brand Manual is the palette authority. `frontend/app/globals.css` exposes these values
through semantic CSS custom properties and Tailwind's `@theme inline`; feature components
consume semantic state names rather than raw colors.

| Brand token | Value | Intended use |
| --- | --- | --- |
| `void` | `#18181b` | Dark app canvas and gutters |
| `base` | `#1A1A1D` | Primary dark workspace surface |
| `ember` | `#1C1811` | Human-held or review-waiting surface |
| `thicket` | `#151917` | Completed/merged surface |
| `deep` | `#121820` | Agent output and active run surface |
| `ripe` | `oklch(70% 0.13 85)` | One bright empty-state or primary editorial surface |
| `chalk` | `#F8F8F4` | Dark-theme primary text |
| `ash` | `#A8A6A6` | Dark-theme supporting body text |
| `slate` | `#6A6767` | Metadata on light surfaces only. Dark captions use `ash` so they stay above 4.5:1. |
| `hairline` | `#26262B` | Rules and borders; never body text |
| `berry` | `#C74A5E` | Brand mark, wordmark stop, and one primary action per view |
| `amber` | `#D9A441` | Human input, blocked, awaiting review |
| `verdant` | `#4F9F7A` | Done, accepted, merged |
| `azure` | `#5A92C9` | Agent activity in progress |

Berry Dark is the default product theme. Berry Light is an accessible print-like inversion;
System selects between those two. The inherited `pure-light`, `magic-blue`, `classic-dark`,
and custom theme variants are not Berry themes. Today `theme-provider.tsx` forces dark. The
shell (rail and top bar) is dark chrome in either theme and sets its own text colour, so
`MainLayout` resets `text-foreground` at the page boundary: a page never inherits the
shell's colour, which is what makes the light theme safe to enable without an audit.

Semantic state aliases keep color meaning stable across both themes:

| Alias | Meaning |
| --- | --- |
| `status-success` | Completed, healthy, connected |
| `status-warning` | At risk, waiting, degraded |
| `status-danger` | Failed, blocked, destructive |
| `status-info` | Informational or running |
| `status-neutral` | Paused, cancelled, inactive |
| `actor-human` | Human-authored activity: the author's name and avatar ring in the activity feed, comments and the run transcript (amber) |
| `actor-agent` | Agent-authored activity: the same slots when an agent wrote it, and the agent mark's working tone (azure) |
| `review-pending`, `review-approved`, `review-changes` | Review-gate states: the review card, the reviewer property and the approval queue rows |
| `column-tint-*`, `group-tint-*` | Board column and list group headers: the status tone mixed at 10 % (board) or 5 % (list) into `--container`, one per tone (`neutral`, `info`, `warning`, `success`, `danger`) |

A status never carries a colour of its own. `data/status.tsx` gives each one a *tone*
(`statusTone()`), and everything that colours by status - the glyph, the column tint, the
group bar - reads the matching `--status-*` token, so a column cannot disagree with the
mark beside it in either theme. In review and Blocked are warning, Done is success, In
progress is info, and Backlog, Todo and Cancelled are neutral.

Berry is never an error color. Destructive/error actions use the separate `status-danger`
token. Status marks retain one bracket silhouette; the berry dot, label, and optional
non-color cue communicate the state.

### Typography

The app ships two faces, loaded in `app/layout.tsx`: JetBrains Mono (300-600) as the one
interface face - `--font-sans` and `--font-mono` both resolve to it - and DM Serif Display
(400) as the display face.

| Role | Current implementation | Guidance |
| --- | --- | --- |
| Interface | JetBrains Mono 400, 13 px / 1.2 | Default for controls, body, metadata, identifiers, logs, and durations |
| Display | DM Serif Display 400 | Wordmark, page display titles (the task, goal, plan and project title; a full-screen empty or access state) and quoted agent handoff only |
| Body | `text-xs` = `text-sm` = 13 px | The body size; anything without an element size sits here. `text-base` (14 px) is the rail items and tab titles |
| Heading small | `h4` = 13/20 px | Row-level heading |
| Heading | `h3` = 14/20, `h2` = 16/24, `h1` = 18/24 px, weight 500 | Dialog/card title, section title, page title |
| Section label | `data-heading="label"` = 12/16 px, 500, tracked caps | "Sub-tasks", "Files", "Activity": labels for a group inside a page, not the rail's section headings |
| Display size | `data-heading="display"` = 24/28 px | Page display titles and the rare empty-state emphasis |
| Sidebar menu | `[data-slot='sidebar']` keeps the inherited scale | Already compacted; do not inherit the workspace scale |

Sizes come from the element, never from a utility. `h1`-`h4` step down through the named
scale in the base layer of `globals.css`, everything else sits at the 13 px body, and a
`text-*` size utility in a component is refused by ESLint (`no-restricted-syntax`). A form
field standing in for a heading - the title field of a create dialog - borrows the size
with `data-heading="h1|h2|h3"`; `data-heading="display"` is the page display size; and
`data-heading="label"` is the section-label role. Only the wordmark sizes outside the scale,
through `data-wordmark`.

**Weight.** The body is 400. `h1`-`h3`, their `data-heading` stand-ins and the section
label carry one step, to 500. That is the only weight step the scale spends: mono has no
italic voice and few weights, so the rest of the hierarchy comes from size, tone and
spacing. `font-normal` resolves to 300 (`--font-weight-normal`), the shell's weight, not the
page's; do not reach for it to "reset" text.

Form controls inherit `color` and `-webkit-text-fill-color` from `--foreground` in
`globals.css`. Do not rely on the user-agent fill. Placeholders fade
`--foreground` (about 40% opacity), not low-opacity `--muted-foreground`, so they
stay visible on void.

DM Serif Display never appears in buttons, controls, tables, dense queue rows, or section
titles inside a page: a settings page name or a card title is a heading, not a display
title. Prefer the defined scale over new arbitrary values; migrate recurring 10 px and 11 px
labels into named `type-micro` and `type-overline` styles if they survive accessibility review.

### Spacing and sizing

The frontend uses Tailwind's 4 px spacing base. Its working compact scale is:

| Token | Value | Common use |
| --- | --- | --- |
| `space-0.5` | 2 px | Tight icon alignment only |
| `space-1` | 4 px | Inline icon/text and micro gaps |
| `space-1.5` | 6 px | Compact control gap |
| `space-2` | 8 px | Default internal gap/padding |
| `space-2.5` | 10 px | Compact horizontal padding |
| `space-3` | 12 px | Field/card padding |
| `space-4` | 16 px | Default section/card separation |
| `space-5` | 20 px | Generous component padding |
| `space-6` | 24 px | Dialog/page section padding |
| `space-8` | 32 px | Large section separation |
| `space-10` | 40 px | Empty/loading state breathing room |

Standard control heights are 24, 28, 32, 36, and 40 px (`h-6` through `h-10`). Use 36 px
for normal desktop fields and buttons, 32 px for dense tables/toolbars, and 40 px or greater
for primary mobile actions. The inherited 24/28 px variants are for low-priority desktop
utilities only. Default icons are 16 px; secondary icons use 14 or 12 px.

Layout constants currently embedded in components should move to named tokens when those
components are revised:

- Desktop sidebar: 244 px; mobile drawer: 260 px; collapsed rail: 48 px.
- Desktop workspace inset: 8 px.
- Header accounting: 40 px compact/mobile and 56 px desktop, with two-header totals of
  80/96 px.
- Mobile/navigation behavior changes below 1024 px.

### Overlay and drawer sizing

Detail drawers are capped at **1024 px**, globally, via the `--drawer-max-width`
token in `frontend/app/globals.css`. Past roughly that width a drawer stops
reading as a panel over the workspace and starts reading as a page that
replaced it, which loses the sense of the list still sitting behind it.

The cap is a token, not a prop default, so changing it is one edit rather than
an audit of every call site. `DetailDrawerShell` accepts a `maxWidth` override
in pixels for the rare case that needs one; a call site passing the same value
as the token is redundant and should be removed rather than kept "for clarity",
because a second copy of the number is a second thing to change.

Drawer width is additionally clamped to the space beside the sidebar, so a
drawer never covers navigation on a narrow viewport.

### Shape, elevation, and motion

The root radius is 10 px. Derived semantic radii are 6 px (`sm`), 8 px (`md`), 10 px
(`lg`), and 14 px (`xl`); pills and avatars use `full`. Most controls use 8 px, cards/dialogs
use 10 px, and badges/avatars use a pill. Arbitrary 2, 4, and 5 px radii should be folded
into the scale or explicitly documented as chart/indicator geometry.

Elevation uses Tailwind `shadow-xs` on controls, `shadow-sm` on floating sidebar surfaces,
and `shadow-lg` on dialogs/popovers. Borders, not shadows, provide most hierarchy. Common
motion is 150–200 ms; sheets use 300 ms close and 500 ms open. All new animation must honor
`prefers-reduced-motion`; inherited animated primitives need an audit for that behavior.

## Component inventory

### Reusable primitives

The 33 local shadcn/Radix primitives are the lowest-level design-system layer:

`AlertDialog`, `Alert`, `Avatar`, `Badge`, `Breadcrumb`, `Button`, `Calendar`, `Card`,
`Checkbox`, `Collapsible`, `Command`, `ContextMenu`, `Dialog`, `DropdownMenu`, `Form`,
`Input`, `Label`, `Popover`, `Progress`, `Resizable`, `Select`, `Separator`, `Sheet`,
`Sidebar`, `Skeleton`, `Slider`, `Sonner`, `Switch`, `Table`, `Tabs`, `Textarea`, `Toggle`,
and `Tooltip`.

Keep their Radix behavior, semantic slots, focus rings, disabled treatment, invalid state,
portal behavior, and keyboard support. Visual changes should happen through semantic tokens
and CVA variants, not through feature-local forks.

### Product components and patterns

| Area | Current modules | Reuse decision |
| --- | ---: | --- |
| App shell/navigation | 63 layout/header/sidebar modules | Keep responsive shell mechanics; redesign hierarchy and visual signature |
| Issues | 22 | Keep selectors, grouped/grid views, detail structure, filter plumbing; rename product copy and re-skin rows |
| Projects | 20 | Keep list/board/timeline and detail composition; make Berry progress/review states distinctive |
| Settings | 18 | Keep form/layout patterns; replace inherited categories with Berry capabilities |
| Data-table filters | 12 TSX modules plus filter core | Keep behavior and generic composition |
| Teams | 9 | **Removed.** Ported as "Crew", then dropped: it created a board and held its roster client-side with no persistence. Boards are the issue container; the orchestrator routes work to agents |
| Reviews | 7 | Keep diff mechanics; redesign around Berry's review gates and agent/human provenance |
| Cycles | 5 | Mostly removed with the team routes that hosted them; the cycle glyph and capacity ring remain in issue and project views |
| Initiatives | 5 | Defer until the Berry roadmap model is confirmed |
| Inbox | 4 | Kept and now the workspace landing route, fed by the server's notification projection |
| Members | 4 | Keep identity/profile basics; add agent identity as a peer actor type |
| My issues | 2 | Keep query/view composition; use Berry naming |
| Views | 2 | Keep saved-view mechanics |
| Agent | 1 | Replace inherited chat presentation with Berry run context, controls, provenance, and audit state |

### Shared product components

Above the primitives, `frontend/components/README.md` catalogues the shared product
components: the property pickers (`OptionPicker`, `PriorityPicker`, `StatusPicker`,
`LeadPicker`), `EmptyState`, `SegmentedControl`, `StatusBadge`, `ConfirmAction`,
`PageTitleBar`, the detail section labels and `StatTile`. Reach for one of these before
writing a feature-local copy of the same pattern, and add new shared components there with
their purpose, props, accessibility notes and what they replaced. Each has a Storybook file
whose `play` functions are its tests.

Cross-cutting patterns already present include a command palette, create-issue dialog,
responsive off-canvas sidebar, stacked headers, list/grid/board/timeline views, filter builder,
property selectors, empty/loading states, toasts, charts, diff views, and settings forms.

## How every page is set

The shared parts are in `frontend/components/common/page/page-parts.tsx`. They change how a page looks, not what it does.

- **A list page opens with `PageStatement`**: the page's name in small capitals (its `<h1>`), one figure in the display face, a sentence saying what the figure counts, and a quieter sentence saying when things leave or join the list. The figure counts what is open or waiting, never everything ever made. Leave `figure` undefined until the data has loaded, so a loading page does not claim zero. The page's one create action goes in its `children`; tabs, search and filters stay in the page's own header below it.
- **`SectionLabel`** (small capitals, `font-medium tracking-wider text-muted-foreground uppercase`) names a group, a column header row or a side-panel heading.
- **`Panel`** (`rounded-xl border bg-card p-5`) holds one subject on a detail page.
- **`Figure`** sets a number in the display face. Sizes are named in `app/globals.css` under `[data-figure]`; never use a `text-*` size utility.
- Rows that can be clicked are at least `min-h-11`.
- No charts outside Usage (next section).

## The Usage page's charts

**Charts are for Usage, and only Usage.** They were tried as a summary above every list in the app and removed: a page where someone works through a list, a queue or a form is slowed down by a chart above it, and the owner's call was that the chart-led style belongs to the one page whose whole purpose is to be read from its numbers. Do not add charts to another page without being asked to.

Usage is read from shapes before words. The parts live in `frontend/components/common/charts/charts.tsx`; the page composes them and never draws its own.

**The order of a tab.** One `PageHero`, then `ChartPanel`s in a 12-column grid (`grid gap-5 lg:grid-cols-12`, page padding `px-6 py-6`, `gap-5` between rows). The hero answers "how much, and is that good"; each panel answers one question, which is its title ("Who spent it", not "Agents").

**The hero.** Small-capital label saying what is counted and over what window; one figure at `hero` size; one plain sentence; two to four `Fact`s that tie the figure to something (per task, per run); a chart on the right showing how the figure came about. 

**Figures.** The number a panel is about goes through `<Figure size="hero|lg|md|sm">` (DM Serif Display, set in `[data-figure]` in `globals.css`). Never a `text-*` size utility: the lint rule forbids them. Everything else stays on the type scale. Numbers are `tabular-nums`.

**Picking the chart.**

| The question | Use |
| --- | --- |
| How did it move through time, with a second measure alongside | `SeriesBars` (top, and optionally bottom) |
| Who took which share, where a few dominate | `Treemap` |
| Shares of a whole, five or fewer | `Donut` |
| One ratio | `Gauge` |
| One value per row against a reference | `Lollipops` |
| Two measures against each other | `Scatter` |
| Where the middle and the bulk of a spread sit | `RangeStrip` |
| A small count that should stay countable | `Squares` |
| Shares of one total in a line | `ShareStrip` |

**Colour.** Tokens only, so both themes hold. `bg-foreground` is the main measure. `status-success` is work finished, `status-info` is activity (runs, calls), `status-warning` marks a reference or something worth a look. `status-danger` is for a state a person must act on, never for decoration, and never as the headline of a page: a page leads with what was produced, not with what failed. Shade by rank with `color-mix(in oklab, <token> N%, var(--card))`, as `Treemap` and `ShareStrip` do.

**Numbers are real.** A chart shows what the page has already loaded, or what an existing `lib/` fetcher returns. No placeholder series, no invented trend. When there is nothing to show, the panel says so in a sentence (`text-muted-foreground`) rather than drawing an empty frame, and a page with no data at all keeps its existing empty state.

**Accessible as drawn.** Every chart takes a `label` that says in words what it shows; it is the `aria-label` of a `role="img"`. Rows that lead somewhere are real links with a 44px target. Colour never carries meaning alone: a figure or a label says it too.


## Reuse versus re-skin boundary

### Safe to reuse

- MIT-licensed source with its notice retained.
- Radix/shadcn primitive architecture and accessibility behavior.
- Semantic token wiring, dark-mode mechanism, responsive drawer mechanics, form plumbing,
  table/filter logic, resizable panels, charts, and generic loading/empty-state structures.
- Neutral information architecture concepts such as issues, projects, teams, members,
  settings, search, filters, and saved views.

### Must be renamed, redesigned, or validated

- Product name, icon, favicon, page metadata, URLs, sample organizations, people, and copy.
- Any terminology borrowed from another product rather than required by Berry's domain.
- Sidebar grouping/order, compact stacked headers, issue-row composition, keyboard shortcuts,
  command-menu grouping, board cards, property panel, and issue-creation flow as a combined
  visual/interaction signature.
- Neutral monochrome palette plus purple/indigo accents. A final Berry palette must create a
  distinct identity and pass contrast checks in each supported theme.
- Icons and status glyphs where their shape/color pairing makes the interface look like a
  specific third-party product. Use one documented icon family and Berry-specific state
  mappings.
- The generic `agent chat` concept. Berry needs an execution surface with run status,
  permissions, budget, review gate, evidence, logs, pause/cancel controls, and audit history.
- Theme names such as `magic-blue` and `classic-dark`; rename these only after the final
  palette and theme strategy are approved.

Avoiding likeness is a system-level task: changing a logo or accent color alone is
insufficient. At least navigation hierarchy, workspace framing, row/card anatomy, status
language, agent representation, and review interactions should express Berry's model.

## Confirming irreversible actions

Anything that cannot be undone from the app - delete, remove, revoke, uninstall, leave -
confirms through `components/common/confirm-action.tsx`, a wrapper over the `AlertDialog`
primitive. The rule it encodes: the title asks the question and names the thing ("Revoke
this key?"), the body states the consequence (what stops, what is lost, whether it can be
undone), and the confirm button carries the verb ("Revoke", "Delete forever"), never "OK".

`ConfirmAction` takes `open`/`onOpenChange`, `title`, `description`, `confirmLabel`, an
optional `cancelLabel` (defaults to the common "Cancel"), `destructive` to paint the button,
`children` for a typed-name field or an affected list, `confirmDisabled` to hold the button
until a precondition is met, `pendingLabel`, and `onConfirm`, which may return a promise.
While that promise is pending the dialog cannot be dismissed and both buttons are held; it
closes on success and stays open on failure, so the caller toasts the reason and the reader
can try again or back out. `window.confirm` (no pending state, no styling, no focus
management) and a plain `Dialog` (closes on Escape mid-request) are not acceptable here.
Reversible actions - archive with a restore, signing a device out - do not confirm.

## Required states and accessibility contract

Every interactive component or product pattern must specify:

- default, hover, active/pressed, keyboard focus-visible, disabled, loading, error/invalid,
  and success where applicable;
- empty, partial-data, offline/reconnecting, stale, and permission-denied states for
  networked views;
- agent states: queued, running, awaiting input, awaiting review, paused, succeeded, failed,
  cancelled, and budget-limited;
- review states: pending, changes requested, approved, superseded, and merged/released.

Baseline requirements:

- WCAG 2.1 AA contrast: 4.5:1 for normal text, 3:1 for large text and meaningful UI
  graphics; verify semantic pairs in every theme.
- Keep the visible 3 px focus treatment in primitive controls and never communicate state by
  color alone.
- Icon-only controls require an accessible name and tooltip where the action is not obvious.
- Dialogs/sheets need a title and description, focus containment, Escape handling, and focus
  restoration; preserve the Radix implementation.
- Dense desktop targets may be 32–36 px when spacing prevents accidental activation; aim for
  44 px targets on touch layouts.
- Announce asynchronous run/review changes with an appropriate live region without flooding
  screen-reader output. Preserve user control over auto-scroll.
- Charts and diffs require text summaries or equivalent structured data, not color-only
  interpretation.

## Adoption checklist

1. Treat the Brand Manual palette and the semantic state/actor aliases as the baseline for
   all revised surfaces.
2. Centralize layout dimensions, motion durations, and repeated micro typography in tokens.
3. Replace hard-coded palette utilities in feature components with semantic status tokens.
4. Build a primitive/state showcase for light, dark, high-density desktop, and mobile.
5. Redesign the app shell, issue row/card, agent execution surface, and review gate first;
   these establish the strongest Berry identity.
6. Run automated and manual keyboard, screen-reader, reduced-motion, zoom, contrast, and
   responsive checks before calling the system stable.
