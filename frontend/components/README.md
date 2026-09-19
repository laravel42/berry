# Shared product components

The components here are the ones a feature should reach for before writing its own markup.
They sit one layer above the shadcn/Radix primitives in `ui/`: they compose those primitives
into a Berry pattern (a property picker, an empty list, a view toggle) so the pattern is
built once, with its accessibility and states right once.

Every component below has a Storybook file next to it. Its `play` functions are the
component's tests, and `pnpm exec vitest run <path>` runs them in Chromium. The stories are
also the live examples.

When you add a shared component, add it to this file. Say what it is for, what it is not
for, and what replaced it.

| Component                                                                            | File                                                                                          | Use it for                                              |
| ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| [`OptionPicker`](#optionpicker)                                                      | `common/pickers/option-picker.tsx`                                                            | Picking one value from a short fixed list               |
| [`PriorityPicker`](#prioritypicker)                                                  | `common/pickers/priority-picker.tsx`                                                          | A priority, anywhere                                    |
| [`StatusPicker`](#statuspicker)                                                      | `common/pickers/status-picker.tsx`                                                            | A task or project status                                |
| [`IssuePriorityPicker`, `IssueStatusPicker`](#issuepriority-and-issuestatus-pickers) | `common/issues/issue-pickers.tsx`                                                             | A task's priority or status, bound to the issues store  |
| [`LeadPicker`](#leadpicker)                                                          | `common/projects/lead-picker.tsx`                                                             | A project's lead                                        |
| [`EmptyState`](#emptystate)                                                          | `common/empty-state.tsx`                                                                      | A list or page with no rows, or one that failed to load |
| [`SegmentedControl`](#segmentedcontrol)                                              | `common/segmented-control.tsx`                                                                | Switching one view setting (a range, a metric)          |
| [`StatusBadge`](#statusbadge)                                                        | `common/status-badge.tsx`                                                                     | A status mark and word in a pill                        |
| [`ConfirmAction`](#confirmaction)                                                    | `common/confirm-action.tsx`                                                                   | Confirming anything irreversible                        |
| [`PageTitleBar`](#pagetitlebar)                                                      | `layout/headers/page-title-bar.tsx`                                                           | A list page's title row                                 |
| [`Section`, `DetailSectionLabel`](#section-labels)                                   | `common/issues/details/panel-section.tsx`, `common/projects/details/detail-section-label.tsx` | Labelled blocks on detail pages                         |
| [`StatTile`](#stattile)                                                              | `common/usage/usage-tiles.tsx`                                                                | One figure in a usage or dashboard summary              |
| [`timeAgo`](#timeago)                                                                | `lib/time-ago.ts`                                                                             | "3 minutes ago"                                         |

## Pickers

### `OptionPicker`

`OptionPicker` picks one value from a short, fixed list. It renders a popover menu and puts a
check on the current value. It is **controlled**: you own `value`, and you render the trigger
from it. The picker owns only whether the menu is open.

| Prop            | Type                              | Notes                                                                                                                                            |
| --------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `options`       | `{ value, label, icon? }[]`       | Shown in this order                                                                                                                              |
| `value`         | `string \| undefined`             | `undefined` means nothing is chosen yet                                                                                                          |
| `onValueChange` | `(value) => void`                 | Also called when the current value is picked again. The menu then closes                                                                         |
| `emptyLabel`    | `string`                          | Shown when `options` is empty                                                                                                                    |
| `menuWidth`     | `'trigger'` (default) \| `'menu'` | `trigger` makes the menu at least as wide as the trigger. `menu` is a fixed 12rem, for triggers too small to size a menu by (an avatar, a glyph) |
| `countFor`      | `(value) => number`               | A muted tally after each option. It is called only while the menu is open, so it may read a store without costing every row a render             |
| `children`      | one element                       | The trigger. It receives a ref and props through `PopoverTrigger asChild`                                                                        |

There are two ready-made triggers:

- **`PickerIconButton`** is a 28px ghost square that holds a glyph only. `aria-label` is
  **required**, because the button has no text: name the property and its value, as in
  "Priority: Urgent".
- **`PickerChipButton`** is a secondary 28px chip that holds a glyph and a label. It is for
  the property row of a create dialog.

Both have `role="combobox"`. Radix sets `aria-expanded` and `aria-controls` on them.

**Keyboard.** Enter or Space on the trigger opens the menu with the highlight on the current
value. The arrow keys move the highlight, Enter chooses, and Escape closes without choosing.
Focus returns to the trigger. The listbox takes focus when the menu opens, and its
`aria-activedescendant` names the highlighted option.

The list has no search input. For long lists (assignees, projects, labels) use a picker with
a `CommandInput`, such as `AssigneeUser` or the project selector.

```tsx
<OptionPicker options={fruit} value={value} onValueChange={setValue} emptyLabel="Nothing to pick.">
   <PickerChipButton>{labelFor(value)}</PickerChipButton>
</OptionPicker>
```

### `PriorityPicker`

`PriorityPicker` picks a priority tier. It takes `priority`, `onChange(priority)`, a required
`variant`, and an optional `countFor`.

- **`variant="icon"`** shows the tier glyph alone. Use it in rows, board cards and property
  panels. Its accessible name and its tooltip are both "Priority: {name}".
- **`variant="chip"`** shows the glyph and the name. Use it in create dialogs. "No priority"
  reads muted.

The glyph colours itself by tier (`data/priorities.tsx`), so do not pass a colour.

```tsx
<PriorityPicker
   variant="icon"
   priority={project.priority}
   onChange={(p) => updateProjectPriority(project.id, p)}
/>
```

### `StatusPicker`

`StatusPicker` picks a status from a fixed workflow. It takes the same props as
`PriorityPicker`, plus a required `options` list of `{ status, label }`:

- `ISSUE_STATUS_OPTIONS` (exported from the same file) offers the task statuses under their
  own names.
- `projectCreateStatusOptions` (`common/projects/create-project/project-status-options.ts`)
  offers the project statuses under project words ("Planned", "Active", "Completed").

The chip shows the option's label. The icon trigger is named "Change status, current
{status.name}", which is the word the panels print beside it.

```tsx
<StatusPicker
   variant="chip"
   status={form.status}
   options={projectCreateStatusOptions}
   onChange={(status) => setForm({ ...form, status })}
/>
```

### `IssuePriority` and `IssueStatus` pickers

`IssuePriorityPicker` and `IssueStatusPicker` take `issue={issue}` and bind the icon
variants to the issues store. The change is optimistic. If the server refuses it, the change
rolls back and a toast explains why. Each option counts the loaded tasks at that value. Use
them wherever a task row, card, table cell or sidebar edits one task.

### `LeadPicker`

`LeadPicker` chooses a project's lead. It takes `lead` (which may be `undefined` in a create
form), `candidates`, `onChange(user)` and a trigger as `children`. Every option is drawn
through `ActorAvatar`.

- **`leadCandidates(members, lead)`** is the one roster rule: **people only**. Agents and the
  AI-workflow sentinel are left out. While no roster has loaded, the current lead is the
  only choice.
- **`LeadAvatarButton`** is the avatar trigger:
   - `size="md"` (the default) is a 28px target with a presence dot, for property panels;
   - `size="sm"` is a 16px avatar with no dot, for board cards.

   It is a plain button labelled "Lead: {name}".

```tsx
<LeadPicker
   lead={project.lead}
   candidates={leadCandidates(members, project.lead)}
   onChange={(user) => updateProjectLead(project.id, user)}
>
   <LeadAvatarButton lead={project.lead} />
</LeadPicker>
```

### What the pickers replaced

| Removed                                                                                                              | Replacement                                                              |
| -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `issues/priority-selector.tsx` (`PrioritySelector` with `issueId`)                                                   | `IssuePriorityPicker`                                                    |
| `issues/status-selector.tsx` (`StatusSelector` with `issueId`)                                                       | `IssueStatusPicker`                                                      |
| `projects/priority-selector.tsx`                                                                                     | `PriorityPicker variant="icon"`                                          |
| `projects/project-detail-status-selector.tsx`                                                                        | `StatusPicker variant="icon" options={projectCreateStatusOptions}`       |
| `projects/create-project/priority-selector.tsx`, `layout/sidebar/create-new-issue/priority-selector.tsx`             | `PriorityPicker variant="chip"`                                          |
| `projects/create-project/status-selector.tsx`, `layout/sidebar/create-new-issue/status-selector.tsx`                 | `StatusPicker variant="chip"`                                            |
| `projects/lead-selector.tsx`, `projects/create-project/lead-selector.tsx`, `projects/project-detail-lead-picker.tsx` | `LeadPicker` with a row button, `PickerChipButton` or `LeadAvatarButton` |

The following behaviour changed deliberately:

- **Controlled pickers.** The old copies each mirrored the prop into local state. Every
  caller already updates its value synchronously (optimistic stores, form state), so nothing
  visible changed.
- **Arrow keys work.** In all eight copies, Radix focused the popover above cmdk's key
  handler, so the arrow keys did nothing.
- **Project priority trigger.** It is now the same 28px square as every other icon trigger.
  It was 32px wide, which left it 2px out of line with the status icon above it. Its tooltip
  now reads "Priority: High" instead of "High".
- **Lead roster.** The project list row now offers people only, like the other two lead
  pickers. It used to include agents. The row trigger and the option list draw
  avatars through `ActorAvatar`.
- **Chip trigger.** The create-task priority chip reads muted at "No priority", as the
  create-project chip already did.
- **Check mark.** The check is 16px in every picker. Three copies used 14px.

## `EmptyState`

`EmptyState` is what a list or page shows when there is nothing to show, or when it failed
to load. It is a compound component:

```tsx
<EmptyState icon={<EmptyStateMark label={t('mark')} />}>
   <EmptyStateTitle>{t('title')}</EmptyStateTitle>
   <EmptyStateText>{t('body')}</EmptyStateText>
   <EmptyStateActions>
      <Button className="h-10 px-5" onClick={create}>
         {t('cta')}
      </Button>
   </EmptyStateActions>
</EmptyState>
```

- **`icon`** is required. It is usually `EmptyStateMark`, the hollow neutral berry mark,
  whose `label` becomes its accessible name. For a failed load, use a warning glyph such as
  `<AlertTriangle className="size-5 text-status-warning" />`.
- **`EmptyStateTitle`** is an `h2`:
   - `variant="display"` (the default) uses the serif display face, for a page-level state;
   - `variant="plain"` uses the h2 scale, for a state inside a list or pane.
- **`EmptyStateText`** is optional and repeatable.
- **`EmptyStateActions`** holds one primary action, or one secondary action that clears a
  filter or retries.

The parts set their own spacing:

| Between                      | Space |
| ---------------------------- | ----- |
| The glyph and the first part | 20px  |
| A title and its text         | 8px   |
| Two lines of text            | 4px   |
| The text and the actions     | 24px  |

It replaced these hand-copied shells:

- `EmptyProjects`
- `EmptyQueue`
- `NoMatches`
- `IssueListError`
- `EmptyGoals`
- `EmptyProposals`
- the approvals queue's empty state

That brought two changes: "No matches" and the list-error state place their button 24px
below the text instead of 20px, and the error text sits 20px under its glyph instead of
16px.

It stays separate from `inbox/inbox-states.tsx` (`InboxPanel`), which fills its pane's full
height with tighter spacing and an outline button.

## `SegmentedControl`

`SegmentedControl` is a bordered strip of 24px buttons that switches one **view** setting,
such as a time range, a chart metric or a grouping. The current segment is filled.

- Its value is typed: `SegmentedControl<number>` for day counts, and a string union for
  metrics.
- `aria-label` is **required**. The group is `role="group"`, and each segment is a toggle
  button with `aria-pressed`.
- Tab moves through the segments, and Space or Enter presses one.
- Do not use it for a setting that is saved. Use a `Select` or a settings row for that.

```tsx
<SegmentedControl
   aria-label={t('range')}
   value={query.days}
   onValueChange={(days) => onChange({ ...query, days })}
   options={USAGE_DAY_OPTIONS.map((days) => ({ value: days, label: t('days', { count: days }) }))}
/>
```

It replaced seven hand-rolled strips:

- `usage-filters`
- `usage-overview` (two strips)
- `runtime-usage-panel`
- `usage-errors`
- `dashboard-overview`
- `runtime-detail`

None of them told assistive tech which segment was on. Their names come from new catalogue
keys:

- `areas.usage.filters.range`
- `areas.usage.chart.metricLabel`
- `areas.usage.chart.grainLabel`
- `areas.usage.runtime.splitLabel`
- `areas.usage.errors.rankLabel`
- `areas.dashboard.range`

## `StatusBadge`

`StatusBadge` puts a status mark and its word in a pill. It takes `look: StatusLook`
(`lib/catalog.ts`). Derive the look from your domain, then render it here:

- `GoalStatusBadge` uses `statusLook(GOAL_STATUS, …)`.
- `PlanStatusBadge` uses `planLook(record)`.

`PlanStatusBadge` and the connection state in `settings/integrations.tsx` used to copy this
markup, and now render `StatusBadge`. `PlanLook` is now an alias of `StatusLook`.

## `ConfirmAction`

See [Confirming irreversible actions](../../docs/design-system.md#confirming-irreversible-actions)
in the design system. The skills row delete and the skills bulk delete now use it instead of
a hand-built `AlertDialog`. Their confirm button now takes the destructive style, as the
contract requires for deletes. Both still close at once and report progress in the list, so
`onConfirm` starts the work without awaiting it.

## `PageTitleBar`

`PageTitleBar` is the top row of a list page. It holds the page's one `<h1>` and, as
`children`, an optional trailing action. The title truncates rather than wraps, so the action
stays on screen at phone width. It renders a `<header>`. Pages sit inside the shell's
`<main>`, so this `<header>` is not a banner landmark.

It is used by the dashboard, goals, runtimes, projects, agents, my-issues and new-agent
headers.

A detail page uses a breadcrumb bar instead.

## Section labels

**`Section`** (`common/issues/details/panel-section.tsx`) labels one block of a task's sidebar
or detail column. It renders a `<section>` headed by a section-label `<h2>`, with an optional
`action` on the heading row and an optional `className` for the section's own layout. The
execution log, linked pull requests and usage blocks now use it instead of copying its
heading.

**`DetailSectionLabel`** (`common/projects/details/detail-section-label.tsx`) is the dim
tracked-caps label on the project detail page and its sidebar. It accepts native `div`
props, so you can pass `className="mb-2"` for more room below. Write the text in sentence
case, because CSS applies the caps. Before this change, three project blocks inlined the
same classes and lower-cased their text in JS.

## `StatTile`

`StatTile` is one figure and what it counts, in a bordered tile. It takes `label` and
`value`, and the value uses tabular figures. Lay tiles out in a grid. It is used by
`UsageTiles`, the usage errors summary and the dashboard's run counts.

## `timeAgo`

`timeAgo(iso, fallback = iso)` returns text such as "3 minutes ago". If the stamp cannot be
read, it returns `fallback`. It replaced six private copies:

- `inbox-format.relativeTime`
- the notifications drawer's `relativeTime`
- `goal-line`
- `activity-feed`, `execution-log` and `lib/comments` (these pass `'recently'` as their
  fallback)

The notifications drawer's `destinationOf` was a copy of `inboxHref`, and now calls it
directly.

These stay separate:

- The approvals queue uses `formatDistanceToNowStrict`.
- `lib/runs.ts`, `run-overview` and `lib/reviews.ts` format compact durations ("5m ago",
  "3h").
- Surfaces that already use next-intl's `format.relativeTime` are localised, and should
  keep it.
