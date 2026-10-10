HANDOFF.md

# Handoff from BER-243

Wire the Cursor AI runtime (workstation CLI login)

The repository is now checked out in my workspace. Let me follow the run instructions and first see what's already there.Working tree is clean with just a snapshot commit. Let me look at the actual files now present.Let me use the repository browse tool and read the key files.The full repo is present. Let me read the key files: the ADR, the catalog, and the adapters. Starting with the ADR and catalog.I'll use terminal reads since direct file reads are being rejected.Now I understand the catalog. Cursor is currently `blocked`. The task says to verify Cursor ships an official local CLI with an in-CLI account login, then move it to supported and wire it following the kiro/codex adapter pattern. Note the catalog's existing `unavailableReason` for Cursor says the problem was "Berry has no companion on the user's machine" — but ADR-0019 and the parent task reframe this: the login stays in the Cursor CLI child process on the workstation (same as Claude/Codex, which are `available`).

Let me look at how codex and kiro adapters are wired, and the connect path. First, the codex adapter (likely the closest mirror).Now let me look at the kiro adapter, the types, the registry, and how the connect path works. Let me read the registry and types first since they define the adapter interface and how adapters are selected.Now let me find where the registry is constructed (which adapters are registered) and the connect path in mounts/runtimes.ts and index.ts.The adapter registry for the workstation host is in `workstation/host.ts`. Let me read it.I need to add `CursorAgentAdapter` to this registry. Now let me look at the connect path in mounts/runtimes.ts and index.ts, and the envelope.ts (which has CODEX_CLI_LOGIN). Let me check mounts/runtimes.ts.Let me search within mounts/runtimes.ts for the places that reference specific runtime ids like codex/kiro/claude — the connect path logic.Now I can see the connect path. Cursor should mirror the `claude`/`codex` path (CLI login kept in child process, OAuth sentinel token). Let me read the relevant sections of mounts/runtimes.ts: the connect handler (around 320-440) and the runtimeControl section (around 560-590).Now let me see what comes after the kiro branch (how unsupported/blocked runtimes are rejected), and the runtimeControl credential section around 560-590.Now I understand the full connect path. For Cursor, I'll mirror the `claude`/`codex` branch. The cleanest approach: add Cursor to the three places that currently special-case `claude`/`codex`:
1. The connect handler `runtimeId === 'claude' || runtimeId === 'codex'` branch (line 328)
2. The models listing `runtimeId === 'kiro' || runtimeId === 'claude' || runtimeId === 'codex'` branch (line 569)

Now let me check `envelope.ts` for the login sentinel constants (CLAUDE_CLI_LOGIN, CODEX_CLI_LOGIN) and how they're defined, plus where runtime ids are validated in the envelope schema.I'll add `CURSOR_CLI_LOGIN = 'cursor-cli'`. Now let me look at index.ts for the connect path wiring (how runtimeControl / workstation host is set up), and check the kiro adapter to understand the full agent_process pattern (session handling via ACP vs codex's exec/json). Let me read the kiro adapter.Let me read the relevant sections of index.ts: around 630-660 (workstation setup), 1120-1140 (runtimeControl), and 1230-1245 (workstationRuntimes).Now I have the whole picture. There are two key places in index.ts:
1. Line 1125: `runtimeControl` routes `kiro`/`claude`/`codex` to the workstation host. Add `cursor`.
2. Line 1239: `workstationRuntimes: ['kiro', 'claude']` — the runtimes admitted without a compute host. Note it currently lists only kiro and claude (not codex). Let me check what `workstationRuntimes` controls and whether codex is intentionally excluded.

Let me check the `workstation-kiro.ts` and how `kiroOnWorkstation.control` dispatches — whether it handles all runtime ids or filters.The `workstationRuntimes` list controls which runtimes can run a conversation reply without a compute host. It currently lists only `['kiro', 'claude']` — codex is NOT in it, which is a known inconsistency not in my scope. My scope is Cursor only. Since Cursor runs on the workstation like claude/codex/kiro, I should add `cursor` here so a Cursor-only workstation deployment can claim replies. But I need to be careful: codex being absent might be an intentional/separate oversight (another task). 

To stay consistent with "Cursor runs on the workstation" and the connect path recognizing it, I'll add `cursor` to the workstationRuntimes list. Let me verify what the dispatcher/executor uses to pick the workstation adapter — whether adding Cursor to the registry + envelope is enough for runs to execute. Let me check `workstation-kiro.ts` control.The `workstationKiro` host dispatches control and invoke to the workstation host.ts, which uses the registry — so adding `CursorAgentAdapter` to the registry and routing `cursor` in index.ts's runtimeControl hand

## Files
- docs/ai-runtimes.md
- server-ts/src/agents/runtime/adapters/cursor.test.ts
- server-ts/src/agents/runtime/adapters/cursor.ts
- server-ts/src/agents/runtime/workstation/host.ts
- server-ts/src/index.ts
- server-ts/src/mounts/conversations.ts
- server-ts/src/mounts/runtimes.ts
- server-ts/src/runtime/ai-runtime-catalog.test.ts
- server-ts/src/runtime/ai-runtime-catalog.ts
- server-ts/src/runtime/envelope.ts

Repository: laravel42/berry
Branch: software-engineer/ber-243-wire-the-cursor-ai-runtime-workstation
