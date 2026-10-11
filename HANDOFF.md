HANDOFF.md

# Handoff from BER-245

Wire the Grok AI runtime (workstation CLI login)

This run resumes work that was already addressed in prior sessions. Let me verify the current state against the review feedback before concluding anything.Clean snapshot. Let me verify the three review points are resolved in the saved work. First, the high-severity bridge fix and the test file.All review points are resolved in the saved work:
- **High (bridge):** Grok uses `kiro-mcp-bridge.ts` (newline-delimited), matching Kiro and Kimi — the correct standard MCP stdio framing. Claude/Codex/Cursor keep the Content-Length bridge.
- **Low (test):** The test file references the real bridge, `BerryMcpHost`, and newline-delimited framing (integration test present).

Let me confirm the medium point (documented CLI sources in catalog) and that Grok is available.The awk didn't match (field ordering). Let me grep directly.Grok is `available` with `unavailableReason: null` and five official source links including the headless-mode and MCP-servers docs that back the CLI behaviors (the medium point). All three review points are addressed in the saved work.

Now let me run the final verification: typecheck + the Grok adapter tests (to confirm the real-bridge integration test passes), then the repo gates. Let me start with the Grok test file and typecheck.All 6 Grok tests pass including the real-bridge integration test. Now typecheck and the full server test suite.Typecheck passes, Grok adapter suite passes, and only the 3 pre-existing baseline failures remain (migrations table list, control invoke seam, autopilots — all confirmed unrelated to this task in prior sessions, failing on the clean baseline). Now the repo-wide gates.Both gates pass. Let me do a final check for conflict markers (in case main was merged under this work) and secrets, then confirm the delivered file set.No conflict markers, no secrets, clean working tree. All checks pass and the review feedback is fully resolved in the saved work. The task is complete.

## Result: BER-245 Grok runtime — review resolved and verified

I resumed from the saved work and confirmed every point of the sent-back review is addressed, then re-ran all checks. Nothing was missing, so I verified rather than rewrote.

**High (the real defect) — MCP bridge framing: fixed.** The Grok adapter now points `[mcp_servers.berry]` at `kiro-mcp-bridge.ts` (the plain newline-delimited line passthrough), not `claude-mcp-bridge.ts` (Content-Length). This is correct and matches the Kiro/Kimi adapters the task said to mirror: the MCP spec's stdio transport is newline-delimited JSON-RPC, which is what Grok Build's embedded MCP client speaks; only Claude Code uses non-standard Content-Length framing (hence its separate bridge). Confirmed across all adapters — Grok, Kimi, and Kiro use `kiro-mcp-bridge.ts`; Claude, Codex, and Cursor use `claude-mcp-bridge.ts`. (`server-ts/src/agents/runtime/adapters/grok.ts:27`.)

**Low — tool-call path now actually exercised.** `grok.test.ts` contains a real integration test that spawns the actual `kiro-mcp-bridge.ts` child as Grok would (`node --experimental-strip-types <bridge> <socket>`), connects it to a real `BerryMcpHost` serving a real Strands tool, and drives newline-delimited JSON-RPC `initialize` → `tools/list` → `tools/call` through the bridge's stdin, asserting the Berry tool actually executed and returned. A second test guards `grokMcpBridgePath()` so the framing choice cannot regress. All 6 Grok tests pass.

**Medium — CLI behaviors confirmed against official docs.** The catalog's `officialSources` for Grok cite five first-party xAI docs, including the headless-mode doc (documents `--prompt-file`, `--output-format streaming-json`, `--sandbox workspace`, `--permission-mode bypassPermissions`, `--disallowed-tools`, and the streaming-json event vocabulary) and the MCP-servers doc (config.toml `[mcp_servers.<name>]` stdio shape). Grok is `available` with `unavailableReason: null`.

**Verification run this session:**
- `pnpm typecheck:server` — passes.
- `pnpm --filter @berry/server test` — 1340 pass / 3 fail. The Grok adapter suite (6 subtests incl. the real-bridge test) passes. The 3 failures (`every table the migrations create…`, `control uses the authenticated invoke seam…`, `autopilots fire through the runtime task queue…`) are pre-existing on the baseline and unrelated to this task.
- `scripts/check-no-model-in-server.py` and `scripts/check-locale-catalogues.py` — both pass.
- No conflict markers in the tree, no secrets in the diff, clean working tree.

**Files that matter:** `server-ts/src/agents/runtime/adapters/grok.ts` (adapter; newline bridge; exported `grokMcpBridgePath()`), `server-ts/src/agents/runtime/adapters/grok.test.ts` (6 tests incl. real bridge+host integration and the bridge-choice guard), `server-ts/src/runtime/ai-runtime-catalog.ts` (Grok available, 5 official sources), `docs/ai-runtimes.md` (matrix row and intro). The connect-path wiring (`envelope.ts` `GROK_CLI_LOGIN`, `mounts/runtimes.ts` `WORKSTA

Repository: laravel42/berry
Branch: software-engineer/ber-245-wire-the-grok-ai-runtime-workstation
