# Ledger redesign — implementation plan

How direction 2A ("Ledger") from `~/Web/berry-redesign` becomes the Berry frontend.

This is a plan, not a change. Nothing in `frontend/` has been touched yet. It exists to be
argued with before any code moves: §5 lists the decisions that are not mine to make.

## 0. Sources of truth, and what is not one

| Source | Status for implementation |
| --- | --- |
| `berry-redesign/ledger/tokens.css` | **Spec.** Colour, type, space, radius, control sizing. Every colour pair carries a measured contrast ratio. |
| `berry-redesign/ledger/components.css` | **Spec.** 1316 lines, ~105 classes. This is what ends up in the product. |
| `berry-redesign/DECISIONS.md` | **Spec.** Why each choice exists and which review finding it answers. Read before changing a value. |
| `berry-redesign/INVENTORY.md` | 53 screens, 35 recurring components, 28 findings. The checklist. |
| `berry-redesign/ledger/screens/*.html` | Worked examples, markup + sample data. Reference, not product. |
| `berry-redesign/ledger/audit.js` | Verification tool. Worth porting (§8), not shipping. |
| `berry-redesign/ledger/shell.js`, `guide.css` | **Not product.** Scaffolding and gallery chrome; discarded. |
| `berry-redesign/directions/2b`, `2c` | **Not maintained.** The record of how 2A was chosen. |

The redesign is explicitly **UI-only**: no feature, field, label meaning or navigation path
changes. Anything that would need behaviour to change is listed in `DECISIONS.md` §5 and stays
out.

## 1. The invariants

These eight survive implementation or the redesign was not implemented. From `DECISIONS.md` §2.

1. **Two voices, by meaning.** Mono (JetBrains Mono) carries identifiers *and* figures; sans
   (Inter) carries every sentence, display heading and the wordmark. Weight is what separates
   mono's two jobs: an identifier is 400–500 and small, a figure is **700** with tabular
   numerals. There is no serif — it was dropped deliberately.
2. **Typeface encodes layer.** `data-depth="back|mid|front"` re-voices chrome labels, headings,
   tabs, buttons and chips: mono at back and mid, Inter at front. **Content never moves** —
   identifiers stay mono and figures stay 700 mono at every depth.
3. **The palette is monochromatic.** The neutral ramp carries all state. The berry accent is
   spent on exactly two things: the primary action, and the one state that needs a person (review
   gate, "waiting on you", a column at its WIP ceiling). Nothing else gets colour.
4. **State is told by value and by the word, never by hue alone.** Rest lightest, running mid
   plus a pulsing dot, done darkest, stopped the only outlined pill — each also labelled in
   words. Any screen must survive greyscale.
5. **Readability floor.** Nothing renders text below 12px; uppercase tracked labels start at
   13px. Where that costs width, shorten the label rather than shrink it.
6. **44px targets.** WCAG 2.5.8. `--ctl-h: 44px` is every button, tab, input and nav item, at
   real height — not faked with a pseudo-element. Only two controls draw smaller and extend
   their hit area: the switch and the board's column `+`.
7. **Dark mode is a peer, not a filter.** `[data-theme]` switches a full second token set, each
   pair carrying its measured ratio.
8. **One stylesheet.** A visual that does not exist goes into the shared layer so the next screen
   inherits it, never into a single screen.

## 2. Colour

### 2.1 The lever that makes this cheap

106 files under `frontend/` reference `--status-*`, `--actor-*` or `--review-*`. The redesign
keeps those names and **redefines their values to neutrals** — which is exactly how it was built
("the names stay so the 34 screens that already use them inherit this without being edited").

So the monochrome repaint is one edit to `frontend/app/globals.css`, not 106 edits. The
`--column-tint-*` and `--group-tint-*` mixes follow automatically, since they `color-mix` the
same `--status-*` tokens.

One exclusion: **`--shell-*` is not in this map.** The shell stays dark in both themes (§6.5), so
it takes the dark ramp (§2.3) permanently rather than following the theme.

### 2.2 Light (content)

