HANDOFF.md

# Handoff from BER-246

Wire conditional AI runtimes (Hermes, Qoder, Antigravity) and re-check blocked set

I'll start by reviewing what's already on the branch, then address the review feedback point by point.The checkout shows `main` at `d81161b snapshot`, not the described branch. The run instructions say the work is on `software-engineer/ber-246-...` at commit 8418406. Let me check branches and whether my prior changes are present.The prior work is committed into `main` (commit `d81161b snapshot`) in this checkout — the Qoder adapter and all wiring are present. The working tree is clean. Now I'll address each review point. Let me first confirm the gaps the reviewer flagged.

Review points:
1. `runtimeControl` in `index.ts` only routes kiro/claude/codex to the workstation process — add qoder.
2. `runsOnWorkstation` in `task-executor.ts` + dispatcher allow-list unchanged — add qoder to both.
3. Adapter starts `qoder --acp` with cwd = server's cwd — must use the task checkout (`input.workingDirectory`).
4. Verify `qoder --list-models` and `qoder --acp` flags against the installed CLI (a wrong flag makes connect look signed out).
5. Remove HANDOFF.md from the PR; rebase onto current main (Kiro CLI login intact); don't wire Hermes/Antigravity.

Let me check point 1 first — the `runtimeControl` routing in index.ts.Found the gaps. Let me look at each site in detail — lines 1125-1135, 1238-1240, and 1431-1433.IDE read is rejected; I'll use shell. Let me view the three regions.This is review point 1. A Qoder connect probe currently falls through to the compute host (`transport.control`), which has no Qoder adapter. I'll add `qoder` to the workstation branch. Let me make this edit.Now the two allow-lists at lines ~1239 and ~1432. Let me examine them with context to understand what `workstationRuntimes` and `onlyAiRuntimeKeys` control.I notice `workstationRuntimes` at line 1239 lists only `['kiro', 'claude']` — missing `codex` AND `qoder`. And `onlyAiRuntimeKeys` at line 1432 lists `['kiro', 'claude', 'codex']` — missing `qoder`. Let me look more precisely. The reviewer flagged `runsOnWorkstation` in task-executor.ts and the dispatcher allow-list. These two index.ts spots feed those. Let me check what `onlyAiRuntimeKeys` is passed to (the dispatcher) and look at task-executor's `runsOnWorkstation`.`runsOnWorkstation` lists kiro/claude/codex — missing qoder. Let me view it and the surrounding usage to be safe.Now the two index.ts allow-lists. The `onlyAiRuntimeKeys: ['kiro', 'claude', 'codex']` (dispatcher allow-list) needs qoder. The `workstationRuntimes: ['kiro', 'claude']` is for chat replies with no compute host — it's missing both codex and qoder; the reviewer specifically asks for qoder in the dispatcher allow-list. Let me check what `workstationRuntimes` and `onlyAiRuntimeKeys` do before editing, to add qoder correctly (and consider whether codex belongs in workstationRuntimes too). Let me find their definitions.Let me look at both usages to understand the semantics precisely.Confirmed: `onlyAiRuntimeKeys` is the dispatcher allow-list (only when there's no compute host, so this process can only claim workstation-CLI runs). A Qoder task would be excluded, so it's never claimed. I'll add `qoder`.

For `workstationRuntimes` (conversations/chat replies): it currently has only `['kiro', 'claude']` and is missing `codex` too. The reviewer asked for qoder in the dispatcher allow-list and in `runsOnWorkstation`. To be consistent and complete for the no-compute-host case, Qoder chat replies should also be admittable, so I'll add qoder there too. I'll leave the pre-existing codex omission alone unless it's clearly a bug — but since all four are workstation runtimes and this list gates whether a reply is admitted when there's no compute host, the correct set is all workstation CLIs. However, the review scope is Qoder; adding codex is out of scope and could mask an intentional choice. I'll add only `qoder` to match the review and keep parity with the dispatcher list (which includes codex). 

Actually, let me reconsider: `workstationRuntimes` lacking codex means codex chat replies aren't admitted without a compute host — but that's a pre-existing state from before this task and not mine to change. I'll add `qoder` to both lists per the review. Let me edit both index.ts spots.Wait — I added `codex` to `workstationRuntimes` which was out of scope. Let me reconsider: the pre-existing list `['kiro', 'claude']` deliberately omits codex. Adding codex may be a legitimate fix but is beyond this task. However, leaving codex out while adding qoder would be inconsistent. Let me check git blame / the related task to see if codex omission is intentional. Actually, the safer and in-scope move is to add only `qoder`, preserving the existing `codex` state (whatever its reason). Let me correct to add only qoder.The snapshot (which includes my prior Qoder work) has `['kiro', 'claude']` — codex was never added here even though codex is a workstation runtime. This is a pre-existing inconsistency unrelated to my task. T

## Files
- server-ts/src/agents/runtime/adapters/qoder.test.ts
- server-ts/src/agents/runtime/adapters/qoder.ts
- server-ts/src/index.ts
- server-ts/src/runtime/task-executor.ts

Repository: laravel42/berry
Branch: software-engineer/ber-246-wire-conditional-ai-runtimes-hermes-qoder
