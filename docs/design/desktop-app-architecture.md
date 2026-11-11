# Berry desktop app: high-level architecture (TEA-61)

Status: proposed, 2026-11-10. Owner: Product Designer.
Project: "Generate an expo desktop app". Consumers: TEA-62 (stack), TEA-63 (core
features), TEA-64/65 (tests), TEA-66 (UAT), TEA-67 (deployment).

This is a high-level design. It defines the layers of the desktop app, what each layer
owns, the desktop-only experience (information architecture, flows, states, keyboard
and screen-reader behaviour), and the list of core features with acceptance criteria
that TEA-63 can build from. It does not pick a new framework. That choice is still open
as **TEA-71** (Product Lead, with CTO for B/C). Section 2 explains how this design holds
for each of the TEA-71 options.

## 1. What exists today (verified in the checkout)

| Piece | Path | What it is |
| --- | --- | --- |
| Desktop shell | `apps/desktop` (`@berry/desktop`) | Electron main process (`src/main.ts`), single window, single-instance lock, app menu, offline page, navigation guard (`src/url.ts`), CLI bridge (`src/cli.ts`). |
| Local stack | `apps/desktop/src/stack.ts` | With no `BERRY_DESKTOP_URL` the shell starts the API (`server-ts`, PGlite under the app data dir, or host Postgres) on port 4173 and the Next web app on 4174, then loads it. |
| Preload bridge | `apps/desktop/src/preload.cjs` | Exposes `window.berryDesktop` with `retry()` and `runCli(request)`. Context isolation and sandbox are on, Node integration off. |
| Web UI | `frontend/` | The full Berry product. The desktop window renders it unchanged. The frontend does not reference `berryDesktop` today. |
| Realtime | `frontend/hooks/use-workspace-event-stream.ts` | One workspace SSE stream (`/api/v1/events`), events used as invalidation signals for the stores (inbox, approvals, projects…). |
| Notifications model | `frontend/store/notifications-store.ts`, `components/layout/notifications/`, `components/common/settings/account-notifications.tsx` | In-app notifications drawer and per-account notification settings. |
| Expo app | `apps/mobile` | Expo Router app for iOS/Android: inbox, tasks, chat, call. Its own token file (`src/theme/tokens.ts`) and **local fixture data**; no API client. |
| Packaging | `apps/desktop/package.json` → `build` | electron-builder, `mac` target `dir` only. No Windows or Linux target is configured. |

So Berry already has a desktop app that runs one codebase in Electron. What it lacks is
anything that makes it more than a browser tab: the OS does not hear about inbox
items or reviews, it has no badge, no deep links, and no way to choose a server from
inside the app.

## 2. Architecture: three layers with one narrow contract

```
┌──────────────────────────── Desktop app ─────────────────────────────┐
│                                                                       │
│  L1  Shell (native, privileged)          owns the OS                  │
│      window · menu · tray/dock badge · notifications · deep links     │
│      · single instance · server connection · local stack lifecycle    │
│                     ▲                                                 │
│                     │  L2  Desktop bridge (typed, allow-listed IPC)   │
│                     │      window.berryDesktop  v1                    │
│                     ▼                                                 │
│  L3  Renderer (unprivileged)              owns the product            │
│      the Berry web UI (frontend/) — screens, stores, SSE, i18n,       │
│      design system — same code as the browser                         │
│                                                                       │
└──────────────┬────────────────────────────────────────────────────────┘
               │ same-origin /api/*  (only path to data)
               ▼
   Berry server: local stack (API + PGlite, started by L1)  or  remote URL
```

Rules that hold for every option in TEA-71:

1. **The renderer owns the product; the shell owns the OS.** No product screen,
   business rule or copy lives in the shell, apart from the few shell-owned surfaces in
   §4.3. The shell never reads the database or calls `/api/*` for product data. It
   only reacts to what the renderer tells it over the bridge.
2. **The bridge is the only contract between them.** It is versioned (`version: 1`),
   every method is allow-listed, and the payloads are plain JSON validated in the main
   process (as `cliRequestFrom` already does). It only answers the Berry window's
   origin (as `RUN_CLI_CHANNEL` already checks).
3. **The renderer works without the bridge.** Every desktop feature is a progressive
   enhancement behind `if (window.berryDesktop?.version >= 1)`. The same build serves the
   browser, so no feature may be desktop-only in a way that breaks the web.