| Ledger | Value | Berry token |
| --- | --- | --- |
| `--canvas` | `#FAFAFA` | `--background` |
| `--surface` | `#FFFFFF` | `--card`, `--container`, `--popover` |
| `--raised` | `#F5F5F5` | `--secondary` |
| `--sunken` | `#F0F0F0` | `--muted`, `--accent` |
| `--line` | `#E6E6E6` | `--border` |
| `--line-2` | `#D4D4D4` | `--input` |
| `--tx` | `#010101` | `--foreground`, `--card-foreground` |
| `--tx2` | `#4D4D4D` | `--muted-foreground` |
| `--tx3` | `#6A6A6E` | `--subtle-foreground`, `--placeholder` |
| `--pri-a` → `--pri-b` | `#C9325C` → `#9E1138` | `--primary` (a **gradient**, 180°, white label: 5.12:1 top, 8.10:1 bottom) |
| `--accent-tx` | `#A8123F` | `--primary-text` (7.4:1 on surface) |
| `--accent-soft` | `#FDEFF3` | tint behind "needs you" |
| `--focus` | `#C41E4B` | `--ring` — **currently `--brand-azure`; the focus ring becomes berry** |
| `--ok` / `--ok-soft` | `#2E2E2E` / `#ECECEC` | `--status-success`, `--review-approved` — done |
| `--info` / `--info-soft` | `#56565A` / `#F2F2F2` | `--status-info` — running |
| `--agent` / `--agent-soft` | `#4D4D4D` / `#F2F2F2` | `--actor-agent` |
| `--plan` / `--plan-soft` | `#4D4D4D` / `#F2F2F2` | plan chips |
| `--bad` / `--bad-soft` | `#1F1F1F` / `#FFFFFF` | `--status-danger` — stopped, **outlined** |
| `--warn` / `--warn-soft` | `#A8123F` / `#FDEFF3` | `--status-warning`, `--review-pending`, `--actor-human` — the **only** coloured state |
| `--gate-bg` / `--gate-tx` | `#A8123F` / `#FFFFFF` | the review gate button |
| `--add` / `--del` | `#177034` / `#A01C16` | **diffs only.** A notation, not a state. |
| `--av-agent` / `--av-person` | `#3D3D3D` / `#6A6A6E` | avatar fills |
| `--mine` / `--mine-line` | `#F3E2EA` / `#E6CEDA` | your own chat bubble |

### 2.3 Dark

| Ledger | Value |
| --- | --- |
| `--canvas` / `--surface` / `--raised` / `--sunken` | `#0A0A0B` / `#121214` / `#1A1A1D` / `#17171A` |
| `--line` / `--line-2` | `#262629` / `#333338` |
| `--tx` / `--tx2` / `--tx3` | `#F6F6F7` / `#A8A8AE` / `#8A8A93` |
| `--accent` / `--accent-tx` / `--accent-soft` | `#E85075` / `#F0738F` / `#2A1018` |
| `--ok` / `--info` / `--agent` / `--bad` / `--warn` | `#E4E4E8` / `#A8A8AE` / `#A8A8AE` / `#F2F2F4` / `#F0738F` |
| `--gate-bg` / `--gate-tx` | `#F0738F` / `#1A0A10` — dark ink on accent; white was 2.9:1 |
| `--add` / `--del` | `#5BD98A` / `#FF8A8A` |
| `--focus` | `#E85075` |

`--pri-a`/`--pri-b` are shared by both themes on purpose: one pair to audit.

### 2.4 What leaves

`--brand-verdant`, `--brand-azure`, `--brand-amber`, `--brand-iris` stop carrying state. They may
survive as raw palette entries for charts (§5d), but no status, actor or review token resolves to
a hue again. Re-adding a green "done" or a blue "running" reverts invariant 3.

## 3. Shape

