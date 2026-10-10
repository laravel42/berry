HANDOFF.md

# Handoff from BER-245

Wire the Grok AI runtime (workstation CLI login)

This run addresses specific review feedback. The central issue: the Grok adapter uses the Claude MCP bridge (Content-Length framed) when it should mirror the Kiro/Kimi bridge (newline-delimited). Let me first examine the current state of the adapter and both bridges to understand the fix precisely.Now let me read both bridges to confirm the framing difference the reviewer described, and how the Kiro/Kimi adapters wire theirs.The reviewer is correct. The Claude bridge translates Content-Length framing; the Kiro bridge is a plain newline-delimited passthrough. Both Kiro and Kimi (which the task says to mirror) use the plain `kiro-mcp-bridge.ts`. The Grok adapter wrongly uses the Claude bridge.

Now I need to determine Grok's actual MCP stdio framing. The MCP spec's stdio transport is newline-delimited JSON. Let me verify what Grok Build's MCP stdio client expects. Let me check the official Grok MCP docs. First let me see how the Kimi adapter (the closest mirror, newest) wires its bridge and MCP, since Kimi was added on main and the task names it alongside Grok.Now I understand the two patterns clearly. Kimi mirrors Kiro: it uses `kiro-mcp-bridge.ts` (plain newline passthrough) and talks ACP (`kimi acp`), passing `mcpServers` in the ACP `session/new` params with `{ name, command, args, env }`. The Berry MCP server (`berry`) is a stdio server that the CLI's own MCP client spawns.

The key question: **does Grok's embedded MCP stdio client use newline-delimited framing (standard MCP) or Content-Length?** The MCP spec stdio transport is newline-delimited JSON. The reviewer is right that the Kiro/Kimi bridge is the standard one. Let me verify Grok Build's MCP stdio behavior from the official docs rather than assume. Let me check the MCP docs I fetched before, and the key question of framing.Key confirmations:
1. The MCP spec stdio transport is **newline-delimited JSON** (official modelcontextprotocol.io result #2 and #5), explicitly "one newline-delimited JSON-RPC message per line."
2. Result #4 confirms **Claude Code's MCP client uses Content-Length header framing** (the exception), which is exactly why `claude-mcp-bridge.ts` exists.
3. Result #9 (agent-network grok-build-acp doc) confirms Grok Build speaks ACP over **newline-delimited JSON-RPC**.

So Grok's MCP stdio client follows the standard newline-delimited transport, not Claude's Content-Length. The reviewer is correct: Grok must use the **plain `kiro-mcp-bridge.ts`** (newline passthrough), like Kiro and Kimi — not the Claude bridge.

Let me verify the official Grok MCP docs page to confirm the config.toml `[mcp_servers.berry]` stdio shape and framing. Let me fetch the official MCP servers doc.The official Grok MCP docs confirm: config.toml `[mcp_servers.<name>]` with `command`/`args` for stdio local-process servers, and it references the standard MCP specification (modelcontextprotocol.io) for protocol details — which is newline-delimited stdio. Grok uses the standard off-the-shelf stdio transport (the examples are the standard `@modelcontextprotocol/server-*` npx servers, which all speak newline-delimited JSON). So the plain `kiro-mcp-bridge.ts` is correct for Grok, confirming the reviewer.

Now I have evidence-backed decisions for all the review points. Let me check the ACP path too — the agent-network doc said Grok Build speaks ACP (`grok agent stdio`). But the Grok adapter currently uses headless `--output-format streaming-json`, which has its own documented event vocabulary. Both are legitimate; the review's concern is that these flags are unverified. Let me verify the headless flags against the official docs I fetched before (headless-mode doc). Let me re-fetch and confirm the exact flags the adapter uses.All the flags the adapter uses are confirmed against the official headless docs:
- `--prompt-file <PATH>` ✓ (line 42)
- `--output-format streaming-json` ✓ (line 30)
- `--disallowed-tools` with `web_search,web_fetch` ✓ (lines 35, 60 — example uses exactly `web_search,web_fetch`)
- `--permission-mode bypassPermissions` ✓ (line 38)
- `--sandbox <PROFILE>` ✓ (line 45)
- `--cwd`, `--no-auto-update`, `--resume` ✓
- streaming-json event vocabulary `type: thought/tool_call/tool_call_update/text/usage/end` ✓ (lines 217-222) and `error` ✓ (line 209)

**Critical catch at line 325:** "Like `streaming-json`, this stream is **read only**. **Tool approvals and other bidirectional flows use the ACP interface (`grok agent`)**." 

This is the deeper problem the reviewer sensed. In headless `streaming-json` mode, the stream is read-only — it cannot do interactive tool approvals. More importantly, this tells me the MCP tool-call path still works (MCP servers run as child processes of grok and respond directly over stdio; they're not "approvals"), but `bypassPermissions` is what auto-approves them. Let me confirm the sandbox `workspace` profile exists and verify there is no remaining gap. Let me check the sandbox doc profiles.Everything the ada

## Files
- docs/ai-runtimes.md
- server-ts/src/agents/runtime/adapters/grok.test.ts
- server-ts/src/agents/runtime/adapters/grok.ts
- server-ts/src/runtime/ai-runtime-catalog.ts

Repository: laravel42/berry
Branch: software-engineer/ber-245-wire-the-grok-ai-runtime-workstation
