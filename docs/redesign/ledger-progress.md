# Ledger redesign — progress

Running status against the phases in `ledger-plan.md` §7. Kept current so work
survives a chat compaction or a handoff; it is a log, not a second plan.

## Done

- **Phase 0–1 (infra + tokens).** Ledger palette + light mode, Inter, isotipo,
  44px floor on buttons/fields, pill/card radius tokens (`--radius-pill`,
  `--radius-card`), `--chip-h`.
- **Phase 2 (primitives).** Closed in commit `ad7c7dc`
  (`feat(frontend): finish Ledger phase 2 primitives`):
  - `button`: added the `dark` variant (foreground fill, theme-flipping),
    completing `.dark`/`.gate`/`.spark`.
  - `tabs`: `pill` (default) and `underline` variants via context;
    `autopilot-detail` migrated onto `variant="underline"`.
  - `switch`: 44px `before` hit target (invariant 6 / WCAG 2.5.8).
  - `dialog`: card surface (`bg-card` + `rounded-card`).
  - stories cover the new dark button and underline tabs.
  - input/textarea/select were already on the 44px floor; value fields stay
    rectangular by design, the pill lives in `searchFieldClass`.
  - avatar needs no primitive change: person-vs-agent (round vs bracket
    `BerryMark`) is handled in `common/issues/actor-avatar.tsx`.

## Phase 3 (shell & chrome) — decision: **option B** — done

The shipped shell already implements most of Phase 3 (honest drawer with
scrim/Escape/focus return, settings nav collapsing to a dropdown, 44px nav
rows, the `.navi` icon box from cc2b081). We kept the shipped shell and did only
the small, unblocked re-skin, recording the plan deviations as accepted.

**Done under B:**

- Rail counts are now a mono-700 tabular figure (`data-figure`) instead of the
  berry pill, so they line up down the rail and read as one voice with every
  other number. `ShellBadge` gained a `hot` prop; the figure inherits the base
  layer's size (which also lifted the old 10px count above the 12px readability
  floor, invariant 5). `shell-badge.tsx` + its story.
- `.hot` for owed work: `hot` paints the figure in `--shell-accent` — the one
  rail state invariant 3 lets wear berry ("waiting on you"). Inbox unread and
  reviews waiting are `hot`; chat unread stays the neutral dim. `shell-personal.tsx`.
  The accent is the colour, not a fill, so the berry-pill-everywhere the
  redesign removed does not come back.

**Accepted deviations from `ledger-plan.md` (do not "fix" these):**

1. Sidebar is **218px**, not the plan's 240px (from the prototype).
2. The shell breaks to the overlay drawer at **`lg` = 1024px**, not 900px; the
   whole CSS/JS switch is built on Tailwind `lg` and `MOBILE_BREAKPOINT`.
3. The drawer trigger is the **floating bottom-left button**, not in the title
   bar. The plan's finding B6 calls the floating trigger a bug; the shipped
   shell keeps it on purpose. Left as-is under B.

**Blocked (not B's problem):**

- Breadcrumb `data-depth="mid"` → record title in Inter (comp. 5) needs the
  `data-depth` cascade, which does not exist and is open decision §5f. Same
  blocker kept `data-depth="front"` off `dialog`/`sheet` in Phase 2.

## Not started

Phase 4 (collections), Phase 5 (detail surfaces), Phase 6 (charts),
Phase 7 (findings sweep), and the `audit.js` port (§8).