| Property | Now | Ledger | Impact |
| --- | --- | --- | --- |
| Control height | `--control-height: 30px` | `--ctl-h: 44px`, `--ctl-h-lg: 48px` | **Highest. Every toolbar, row and form re-flows.** See §5a. |
| Coarse pointer | — | every control steps to 48px | new `@media(pointer:coarse)` rule |
| Control radius | `--radius-control: 7px` | `--r-pill: 999px` | buttons, inputs, pills all pilled |
| Card radius | `--radius: 10px` | `--r-card: 20px` | plus `--r-xs: 6`, `--r-sm: 10`, `--r: 14` |
| Horizontal padding | varies | `--ctl-px: 14px` | |
| Type scale | 13 / 15 / 17 / 22 / 28px | 12 / 13 / 14 / 15 / 17 / 21 / 26px | body default 14px |
| Figure scale | — | 16 / 22 / 32 / 40px, weight 700, tabular | new voice |
| Line height | 1.2–1.45 | 1.3 tight / 1.55 / 1.7 prose | prose gets looser |
| Space | ad hoc | 4pt grid: 2/4/8/12/16/20/24/32/40 | |
| Elevation | "almost no shadow" | `--sh`, `--sh-pop`, `--sh-over` | three real levels |
| Pill | `rounded-md px-3 py-1` | `min-height: 26px`, pilled, gap 7px | |
| Avatar | `ui/avatar.tsx` | 28px / 40px; **round = person, rounded-square + bracket = agent**, two neutral tones | shape carries actor type, not hue |
| Min width | — | `min-width: var(--ctl-h)` on buttons | an icon-only button is 44×44, not 44×30 |
| Breakpoints | Tailwind defaults | 1180 / 1080 / 960 / 900 / 880 / 860 / 700 / 620 / 560 | the shell breaks at **900** (sidebar → drawer) |

## 4. Component inventory

The 35 recurring components from `INVENTORY.md` §C against what `frontend/` already has. 372
component files and 93 routes exist, so most of this is re-skinning, not building.

Strategy legend: **retoken** = inherits from §2 with no edit · **re-skin** = classes change,
structure holds · **re-shape** = markup/layout changes · **build** = does not exist.

### Frame

| # | Component | Existing | Strategy |
| --- | --- | --- | --- |
| 1 | App shell | `components/layout/main-layout.tsx`, `layout/shell/` | re-shape — 240px sidebar, off-canvas drawer below 900px |
| 2 | Sidebar | `layout/sidebar/` | re-skin — 44px nav items, mono group labels, figure counts, `.hot` for owed work |
| 3 | Page top bar | `common/page/`, `layout/headers/` | re-skin — title + search + primary action; **drawer trigger lives here, in flow** (finding B6) |
| 4 | Settings shell | `common/settings/shared.tsx` | re-shape — grouped side nav collapses to a dropdown |
| 5 | Breadcrumb bar + record pager | `layout/headers/` | re-skin — `data-depth="mid"`, so the record title turns Inter |

### Summary

| # | Component | Existing | Strategy |
| --- | --- | --- | --- |
| 6 | Count lede | — | **build** — oversized figure + "`<n>` things are `<state>`" + one line |
| 7 | KPI tile | `common/charts/charts.tsx`, usage/issues panels | re-skin — collapses to a compact row on narrow screens so the list is what you land on |
| 8 | Fact column / fact table | `common/issues/details/` | re-skin — label/value pairs, figures in mono 700 |

### Collections

| # | Component | Existing | Strategy |
| --- | --- | --- | --- |
| 9 | Toolbar | `common/filters/`, `common/views/` | re-shape — **wraps instead of overflowing** (report §6, autopilots) |
| 10 | Grouped list | `common/issues/` | re-skin |
| 11 | Task row | `common/issues/` | re-shape — meta line is a list of facts, not a sentence; trailing chip pinned to the last track |
| 12 | Board column + card | `common/issues/` board views | re-shape — **every status column renders, empty or not**; scroll shadows; arrow keys move one whole column; WIP ceiling cue |
| 13 | Data table | `common/agents/`, `common/skills/`, `components/data-table-filter/**` (vendored, `any`-exempt) | re-shape — **below desktop a row becomes a stacked record carrying every field**, no dropped columns |
| 14 | Card grid | `common/settings/` agents + labels | re-skin — 3-up |
| 15 | Split view | `common/inbox/`, `plans/`, `goals/`, `reviews/` | re-shape — **the detail pane always says something** |

### Detail surfaces

