# Desktop app: platform decision and core features (TEA-71, for TEA-63)

Status: **draft, waiting for a person's decision on the platform** (escalated from TEA-71).
Owner: Head of Product. The build owner is the Software Engineer, on TEA-63.

## 1. Problem and outcome

**User problem.** People who triage Berry work all day keep Berry open in a browser tab. They
miss inbox items and review gates (work that is waiting on a person to release it) until they
go back to the tab. A link to an issue from chat, mail or a terminal opens in the browser
instead of in the app they already have open.

**Measurable outcome.** On macOS, Windows and Linux, a signed-in person using the desktop app:
- is notified within 10 s of a new inbox item or review gate, without the window being focused;
- sees their unread inbox count on the dock or taskbar without opening the window;
- opens any issue from an external link in the desktop window in a single click.

Evidence and assumptions. These are **assumptions**: no user research or analytics stand
behind this problem statement. What the repository shows is **observed**: the inbox already
exposes `GET /api/v1/inbox/unread-count`, documented as "the badge… polled far more often than
the list" (`server-ts/src/mounts/inbox.ts`). That is a product intent to badge unread counts.

## 2. The conflict the decision resolves

- The project brief says "Develop a desktop application using the Expo framework". Mobile is
  out of scope.
- The repository already ships a desktop app: `apps/desktop` (`@berry/desktop`). It is an
  Electron window onto the Berry web UI. It starts the API on PGlite and the Next app, has a
  CLI bridge (`src/cli.ts`), packages macOS, Windows and Linux targets with electron-builder,
  and has tests (`test/cli|stack|url.test.ts`). It has no notifications, no badge, no deep
  links and no tray.
- The only Expo app is `apps/mobile`: Expo SDK 57 with react-native-web. It runs on local
  fixture data and its README says iOS/Android. Expo has no first-party desktop target.

Options (from the Software Engineer on TEA-71):

| | Option | Effort | Risk | Needs |
|---|---|---|---|---|
| A | Keep Electron `apps/desktop`. Build the named features below into it | S–M | Low. Already cross-platform | A person accepting that "Expo" in the brief is dropped |
| B | Run `apps/mobile`'s react-native-web build inside the Electron shell, wired to `/api/v1` | L | Medium. A second web client next to `frontend/`, and a mobile UI on desktop | CTO platform decision plus this feature list |
| C | Native Expo desktop through react-native-windows/macos | XL | High. No Linux target, and the OS compatibility the brief names as its risk | CTO decision and TEA-62 stack choice first |
| D | Hold TEA-63 until requirements, architecture and stack exist | none | Delays the milestone | Combined with A, B or C |

**Recommendation: A + D.** TEA-63 stays on hold until a person picks the platform. If it is A,
this document is the spec for TEA-63 and TEA-60/TEA-62 close as covered by it. A meets the
brief's outcome ("works on major desktop operating systems") with the least new surface. C
cannot meet it: react-native has no maintained Linux desktop target. B or C only make sense
if Expo is a firm commitment, and then the CTO must decide the platform before any code is
written.

## 3. Core features (spec for option A)

Scope: `apps/desktop` only. Server and frontend changes are limited to what is named below.
No new external services: everything talks to the Berry API the window already uses.

### F1. Native notifications for inbox items and review gates

Business rules:
- BR1.1 A notification is shown for each **new** inbox item for the signed-in person. "New"
  means it was created after the app started or after the last item already notified. Items
  that existed at startup do not notify.
