HANDOFF.md

# Handoff from BER-246

Wire conditional AI runtimes (Hermes, Qoder, Antigravity) and re-check blocked set

This is the merge-reconciliation run. My previous session already reconciled all conflicts; this run is starting fresh, so let me verify the current state before assuming anything.This is a fresh merge attempt (different from my prior session — note this STATUS.md says 8 need-you files and envelope.ts merged cleanly this time, mounts has 4 conflicts not 6). The prior session's work isn't present; I'm starting the reconciliation fresh. Let me work through each conflicted file. Start with the cleanly-merged ones to verify, then the conflicts.

Let me check the two files git merged cleanly (envelope.ts, ai-runtime-catalog.ts) to confirm both sides' additions survived.Clean merges look good: both logins present in envelope.ts, and the catalog has 6 available (claude, codex, cursor, kiro, qoder, plus likely one more — let me not worry, it merged cleanly). Let me verify the available set precisely to match the test later.Interesting — this main has `kimi` available too (BER-242's parent task wired Kimi, Cursor, Grok per the related-task note). So main now has claude, codex, cursor, kimi, kiro available, and this task adds qoder → 6 available: `['claude', 'codex', 'cursor', 'kimi', 'kiro', 'qoder']`. That's what the catalog test must assert. Good to know for the test conflict.

Now let me reconcile the conflicted files. Start with envelope-builder.ts (1 conflict).Only one conflict here (the import), and it's about which logins to import. Main added `KIMI_CLI_LOGIN`; this task added `QODER_CLI_LOGIN`; both have `CURSOR_CLI_LOGIN`. I need all four plus kimi. But wait — this task's version doesn't have KIMI, and the auth-check for qoder vs kimi must both exist. Since only the import conflicts (the auth checks merged cleanly or are elsewhere), let me check: does the file already have both the qoder and kimi auth checks after a clean merge? Let me look.The auth-check bodies merged cleanly and include both kimi (line 508) and qoder (line 522). Only the import line conflicts. I need to import all: CLAUDE, CODEX, CURSOR, KIMI, QODER (and isKiroApiKey + types). Let me reconcile.Now task-executor.ts (1 conflict).Need all: kiro, claude, codex, kimi, cursor, qoder. The doc comment (line 121) currently lists this task's set — must include kimi too. Let me reconcile both.Now host.ts (2 conflicts).Both imports present (kimi and qoder). I need the doc comment to list all six, and both adapter registrations. Let me reconcile.Now ai-runtime-catalog.test.ts (2 conflicts).The available set must be the catalog order: `['claude', 'codex', 'cursor', 'kimi', 'kiro', 'qoder']` (confirmed earlier). And assert both kimi and qoder unavailableReason null. Let me reconcile.Now index.ts (5 conflicts).Five conflicts. I need to see the full credential-token ternary structure (conflict #3 is nested inside it) to reconcile correctly. Let me view that region around the token resolution.I can see the structure. Note line 1274 (`workstationRuntimes`) merged cleanly already but has `['kiro', 'claude', 'cursor', 'qoder']` — missing kimi. Since it's not a conflict (git auto-merged to this task's version), I should check whether main's version added kimi there. Let me handle the 5 marked conflicts first, then check line 1274. Let me reconcile all 5.Conflict #3's leading context differs (indentation). Let me view the exact lines 686-701 to match precisely.Note: conflicts #1, #2, #4, #5 already succeeded (the script ran sequentially and failed only at #3, but #1 and #2 were applied before the failure — wait, Python writes the file only at the end with `open().write()`. Since it raised before writing, NO changes were saved). Let me re-check: the file still has all 5 conflict markers. Let me view the exact #3 block.The context after `? CURSOR_CLI_LOGIN` has `                            ? CURSOR_CLI_LOGIN` (28 spaces) then the `<<<<<<<`. My script's old3 had `                            : runtimeId === 'cursor'` as the preceding anchor but the actual line before `? CURSOR_CLI_LOGIN` is `: runtimeId === 'cursor'` at a different indent. The mismatch is the leading `: runtimeId === 'cursor'` indentation. Let me anchor only on the conflict block itself (from `<<<<<<<` to `>>>>>>> main`) which is unambiguous, and keep the shared lines intact.Now check the cleanly-merged `workstationRuntimes` at line ~1274 — it has qoder but may be missing kimi (if main added kimi there). Let me check what main's version had vs this task's.The base already had `['kiro', 'claude', 'cursor']` (cursor was in base — meaning main's cursor work was already merged into the base this branch sees). This task added `qoder` → `['kiro', 'claude', 'cursor', 'qoder']`. Main (the side being merged) didn't change this line beyond base (git merged cleanly to ours). But main did add kimi elsewhere — did main add kimi to `workstationRuntimes`? Since git merged this line cleanly to ours' value, main's version equals base here (no kimi added by main to this specific list). 

But

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