| # | Component | Existing | Strategy |
| --- | --- | --- | --- |
| 16 | Properties rail | `common/issues/details/` | re-shape — **becomes a section of the page below desktop, never deleted** (report §6, the worst one) |
| 17 | Section block | widespread | re-skin — small uppercase heading + content + empty line |
| 18 | Activity line | `common/issues/details/` | re-skin |
| 19 | Transcript entry | `common/runs/` | re-skin — kind tag, title, duration, status tick, expandable code block |
| 20 | Summary / prose block | `common/agent-markdown.tsx` | re-skin — bordered panel |
| 21 | Comment composer | `common/issues/details/` | re-skin — pinned to the bottom of the pane |

### Atoms

| # | Component | Existing | Strategy |
| --- | --- | --- | --- |
| 22 | Status pill | `common/status-badge.tsx` | **retoken** — already a mark + a word (invariant 4 is half-satisfied today); `BerryMark` keeps tone/state/pulse, the hues go neutral |
| 23 | Chips — model, autonomy, label, agent, state | `common/meta-badge.tsx`, `common/pickers/` | retoken + re-skin; **label colour survives as a swatch**, see §5.1 |
| 24 | Avatar | `ui/avatar.tsx` | re-shape — square variant with the bracket mark for agents, two neutral tones |
| 25 | Buttons | `ui/button.tsx` | **re-shape** — 44px, pilled, gradient primary, plus three variants that do not exist: `.dark`, `.gate` (draws 32, touches 44), `.spark` (the animated ring for "hand it to an agent") |
| 26 | Form controls | `ui/input,textarea,select,switch,checkbox,form.tsx` | re-shape — 44px real height; the switch keeps its hit extender; select per §5e |
| 27 | Key cap | `common/settings/` shortcuts | re-skin / verify |
| 28 | Inline alert | — | **build** — error/warning/info under a form; answers finding B1 (raw 500 text) |

### Transient

| # | Component | Existing | Strategy |
| --- | --- | --- | --- |
| 29 | Modal | `ui/dialog.tsx` | re-skin + `data-depth="front"` |
| 30 | Slide-over | `ui/sheet.tsx`, `layout/detail-drawer-shell.tsx` | re-skin + `data-depth="front"`; also hosts task properties on small screens |
| 31 | Menu | `ui/dropdown-menu.tsx`, `ui/command.tsx`, `ui/context-menu.tsx` | re-skin — the agent picker gains **search and real groups** (finding §5, 20 items under "Others") |
| 32 | Tabs | `ui/tabs.tsx` | re-shape — two variants: pill (agent detail) and underline (autopilot, review) |
| 33 | Empty state | `common/empty-state.tsx` | re-shape — **a primary action becomes required**, not optional (findings on Projects, Plans, Goals) |
| 34 | Toast | `ui/sonner.tsx` | re-skin — present in Berry, absent from the reference; the redesign asks for it |

### Charts

| # | Component | Existing | Strategy |
| --- | --- | --- | --- |
| 35 | Bar, donut, ranked bars, treemap, sparkline, progress | `common/charts/charts.tsx`; **recharts** in `projects/details/project-progress-chart.tsx`, `usage/usage-daily-chart.tsx`, `issues/insights-panel.tsx` | **decision required** — the spec says "all built from CSS, no library" (§5d) |

## 5. Decisions I am not making alone

Each of these changes the plan's size or breaks an invariant. They need your call before phase 1.

**a) 44px controls vs Berry's density.** The single highest-impact item. Berry draws a 30px
control and a 40px row today; Ledger draws 44/48 and argues it at length — WCAG 2.5.8, and "for
an app someone sits in all day that floor is the whole point of this pass". Adopting it costs
roughly a third more vertical space in every list and toolbar. The spec is emphatic and I
recommend following it, but it is a product density decision, not a styling one. Partial adoption
(44 for touch, 36 for pointer) is the compromise the redesign explicitly rejected as "two sizes,
one of them a lie".

**b) Light theme — RESOLVED: yes.** Berry is dark-only *by decision* today:
`app/layout.tsx` hardcodes `className="dark"` with the comment "next-themes injected an inline
script React 19 refuses to run", and `globals.css` states the shell stays dark in both themes
because "it is chrome, not content". Ledger's invariant 7 makes light and dark peers, and every
screen is drawn light-first. The platform work this implies is specified in **§6**. The shell's
own carve-out is also resolved — it stays dark in both themes (§6.5) — leaving only where the
boundary falls around chat (§6.5.1).

