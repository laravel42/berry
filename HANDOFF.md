HANDOFF.md

# Handoff from BER-245

Wire the Grok AI runtime (workstation CLI login)

This run is a merge reconciliation ("fix conflicts"). Let me read the merge status first.4 files need manual reconciliation. Let me find all conflict markers.Matches STATUS.md. The pattern (this task adds Grok; main gained a sibling runtime, likely Kimi/Cursor). Let me start with envelope-builder.ts (1 conflict).This conflict is an import list. Ours has `GROK_CLI_LOGIN` and `isKiroApiKey`; main has `KIRO_CLI_LOGIN` (new) and no `isKiroApiKey`. Interesting — main changed Kiro from an API key to a CLI login sentinel. I need the union: keep `GROK_CLI_LOGIN` (ours) and `KIRO_CLI_LOGIN` (main's new), and figure out whether `isKiroApiKey` is still used. Let me check how the file uses these before merging — the Kiro auth-check block may have changed on main. Let me look at the whole envelope-builder auth-check region and how Kiro is validated now.Key finding: line 553 (settled region, from main) now validates Kiro with `KIRO_CLI_LOGIN` and `credential.type !== 'oauth'` — main migrated Kiro away from the API key to a CLI login sentinel. So `isKiroApiKey` is **no longer used** in this file, and `KIRO_CLI_LOGIN` **is** used. The grok block (line 532, ours) uses `GROK_CLI_LOGIN`.

So the correct merged import is the union of what's actually used: `CLAUDE_CLI_LOGIN, CODEX_CLI_LOGIN, CURSOR_CLI_LOGIN, GROK_CLI_LOGIN, KIMI_CLI_LOGIN, KIRO_CLI_LOGIN` and NOT `isKiroApiKey` (since the Kiro check no longer uses it). Let me verify `isKiroApiKey` isn't used elsewhere in the file (only line 15 import).

The grep shows `isKiroApiKey` only on line 15 (the import). So drop it. Let me resolve.envelope-builder.ts resolved (grok and kiro both validated via CLI-login sentinels, no `isKiroApiKey`). The Kiro-migration-to-CLI-login on main is significant — it affects index.ts and mounts/runtimes.ts too. Let me verify `isKiroApiKey` and `KIRO_CLI_LOGIN` exist in envelope.ts (the cleanly-merged file).Confirmed: envelope.ts (cleanly merged) now defines `KIRO_CLI_LOGIN` and `GROK_CLI_LOGIN` (plus Kimi, Cursor). `isKiroApiKey` is gone — main migrated Kiro to a CLI login. Good, my envelope-builder resolution matches. Now index.ts (3 conflicts).This is the key semantic change: main migrated Kiro from a sealed API key (`type: 'api_key'`, DB-stored `credential_sealed`) to the CLI-login sentinel (`KIRO_CLI_LOGIN`, `type: 'oauth'`). Conflict 3 shows ours still has the entire old Kiro-api-key block, while main replaced it with the sentinel in the token ternary. 

I must adopt **main's** approach (Kiro is now a CLI login like the others) AND add Grok to the ternary. Let me see the full ternary structure before this conflict to merge correctly. Let me read the credential-resolution block.Now I understand the full structure. Main collapsed Kiro into the single `oauth`-sentinel branch and removed the sealed-API-key block entirely. The merged result must:
- Condition: include claude/codex/cursor/kimi/**kiro**/**grok** (union).
- Token ternary: codex→cursor→kimi→**kiro(KIRO_CLI_LOGIN)**→**grok(GROK_CLI_LOGIN)**→claude, then close the branch (no separate kiro-api-key block).

Let me resolve all three index.ts conflicts together.No markers remain in index.ts. But I removed a block that used `sealerFromKey` / `config.integrationKey` for Kiro — I must check those are still used elsewhere in index.ts (otherwise an unused-import/var could break typecheck). Let me check, and verify the resolved region.index.ts resolved cleanly — the ternary now handles cursor/kimi/kiro/grok, and `sealerFromKey` is still used 9 times elsewhere (no unused-import issue). Now mounts/runtimes.ts (4 conflicts) — the most complex, likely with the Kiro API-key→CLI-login migration too.This is the crux. Main migrated Kiro into the `WORKSTATION_CLI_LOGINS` table (a CLI-login runtime, no more `kiroCredential` sealed-key path). Ours still has the old `kiroCredential(...)` branch for Kiro and treats grok as the only new CLI login.

For the merge:
- **Conflict 1 (import):** union — `GROK_CLI_LOGIN` + `KIRO_CLI_LOGIN`, drop `isKiroApiKey` (main removed the sealed-key path, so `isKiroApiKey` and `kiroCredential` are likely gone).
- **Conflict 2 (table):** keep both `grok` (ours) and `kiro` (main) entries.
- **Conflict 3 (connect branch condition):** union — claude/codex/cursor/kimi/**kiro**/**grok**.
- **Conflict 4 (models route):** adopt main's simpler form (all are CLI logins now, so `const credential = { type:'oauth', token: WORKSTATION_CLI_LOGINS[runtimeId].token, ... }` with no `kiroCredential` fallback) and add grok+kiro to the condition.

But I must verify `kiroCredential` and `isKiroApiKey` are truly gone from the file now (main may have removed `kiroCredential` entirely). Let me check their usage.`kiroCredential` and `isKiroApiKey` appear ONLY inside the conflict regions (lines 529 and 14) — both from ours. Main removed them. So after I resolve conflict 4 to main's form (no `kiroCredential` fallback), `kiroCredential` and `isKiroApiKey` are no longer r

## Files
- .gitignore
- docs/ai-runtimes.md
- server-ts/src/agents/runtime/adapters/claude-mcp-bridge.ts
- server-ts/src/agents/runtime/adapters/grok.test.ts
- server-ts/src/agents/runtime/adapters/grok.ts
- server-ts/src/agents/runtime/workstation/host.ts
- server-ts/src/index.ts
- server-ts/src/mounts/runtimes.ts
- server-ts/src/runtime/ai-runtime-catalog.test.ts
- server-ts/src/runtime/ai-runtime-catalog.ts
- server-ts/src/runtime/envelope-builder.ts
- server-ts/src/runtime/envelope.ts
- server-ts/src/runtime/task-executor.ts
- server-ts/src/runtime/workstation-kiro.ts

Repository: laravel42/berry
Branch: software-engineer/ber-245-wire-the-grok-ai-runtime-workstation
