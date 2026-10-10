HANDOFF.md

# Handoff from BER-246

Wire conditional AI runtimes (Hermes, Qoder, Antigravity) and re-check blocked set

This run is a merge reconciliation. Let me read the merge status first.9 files need reconciling. The convention: `<<<<<<< berry: this task` ... `=======` ... `>>>>>>> main` where the text between `=======` and `>>>>>>> main` is **main's** version. 

An important note from the run instructions: HANDOFF.md should ultimately not be in the PR (prior review said remove it), but this merge instruction says reconcile each conflicted file keeping both sides. HANDOFF.md is attached automatically by Berry anyway; let me reconcile it to resolve the marker, then decide. Actually the prior review said "Remove HANDOFF.md from the pull request." But this run's instruction says "change nothing else" and "reconcile every conflicting file." I'll reconcile the markers (removing conflict markers) and keep HANDOFF.md deleted if that was its settled state — but it has a conflict, meaning both sides have content. Let me handle code files first (which matter for checks), then HANDOFF.md and docs.

Let me start with the smallest: envelope.ts (1 conflict). Let me view the conflict.Clear: main added `CURSOR_CLI_LOGIN` (Cursor was wired by the parent BER-242 task), this task added `QODER_CLI_LOGIN`. Keep both. Let me see the surrounding context to place both constants correctly.Note the opening `/**` is shared before the `<<<<<<<`. I need both constants, each with its own doc comment. Let me reconcile with a Python replacement.Now task-executor.ts (1 conflict). This is the `runsOnWorkstation` list — both sides add a runtime (main adds cursor, this task adds qoder).Both add a runtime — merge to include both cursor and qoder. Also the doc comment on line 121 (from this task) says "Kiro, Claude, Codex, and Qoder" — main's version likely says Cursor. Let me check the doc comment line for conflict (it says it's not conflicted, so only one side's comment survived — this task's). I should update it to list all. Let me reconcile the function body first, then fix the comment to include both.Now host.ts (2 conflicts) — adapter registration.Both add an adapter. I need to check the import lines too (main added a `CursorAgentAdapter` import). Let me view the imports and the full registry block.Both imports are already present (git kept both import lines cleanly). I'll reconcile the doc comment to mention all five, and keep both adapter registrations. Let me reconcile both conflicts.Now envelope-builder.ts (2 conflicts) — the auth checks per runtime, and the import.Both the import and the auth check need both. Let me view the full second conflict block to get the trailing lines right.The second conflict shares the trailing `false ); }` after the `>>>>>>> main`. I'll reconcile the import (include both CURSOR and QODER), and merge the two auth-check blocks into both checks (cursor first, then qoder), each complete. Let me do both replacements.Now ai-runtime-catalog.test.ts (2 conflicts) — the available-set assertion.The available set must include both cursor and qoder. The order depends on the catalog order. The catalog `AI_RUNTIME_IDS` order is: claude, codex, opencode, openclaw, hermes, pi, cursor, kimi, kiro, antigravity, qoder, ... So available filtered keeps catalog order: claude, codex, cursor, kiro, qoder. Let me verify the catalog order to produce the exact expected array, then reconcile.The merged catalog has 5 available: `['claude', 'codex', 'cursor', 'kiro', 'qoder']`. Note the catalog itself merged cleanly (both cursor and qoder flipped to available). Let me reconcile the test's two conflicts to assert both cursor and qoder.Now the catalog test may also assert `AI_RUNTIME_CATALOG.length` — both sides add nothing to the id list (cursor and qoder were already in AI_RUNTIME_IDS as blocked entries, now flipped to available), so length stays 14. Good. Now index.ts (5 conflicts) — the connect/runtimeControl/allow-lists.Five conflicts in index.ts, all adding cursor (main) vs qoder (this task). Reconcile each to include both. Let me do all five via Python.Now mounts/runtimes.ts (6 conflicts).Main refactored the connect path to use a `WORKSTATION_CLI_LOGINS` lookup table instead of inline conditionals. This is a cleaner structure. The right reconciliation is to adopt main's `WORKSTATION_CLI_LOGINS` table approach and add a `qoder` entry to it, rather than keep my inline conditionals. This keeps both sides' intent and matches main's new structure.

Let me find the `WORKSTATION_CLI_LOGINS` definition that main added.I'll adopt main's table approach: add a `qoder` entry to `WORKSTATION_CLI_LOGINS`, then reconcile each conflict to use main's `cli`-based form while adding `qoder` to the runtime-id checks. This keeps both sides' intent and uses the cleaner structure. Let me reconcile all 6 conflicts.

First, add qoder to the table (not a conflict — I'm editing main's clean block to extend it):Now reconcile the 6 conflicts. 1: import (both). 2: connect branch — adopt main's `cli` form, add qoder to the id check. 3: `token: cli.tok

## Files
- docs/ai-runtimes.md
- server-ts/src/agents/runtime/adapters/qoder.test.ts
- server-ts/src/agents/runtime/adapters/qoder.ts
- server-ts/src/agents/runtime/workstation/host.ts
- server-ts/src/index.ts
- server-ts/src/mounts/runtimes.ts
- server-ts/src/runtime/ai-runtime-catalog.test.ts
- server-ts/src/runtime/ai-runtime-catalog.ts
- server-ts/src/runtime/envelope-builder.ts
- server-ts/src/runtime/envelope.ts
- server-ts/src/runtime/task-executor.ts

Repository: laravel42/berry
Branch: software-engineer/ber-246-wire-conditional-ai-runtimes-hermes-qoder