**c) Inter has to be shipped locally.** Only `jetbrains-mono-variable.ttf` exists in
`frontend/app/fonts/`, and the existing comment rules out `next/font/google` ("Turbopack fails
once Google's font URLs carry their own query string"). So Inter is a vendored variable font
file, +1 web font on first paint. Confirm that is acceptable, and confirm the licence note goes
where the Circle MIT notice lives.

**d) recharts, or CSS-only charts.** The spec's charts are all hand-built CSS with no library.
Berry has recharts in three components. Options: keep recharts and re-skin it to the tokens
(cheap, deviates from spec, keeps the dependency), or rebuild the six chart shapes in CSS
(matches spec, drops a dependency, costs real work and re-tests the Usage page). I lean toward
re-skinning recharts first and treating CSS-only as a later phase, since none of the invariants
depend on it.

**e) `appearance: base-select` vs Radix Select.** The spec opts every `<select>` into
`appearance: base-select` with an authored `<button><selectedcontent>` child, to stop the OS
drawing the option list. Berry already uses Radix Select, which renders real styled DOM and
achieves the same end with far better support. I recommend keeping Radix and treating the spec's
intent — "the list is real DOM wearing the menu surface, the current option marked by tick and
weight, never by hue" — as the thing to satisfy. Flagging it so the deviation is on the record.

**f) How `data-depth` is expressed in Tailwind v4.** Invariant 2 is a cascade mechanism: a
container attribute re-binds `--chrome-face` / `--title-face` for everything inside. That is
plain CSS in `globals.css` plus a handful of component classes reading those variables — it does
not translate into utility classes. Expect a small authored CSS layer alongside Tailwind, which
is a departure from how `frontend/` is written today and should be agreed, not discovered in
review.

## 5.1 Not an open decision — label colour

Worth recording because it looks like a collision with invariant 3 and is not. Task labels store
a `color` chosen by a person (`lib/labels.ts`, `settings/task-labels`), and the spec keeps it,
deliberately. Screen 34 says so in the page's own lede:

> A label's colour is the one piece of colour in Berry you choose yourself — the interface is
> otherwise monochrome, so a swatch here reads as yours.

So the monochrome palette is what *gives* user colour its meaning rather than what forbids it.
The carrier is `.swatch`: 14×14, 5px radius, an inset hairline at 35% grey, and nothing else in
the kit may use the colour. Implementation keeps the stored value, confines it to the swatch, and
never lets it reach a pill background, a row tint or a border that carries state.

## 6. Preparing the platform for light mode

Light mode is in (§5b, resolved: yes). This is what it actually takes, and it is far less than it
looks — three of the four layers already exist.

### 6.1 The server is already done

`theme` is an existing user setting. No migration, no API work, no contract change:

- `server-ts/src/identity/repository.ts` stores it in the user settings JSONB and defaults it to
  `'system'`.
- `server-ts/src/mounts/me.ts` validates it against `THEMES` — `system | light | dark` — and
  rejects anything else with `invalid_enum_value` on `/theme`.
- `GET`/`PATCH /api/v1/me/settings` already serve and accept it, alongside `timezone`,
  `reducedMotion` and `locale`.
- The bootstrap payload already carries `user.settings.theme`.

So the platform work is entirely in `frontend/`.

### 6.2 The codebase is token-pure, which is why this is affordable

Measured, not assumed:

| Check | Count | Reading |
| --- | --- | --- |
| Hardcoded hex in class names (`bg-[#…]`) | **0** | nothing bypasses the token layer |
| Raw Tailwind palette utilities (`bg-emerald-500`…) | **7**, in 3 files | `issues/details/preview-panel.tsx`, plus 2 vendored `data-table-filter/` files |
| Files using the `dark:` variant | **10** | all in `components/ui/`, and all of them `dark:aria-invalid:ring-destructive/40`-style shadcn boilerplate — no layout or colour assumption |
| `--shell-*` token usages | **239**, in 35 files | concentrated in `common/chat` (17) and `layout/shell` (12) |