- BR1.2 Approvals and review gates are inbox items. They follow BR1.1. Nothing else notifies.
- BR1.3 No notification is shown while the Berry window is focused and visible.
- BR1.4 More than 3 new items in one poll produce one summary notification ("N new items
  in your inbox"), not N notifications.
- BR1.5 Clicking a notification shows and focuses the window and navigates to the item's
  target route (the issue, approval or review). The summary navigates to `/<orgId>/inbox`.
- BR1.6 A menu item "Notifications" (checkbox, default on) turns them off. The choice
  survives a restart.
- BR1.7 Signed out, or when the API is unreachable, the app shows no notifications and no errors.

Acceptance criteria:
- [ ] With the window minimised, creating an inbox item for the signed-in person (for example,
      assign them an issue) shows an OS notification within 10 s on macOS, Windows and Linux.
- [ ] With the window focused, the same action shows no notification.
- [ ] Clicking the notification focuses the window on the item's page.
- [ ] Creating 5 items at once shows one summary notification.
- [ ] Unchecking the menu item stops notifications. After a restart it is still unchecked.
- [ ] Unit tests cover the new-item diffing (BR1.1, BR1.4) and the focus rule (BR1.3) as pure
      functions under `apps/desktop/test/`.

### F2. Unread badge

- BR2.1 The badge equals `GET /api/v1/inbox/unread-count` for the signed-in person.
- BR2.2 It is refreshed at most every 10 s, and immediately after the window regains focus.
- BR2.3 A count of 0 clears the badge. Above 99 it shows "99+" where the OS shows text.
- BR2.4 macOS: dock badge. Windows: taskbar overlay icon. Linux: `app.setBadgeCount` where the
  desktop supports it, otherwise nothing (no error).

Acceptance criteria:
- [ ] Marking all inbox items read clears the badge within 10 s.
- [ ] A new unread item raises the badge by one within 10 s.
- [ ] Signed out, there is no badge.
- [ ] Unit test for the count-to-label rule (BR2.3).

### F3. Deep links `berry://`

- BR3.1 The app registers the `berry` protocol (packaged build; in dev, where Electron allows).
- BR3.2 `berry://<orgId>/<path>` opens `/<orgId>/<path>` on the running stack's origin, for
  example `berry://acme/issue/TEA-63` → `/acme/issue/TEA-63`.
- BR3.3 Works on a cold start (the app is not running) and a warm one (the existing instance
  is focused, through `second-instance` / `open-url`. No second window).
- BR3.4 Anything that does not parse to a same-origin path is ignored. The window is focused
  and stays where it is, and no external navigation happens. Credentials, other schemes and
  `..` traversal out of the origin are rejected.

Acceptance criteria:
- [ ] `open berry://<org>/issue/<ref>` (macOS), `start berry://…` (Windows) and
      `xdg-open berry://…` (Linux) open that issue in the existing window.
- [ ] The same link with the app closed starts it and lands on the issue after the stack is up.
- [ ] Unit tests for the link-to-path parser in `src/url.ts`, including rejected inputs.

### F4. Connection state and reconnect

- BR4.1 When the Berry origin stops answering, the window shows the existing failure/retry
  page within 10 s and does not lose the route the person was on.
- BR4.2 It retries automatically with backoff (1 s, 2 s, 5 s, then every 10 s) and returns to the
  same route when the origin answers. The manual Retry button keeps working.
- BR4.3 Notifications and badge polling pause while disconnected (BR1.7).

Acceptance criteria:
- [ ] With `BERRY_DESKTOP_URL` pointing at a server that is then stopped, the retry page appears
      within 10 s. Restarting the server returns the window to the same route without a click.
- [ ] Unit test for the backoff schedule.

### Non-functional

- NF1 macOS, Windows and Linux: `bun run --cwd apps/desktop typecheck` and `test` pass, and
  `package` produces a runnable dir build on each OS. Per-OS packaging in CI belongs to TEA-67
  (DevOps), not TEA-63.
- NF2 No new runtime dependency in `apps/desktop` beyond Electron unless the CTO approves.
- NF3 The renderer gets no new Node access. Any new preload API is a narrow `contextBridge`
  surface like the existing one.

### Out of scope for TEA-63

Tray/menu-bar mode, auto-update, offline editing, global shortcuts, code signing and
notarisation (TEA-67), and the mobile app.

## 4. Edge cases

- Several workspaces: notifications and badge come from the inbox of the person signed in.
  The inbox is per person, so items from every workspace count once.
- Session expires while minimised: polling returns 401. Treat it as signed out (BR1.7), with
  no error dialog.
- The system clock changes or the machine sleeps: diffing is by item id, not by time, so a wake
  does not re-notify old items.
- OS notification permission denied (macOS): the feature degrades silently. The menu item
  stays.

## 5. Effect on other tasks in the project

TEA-65 (integration tests), TEA-67 (deployment scripts), TEA-68 (usage docs) and TEA-69
(monitoring) are in progress without a platform decision. Under A they target `apps/desktop`.
Under B or C their work must be re-checked.