4. **One source of truth for events.** Native notifications and the badge are fed by the
   renderer's existing workspace event stream and inbox unread count, not by a second
   stream opened by the shell. One connection, and one set of read and unread rules.

How TEA-71's options map onto the layers:

| Option | L1 shell | L3 renderer | What changes in this design |
| --- | --- | --- | --- |
| **A** (recommended in TEA-71) | Electron, `apps/desktop` (exists) | `frontend/` (exists) | Nothing. Build §5 features into L1/L2 and the renderer's bridge adapter. |
| **B** | Electron (exists) | `apps/mobile` built for web, wired to `/api/v1` | L3 is a second client: it needs an API client, the real stores, i18n, and the web design tokens instead of `tokens.ts`. L1/L2 unchanged. CTO decision. |
| **C** | react-native-windows / -macos | `apps/mobile` native | L1 is rewritten per OS, and the local stack and CLI bridge must be ported. L2 becomes native modules. Highest OS-compatibility risk. CTO decision plus TEA-62. |

Because the bridge contract (§3) and the experience (§4) belong to the layers and not to
Electron, this document stays valid for B and C. Only the implementation cost of L1
and L3 changes.

## 3. Desktop bridge v1 (L2 contract)

Existing methods stay as they are. New methods are additive. Names are proposals for the
engineer to confirm.

| Method | Direction | Purpose | Guard |
| --- | --- | --- | --- |
| `version` (number) | read | Feature detection. `1` for this design. | — |
| `retry()` | R→S | Reload the start URL from the offline page. Exists. | origin |
| `runCli(req)` | R→S | Run one argv program. Exists. | origin, argv only, limits in `cli.ts` |
| `notify({ id, title, body, href })` | R→S | Show one native notification. `href` must be an in-app path. | origin, in-app `href`, rate limit |
| `setBadge(count)` | R→S | Dock/taskbar/tray unread count; `0` clears. | origin, integer 0–9999 |
| `onNavigate(cb)` | S→R | The shell asks the renderer to route to an in-app path (from a notification click, deep link or menu item). | path validated by `inAppNavigation` |
| `onConnection(cb)` | S→R | Shell-level connection state for the local stack: `starting · ready · stopped · failed`. | — |
| `openServerSettings()` | R→S | Open the shell's Server dialog (§4.3). | origin |

Not in the bridge, on purpose: file-system access, arbitrary URLs, credentials, and
anything that touches the database. GitHub sign-in stays the web flow, so the shell does
not hold tokens.

## 4. Experience design

### 4.1 Objects and mental model

The desktop user is a person who already uses Berry in the browser and wants it to
**tell them when they are needed**. Agents do the work, but a person reviews it and
releases it (PRODUCT.md §5). So the desktop app is mostly about attention:

| Object (product noun) | Why it matters on desktop |
| --- | --- |
| Inbox item | The unit of "you are needed". Drives the notification and the badge. |
| Review | An agent's work waiting for Accept or Decline. Highest-priority notification. |
| Approval | A plan, Loop or escalation waiting for a decision. |
| Run | Agent work in progress. Notify only on failure, never on every step. |
| Workspace / server | Which Berry the window shows (local stack or remote URL). Shell-owned. |

### 4.2 Information architecture

The renderer's navigation (sidebar, routes under `frontend/app/[orgId]/…`) is **not
duplicated** in the shell. The shell adds only:

```
Berry (app menu)                  File            Go                       View / Window / Help
├ About Berry                     ├ New task ⌘N   ├ Inbox        ⌘1        (Electron roles, exist)
├ Settings…  ⌘,  → web Settings   └ Close ⌘W      ├ My tasks     ⌘2
├ Server…        → §4.3 dialog                    ├ Reviews      ⌘3
├ ─                                               ├ Approvals    ⌘4
└ Quit       ⌘Q                                   ├ ─
                                                  ├ Back  ⌘[   Forward ⌘]
                                                  └ Command menu ⌘K (renderer’s)
Tray / menu-bar item (optional, setting): "Berry — 3 need you" · Open Berry · Inbox · Reviews · Quit
```