The 239 shell usages matter for §6.5 but cost nothing to flip: they all read `--shell-*`, so
re-theming the shell is a token edit, not 239 edits. `AGENTS.md`'s "prefer semantic design tokens
over raw palette utilities" was evidently enforced, and light mode is collecting the dividend.

### 6.3 The locale feature is the template, and it dissolves the next-themes problem

`app/layout.tsx` says the theme is a static class because "next-themes injected an inline script
React 19 refuses to run". That constraint only exists if the *browser* decides the theme. Berry
already solved the identical problem for language, and the answer is to let the **server** decide:

| Locale (exists) | Theme (to build) |
| --- | --- |
| `i18n/request.ts` reads `LOCALE_COOKIE` via `next/headers` `cookies()` | read a `THEME_COOKIE` the same way in `app/layout.tsx` |
| `lib/i18n/locales.ts` — `resolveLocale(cookie, acceptLanguage)` | `lib/theme/resolve.ts` — `resolveTheme(cookie)` |
| `lib/i18n/client-locale.ts` — writes the cookie from the browser | `lib/theme/client-theme.ts` — same shape |
| `components/layout/locale-sync.tsx` — "the account is authoritative; the cookie is what the server can read" | `components/layout/theme-sync.tsx` — same contract |

Because the server renders the right class on `<html>` in the first byte, there is **no inline
script, no flash, and no hydration mismatch**. That is the whole reason to copy this pattern
rather than reach for a theme library again.

### 6.4 `system` is the only genuinely hard part

`system` is a third stored value that CSS and the server resolve differently: the server cannot
read `prefers-color-scheme` (it is not a header unless you negotiate client hints). Two ways out:

**Recommended — the cookie stores the *resolved* theme.** `system` stays the stored *preference*;
the cookie only ever holds `light` or `dark`. A `matchMedia('(prefers-color-scheme: dark)')`
listener rewrites the cookie and calls `router.refresh()` when the OS flips, exactly as
`LocaleSync` refreshes on disagreement. The server then only ever renders two explicit states, so
`globals.css` needs two token blocks and no duplicated media query. Cost: a first-ever visit with
no cookie renders the default before the listener corrects it — and the default should be light
anyway, since Ledger is drawn light-first and the sign-in screen is the common first paint.

**Alternative — `light-dark()`.** `--tx: light-dark(#010101, #F6F6F7)` with `color-scheme: light
dark` on `:root` collapses every token pair into one declaration, supports `system` natively, and
removes even the first-visit flash. It is the cleaner CSS by some distance. Two catches: it is
roughly a 2024-baseline feature, and Tailwind's class-based `dark:` variant does not participate
— which matters little here given §6.2's finding that all 10 `dark:` usages are boilerplate.

I recommend the first and would revisit the second if the first-paint flash proves visible.

### 6.5 The shell stays dark — decided

`globals.css` states the shell is dark in both themes on purpose — "it is chrome, not content: the
tab strip and rail frame the workspace the way a browser frames a page, and inverting them with
the content theme would make the frame compete with what sits inside it." Ledger disagrees by
construction: every screen is drawn light, shell included.

**Decided: the shell stays dark, in both themes.** The existing reasoning stands — the shell is
chrome, it frames the workspace, and a frame that follows the content theme competes with what it
contains. Ledger's light palette applies to **content only**.

This is a deliberate, recorded deviation from the spec. All 53 screens draw the rail and tab strip
light, so anyone comparing an implemented page against `reference/berry-screenshots` or a Ledger
screen will find a mismatch there and must not "fix" it. The shell takes Ledger's **dark** ramp
(§2.3) in both themes, which is also where its measured contrast ratios come from.

### 6.5.1 Where the boundary falls, and the surfaces it leaves open

"The shell" has to mean something specific, because the 35 files that read `--shell-*` today are
not all chrome. Measured:

