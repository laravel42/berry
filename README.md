<div align="center">

<img src="https://berry.pm/og.png" alt="Berry — A team you can spin up" width="880">

<br><br>

**Issue tracking where the assignee can be a person or a coding agent.**

One workflow. Same issues, same reviews, same history.

[![License: MIT](https://img.shields.io/badge/license-MIT-c74a5e?style=flat-square)](LICENSE)
![Version](https://img.shields.io/badge/version-0.9.4-1a1a1d?style=flat-square)
![Self-hostable](https://img.shields.io/badge/self--hostable-docker%20compose-1a1a1d?style=flat-square)


</div>

---

## What Berry is

Berry is a cloud workspace where humans and AI coding agents plan, execute, and review software work together. It combines issue and project management, collaboration, agent configuration, and legible execution evidence in one browser experience.

The central idea is small: **an assignee can be a person or an agent.** There is no separate AI surface. An agent receives the same issue, moves through the same statuses, leaves the same comments, and its work lands in the same review queue as anyone else's.

```
Issue → Assignee ──┬── Human ──┐
                   └── Agent ──┴→ Work → Evidence → Review → Done
```

The only step that changes is who does the work. Everything before and after it stays identical.

---

## Agents don't disappear into a chat window

Every assignment to an agent produces a **run**: an isolated workspace, a streamed activity log, and a recorded trail of everything that happened.

```
FORGE / RUN #1842                    ● Running
Issue        BER-142
Branch       forge/ber-142-passkeys
Runtime      08:42
Model        claude-sonnet-5
Workspace    isolated · node 24

12:41:03  cloned berry/frontend @ 4f2a9c1
12:41:09  inspected src/auth — 11 files
12:42:17  modified 4 files (+38 −6)
12:44:51  pnpm test
12:45:08  ✓ 84 tests passed · exit 0
12:46:22  opened PR #381 → main
12:46:24  requested review from Andrea
```

Runs are first-class objects. Watch one live, stop it, retry it, or read it back six weeks later.

---

## Autonomy you can inspect

Nothing merges because an agent reported success. Work arrives as a diff with its evidence attached — test results, lint output, e2e runs, artifacts, duration, merge target — and waits for a human.

| | |
|---|---|
| `pnpm test` | 84 passed · exit 0 |
| `pnpm lint` | clean |
| `playwright e2e` | 1 flaky · retried |
| artifacts | 3 · 2.1 MB |
| merge target | `main ← forge/ber-142` |

**`Merge without approval` is off by default.** Grant it explicitly or not at all.

---

## Agents are configured, not prompted

Each agent is a workspace member with an identity and a contract:

- **Role** — primary coding agent, reviewer, docs, triage
- **Model** — set once, applies to every future run
- **Repository access** — explicit allowlist
- **Permissions** — read, branch, run commands, open PRs, merge
- **Environment** — the container image and toolchain it executes in
- **Instructions** — versioned; every run records the revision it used

Revoke a permission and the runtime refuses the call. No anthropomorphic avatars, no personality settings — agents are technical entities on the team.

---

## The board keeps moving without you

Agents pick up assigned issues and advance them through the same columns your team uses. Cards move because work actually happened: a branch opened, tests passed, a review was requested. Every transition traces back to a run or a person.

---

## Quickstart

```bash
git clone https://github.com/laravel42/berry
cd berry
docker compose up -d
```

Berry comes up on `http://localhost`. Add your model keys in **Settings → Runtimes**, create an agent, and assign it an issue.

Requirements: Docker, and an API key for at least one model provider.

---

## Self-hosting

Berry runs entirely on your own infrastructure with your own keys. The runtime, the permission layer, and the scheduler are all readable and forkable. No proprietary agent format, no workflow lock-in, and nothing phones home.

---

## License

MIT — see [LICENSE](LICENSE).

Crafted by [Laravel42](https://laravel42.com/).

<br>

---

<div align="center">

# Coming soon anytime Q4 &mdash; 2026



</div>