Labels reuse the web app's nouns exactly (Inbox, My tasks, Reviews, Approvals, Settings,
Task, not "issue"). On Windows and Linux, `⌘` becomes `Ctrl` and the app menu items move to
File / Help. Each Go item is an `onNavigate` to the matching route, so the routes stay
owned by the renderer. A menu item must not have a shortcut that the renderer already
uses for something else. The engineer checks the renderer's shortcut map before
assigning one, and a clash is resolved in the renderer's favour.

**Deep links:** `berry://<workspace>/task/<ref>`, `…/review/<id>`, `…/inbox`. The shell
parses them and passes them to `onNavigate` only after `inAppNavigation` passes. An
unknown path opens Inbox with a toast reading "That link doesn't match anything in this
workspace." A second launch with a link focuses the existing window (single-instance
lock, exists) and navigates.

**Scale limits:** notifications are grouped once more than 3 arrive within 10 s ("5 new
items need you" → Inbox). The badge shows the inbox unread count, capped at "99+" where
the OS allows text. No per-run notifications, only `run.failed`.

### 4.3 Shell-owned surfaces and their states

These are the only screens the shell renders itself. They must use the design-system
tokens from `docs/design-system.md` (`void` canvas, `chalk` text, primary button
treatment, body type scale). Today the offline page hard-codes `#18181b` and uses
JetBrains Mono for body text. Both are off-system, and the change is folded into
feature F6.

**Launch / local stack** (one window, the content swaps in place):

| State | What the user sees | Keyboard / screen reader |
| --- | --- | --- |
| Starting (loading) | Berry mark with "Starting Berry…" and an indeterminate progress bar. After 10 s, add "First start sets up the local database. This can take a minute." | `role="status"`, announced once. No focus trap. |
| Ready (success) | The web app loads. No splash flash: the window shows on `ready-to-show` (exists). | Focus goes to the web app's main landmark. |
| Failed (error) | Heading "Berry couldn't start", then the cause in one line (for example "Port 4173 is in use"). Buttons: **Try again** (primary), **Use another server…**, and the **Show log** link. | Heading gets focus. Enter = Try again. `role="alert"` on the cause. |
| Remote unreachable (offline) | Heading "Can't reach <host>", with "Berry will try again when your connection is back." Buttons: **Try again** (primary), **Change server…**. | As Failed. Retries itself on `online` and announces "Reconnected". |
| Empty (no server chosen; only when the local stack is unavailable) | Heading "Choose a Berry server", with the server dialog inline. | First field focused. |

**Server dialog** (`Server…`): radio group **This computer** (local stack, default) /
**A Berry server** with a URL field. It validates on blur: the URL must be http(s),
and an https warning appears for non-localhost http. The **Connect** button checks the
URL by calling its `/api/v1/config`, shows "Connecting…" (loading), then switches and
closes (success). On failure it shows an inline error under the field, "No Berry server
answered at this address", with the field marked `aria-invalid` and the error tied to it
by `aria-describedby`. Escape cancels and focus returns to the menu origin. The choice
is saved in `desktop.env` under userData (exists).

### 4.4 Renderer-side additions (web UI, desktop only)

- **Notification settings** (`account-notifications.tsx`) gets a "Desktop notifications"
  group, shown only when the bridge is present. The toggles are **Reviews waiting for
  me**, **Approvals waiting for me**, **Mentions and assignments**, **Failed runs**, and
  **Show unread count on the app icon**. It reuses the existing switch rows, with no
  new component. If OS permission is denied, an inline notice reads "Notifications are
  off for Berry in your system settings." with an **Open system settings** link.
- **Connection indicator**: the renderer already reconnects its SSE with backoff. While
  disconnected for longer than 5 s, the existing shell header shows a quiet status line,
  "Reconnecting…", and stale data stays visible (the *offline/reconnecting* and *stale*
  states the design system requires). It announces "Connection lost" and "Reconnected"
  through a polite live region, once each.

### 4.5 Key flows

1. **Review waiting → decision.** An agent run finishes and an inbox item arrives over
   SSE → the renderer calls `notify` (the setting is on and the window is unfocused) and
   `setBadge`. The user clicks the notification → the shell focuses the window →
   `onNavigate('/…/review/<id>')` → the review page, with focus on its heading → Accept /
   Decline (existing). The inbox item is read → the badge drops.
2. **First launch.** Open → Starting → Ready → web sign-in (GitHub, existing) → Inbox.
   If startup fails → Failed → Try again, or Use another server → Server dialog → Ready.
3. **Open a shared link.** `berry://…/task/BER-12` from chat → the app focuses or
   starts → after Ready, it routes to the task. A link to another server's workspace
   shows "This link is for another Berry server (<host>)." with **Switch server** and
   **Cancel**.

### 4.6 Accessibility contract (desktop-specific)

- Every menu item has a label and a platform-correct accelerator. All Go destinations
  can be reached without a mouse.
- A notification's text alone must make sense to a screen reader, with no colour or icon
  meaning. Title: "Review: <task title>". Body: "<agent name> finished. Accept or decline."
- Activating a notification moves focus to the destination's `h1`, never leaves it on
  the previous element.
- The badge is never the only signal: the same count is in the Inbox nav item (exists)
  and in the tray tooltip.
- Respect OS reduce motion (no animated splash) and high contrast (shell surfaces use
  tokens, so they follow the theme).
- Window minimum size is 960×640 (exists). The renderer must not lose focus order or
  clip content at 200 % zoom (View → Zoom, exists).

## 5. Core features for TEA-63, with acceptance criteria

Ordered by value. F1–F4 are the minimum for "a desktop app that is more than a tab".

**F1 Native notifications.**
- With the bridge present and the matching setting on, a new inbox item of type review,
  approval, mention/assignment or failed run shows exactly one OS notification while the
  window is unfocused. Nothing is shown while it is focused.
- Clicking it focuses the window and opens the item's page with focus on the `h1`.
- More than 3 items within 10 s collapse into one grouped notification that opens Inbox.
- With the OS permission denied, the settings page shows the denied notice and nothing
  throws.
- The web build in a browser behaves exactly as before.

**F2 Unread badge.**
- The dock/taskbar badge equals the Inbox unread count within 2 s of a change, and is
  cleared at 0.
- The "Show unread count" setting off clears the badge.
- On Linux without badge support, it degrades silently to the tray tooltip.

**F3 Deep links.**
- `berry://` is registered on macOS, Windows and Linux.
- Valid links route in the running or freshly started app.
- Unknown paths show the §4.2 toast.
- Links to other origins never load in the window. The `inAppNavigation` tests cover it.

**F4 Menu and shortcuts.**
- The §4.2 Go menu exists with platform-correct accelerators.
- Each item navigates through `onNavigate`.
- No accelerator collides with a renderer shortcut (a test lists both maps).

**F5 Server choice.**
- The Server dialog behaves as in §4.3, including all its states.
- The choice persists across restarts.
- Switching servers does not need an app restart.

**F6 Launch and offline states.**
- The Starting, Failed, Remote unreachable and Empty states render as in §4.3, using
  design-system tokens (no raw hex outside the token table).
- Each state is reachable in tests by simulating its cause.

**F7 Tray / menu-bar item** (optional, off by default).
- Shows the count and the Open, Inbox, Reviews and Quit items.
- Closing the window keeps the app in the tray only when this is on.

Cross-cutting, for every feature: unit tests in `apps/desktop/test` (bridge payload
validation, deep-link parsing, grouping logic), and `bun run lint` and `build:check` pass
in `frontend/` for the renderer adapter. The bridge stays origin-guarded.

## 6. Risks and open decisions

| Item | Severity | Owner |
| --- | --- | --- |
| Platform choice A/B/C is undecided. B and C add a second client or a native port, and the costs in §2 depend on it. | high | Product Lead → CTO (TEA-71) |
| Packaging targets only macOS `dir`. The project requires the major desktop OSes, so Windows (NSIS) and Linux (AppImage/deb) targets, signing and notarisation are missing. | high | DevOps Engineer (TEA-67) |
| Deep-link registration and notifications differ per OS (Windows needs an AppUserModelID for toasts, and Linux badges vary by desktop environment). | medium | Software Engineer (TEA-63), QA (TEA-65) |
| The bridge enlarges the privileged surface. `notify` and `onNavigate` must stay in-app-path only. | medium | Security Engineer review of the TEA-63 PR |
| `apps/mobile` uses fixture data and its own tokens. Under option B both must be replaced before it can be a desktop renderer. | medium | CTO decision in TEA-71 |
| Requirements (TEA-60) have not been written. §5 is a design proposal for the Product Lead to accept or trim. It is not agreed scope yet. | medium | Product Lead |