| Group | Files | Verdict |
| --- | --- | --- |
| `components/layout/shell/` — rail, tab strip, workspace menu, pins, badges | 12 | **Chrome.** Stays dark. Correct as it is. |
| `components/common/chat/` | 17 | **Content wearing chrome's clothes.** See below. |
| `layout/navigation-progress.tsx`, `layout/sidebar/customize-sidebar-dialog.tsx` | 2 | Chrome-adjacent; keep on shell tokens. |
| `common/settings/shared.tsx`, `common/projects/details/detail-section-label.tsx`, `common/composer-palette.tsx` | 3 | **Content.** Re-token to content tokens. |

**Chat is the real consequence of this decision, and it is not obvious.** Chat paints itself with
chrome colours today — `bg-[var(--shell-canvas)]`, `text-[var(--shell-text)]`,
`bg-[var(--shell-accent)]` and so on across 17 files — but chat is a page, screen 10 in the
inventory, and Ledger draws it light with its own content tokens: `.chat`, `.msgs`, `.msg`,
`.composer`, and `--mine` for your own bubble. `--mine`'s light value `#F3E2EA` and its measured
16.78:1 against `--tx` only mean anything on a light surface.

**And chat is not alone.** The same pattern exists for the board, stated just as deliberately:
`--board-column-body: #19191c` and `--board-card-line` are dark in both themes, with the comment
"the board's cards are dark in both themes… stated once here with no `.dark` counterpart, so the
two cannot drift" — and it introduces itself as "flat and theme-independent, **like the shell**".
It is consumed by `issues/issue-grid.tsx`, `issues/group-issues.tsx`,
`projects/project-grid.tsx` and `projects/group-projects.tsx`. Ledger draws the board light too
(screen 21: `.board`, `.col`, `.colh`, `.bcard`).

So "the shell stays dark" leaves one question to settle once, rather than three times: **which
content surfaces are dark by decision, and do they stay that way in light mode?** Today that set
is the rail and tab strip (chrome, settled), chat, the board and projects grid, and 3 stray
files.

- **Chrome is the rail and the tab strip only.** Chat, the board and the strays are content, get
  re-tokened in phases 4–5, and turn light with the rest of the product. Matches Ledger screens
  10 and 21 and makes `--mine` usable. Costs the largest re-token in the plan — 17 chat files
  that currently hold no content tokens at all, plus 4 board files.
- **Dark surfaces are a signature, not an accident.** Chat and the board stay dark in both
  themes, as they are written to today. Nothing to do, and the current look is preserved, at the
  cost of a light mode with its two densest screens still dark and `--mine` unused.

I read the first as what you meant — you said the shell is the chrome, and chat and the board are
destinations inside the frame, not the frame — but flagging it because it is the difference
between re-tokening 21 files and re-tokening none, and because the board's own comment explicitly
aligns itself with the shell, so a reader could fairly conclude the opposite.

### 6.6 Work items

1. `lib/theme/` — `resolveTheme`, `THEME_COOKIE`, the client cookie reader/writer, mirroring
   `lib/i18n/`.
2. `app/layout.tsx` — read the cookie server-side and render the resolved class on `<html>`,
   replacing the hardcoded `className="dark"`.
3. `components/layout/theme-sync.tsx` — reconcile account preference, cookie and the OS
   listener; mounted beside `LocaleSync`.
4. `globals.css` — a real light token block per §2.2 (today's light values are the pre-Ledger
   palette) and the dark block per §2.3. Keep the `.dark` class rather than the spec's
   `[data-theme]`: it is Tailwind-native, `@custom-variant dark` already points at it, and the
   attribute carries no meaning the class does not. **Leave `--shell-*` outside both blocks** —
   it is stated once, dark, with no counterpart, which is how `--board-column-body` already
   handles the same problem and the comment there explains why: "stated once here with no `.dark`
   counterpart, so the two cannot drift".
5. Settings → Preferences — a three-way control. The slot already exists:
   `common/settings/shared.tsx:199` takes an "optional controlled value (e.g. wired to
   next-themes)", and `preferences.tsx:37` carries the line to delete — "Theme is Berry dark,
   always; there is no picker."
6. The 7 raw palette utilities — re-token the 3 in `preview-panel.tsx`; the 4 in
   `data-table-filter/` are vendored, so decide whether to patch or leave with a note.
7. Verify the 10 `dark:` boilerplate usages still read correctly once light is reachable, since
   nothing has ever rendered them in light.
8. The 3 content files reading `--shell-*` (§6.5.1) — `settings/shared.tsx`,
   `projects/details/detail-section-label.tsx`, `composer-palette.tsx` — move to content tokens,
   or they stay dark islands once light is reachable. Chat's 17 files and the board's 4 are the
   same problem at scale and wait on §6.5.1.
9. A seam check. A dark shell against a light canvas is a contrast pair that does not exist today
   and is not in Ledger's measured set, since Ledger has no dark shell. The rail's edge against
   `--background` needs measuring like any other non-text cue (3:1).

## 7. Phases

Each phase ends green on `pnpm lint` + `pnpm build:check` in `frontend/`, with the §8 checks for
what it touched. One issue per branch and PR, per `AGENTS.md`.

**Phase 0 — infrastructure.** Resolve §5a, §5c and §5f, and the chat question in §6.5.1. Build
the light-mode platform per §6.6; ship Inter; port `audit.js` into a runnable check (§8). The
theme plumbing lands here with today's palette still in place, so phase 0 is verifiable on its
own: light mode becomes *reachable* before it becomes *correct*. No visual change otherwise.

**Phase 1 — tokens.** One edit to `app/globals.css`: the §2 colour map, the §3 type/space/radius/
control scales, the `data-depth` layer. This is the phase where 106 files change appearance
without being edited. Expect it to look broken in places — phases 2–5 are what fix that — so it
goes behind a branch, not onto main.

**Phase 2 — primitives.** `components/ui/*`: button (incl. `.dark`, `.gate`, `.spark`), input,
textarea, select, switch, checkbox, badge, avatar, tabs, dialog, sheet, dropdown-menu, sonner.
Storybook already has a story per primitive, which is the harness.

**Phase 3 — shell and chrome.** Components 1–5: app shell, sidebar, top bar, settings shell,
breadcrumb. Includes the drawer done honestly — trigger in the title bar, scrim, Escape, and the
drawer starting below the title bar measured from its geometry. The six screens that had an app
shell and no drawer trigger at all are part of this.

**Phase 4 — collections.** Components 6–15 plus the atoms they carry: count lede, KPI tile, fact
column, toolbar, grouped list, task row, board, data table, card grid, split view.

**Phase 5 — detail surfaces.** Components 16–21, led by the Properties rail becoming a section
rather than vanishing.

**Phase 6 — charts.** Per §5d.

**Phase 7 — the findings sweep.** Walk all 28 findings in `INVENTORY.md` §D and confirm each is
answered on the real screen, not just possible in principle. Several are copy and state, not
layout: one date format (`22 Sep 2026`, plus `, 13:45` only where the time is load-bearing),
"Online · Never reached" split into two facts, unpriced models shown as unknown rather than `$0`,
the onboarding step indicator, naming all three permanent things, and the ready screen stating
what was created with a way to switch it off.

## 8. Verification

The redesign's own bar is the one to meet: **1280 and 390, in both themes, every screen** — 212
runs for its 53 screens, returning no contrast, target, squeeze or label failure and no positive
overflow.

- **Port `audit.js`.** It composites the real background behind every piece of text before
  measuring, which is why it catches what a static token review cannot. `@storybook/addon-a11y`
  and `@storybook/addon-vitest` are already installed, so a Storybook run is the natural home.
- **`pass` is the whole verdict.** The upstream file had a bug where a target failure still
  returned `pass: true`; if the port keeps the structure, keep the fix.
- **The audit cannot see one box covering another.** B6 — the floating drawer trigger over the
  content — survived three clean audits and had to be caught by measuring rectangles. For any
  change about position rather than colour, measure positions.
- **Per phase:** `pnpm lint`, `pnpm build:check` (writes `.next-verify`, safe while `next dev`
  runs), Storybook for touched primitives, and a manual pass of the changed view at 1280 / 820 /
  390 in both themes.

## 9. What this plan does not cover

Behaviour and backend findings (`DECISIONS.md` §5), including B5's real fix — the agent tab
slide-over is drawn and labelled as a bug (screen 40e) rather than silently repaired, so the
report and the guide keep lining up. No feature is added or removed. Server, API contract and
schema are untouched: this is `frontend/` only.
