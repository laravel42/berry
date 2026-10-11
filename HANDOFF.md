HANDOFF.md

# Handoff from BER-244

Wire the Kimi AI runtime (workstation CLI login)

The reviewer's blocking concern is specific: `kimi.ts` reads the Berry MCP tool identity at `_meta.mcpTool.identity`, but the review wants evidence that `kimi acp` actually emits that shape in its `session/request_permission` payload (vs. a Kiro-style nesting). I need to verify the real ACP `session/request_permission` payload shape against official Kimi/ACP docs and make `berryToolName` robust to the actual shape.

Let me first find the checkout and look at the current `kimi.ts` permission code.Now let me verify the real ACP `session/request_permission` payload shape from the official Agent Client Protocol spec, since both Kiro and Kimi speak ACP and the standard shape is what matters. Let me check the ACP spec for the permission request structure and how tool calls (including MCP tool calls) are identified.Let me use the remote web search tool to find the ACP permission request schema and how the tool call / MCP tool is represented in `session/request_permission`.Key finding: the standard ACP `session/request_permission` payload carries a `toolCall` object (with `toolCallId`, `title`, `kind`, `rawInput`, etc.) and `options`. There is **no standard `_meta.mcpTool.identity` field** — that nesting is Kiro-specific (`_meta.kiro.mcpTool.identity`). The standard ACP shape identifies the tool by `toolCall` fields, and importantly `rawInput` can be empty when the permission request arrives before `tool_call_update` (per the OpenCode issues).

Let me read the authoritative ACP schema to see exactly what `session/request_permission` contains and how an MCP tool call surfaces its name/server.Let me use the search tool to get the schema fields for the permission request and tool call, since direct fetch is being declined.This is decisive and surfaces a real security concern beyond the review's. The findings:

1. **Standard ACP v1 `session/request_permission` carries a `toolCall` field** (a `ToolCallUpdate` with `toolCallId`, optional `title`, optional `name`, optional `rawInput`). There is **no standard `_meta.mcpTool.identity`** — that's Kiro's custom extension (`_meta.kiro.mcpTool.identity`). So `kimi.ts` reading `_meta.mcpTool.identity` is reading a field that standard ACP agents (including Kimi Code CLI, which is a standard ACP server) **do not emit** → **every Berry tool call would be denied and runs would stall**. The reviewer's blocking concern is correct and the current code is wrong.

2. The ACP tool `name`/`title`/`rawInput` are explicitly **"opaque, informational metadata: they do not advertise a capability or grant authorization"**, and there are published advisories (OpenClaw GHSA) about **auto-approval bypass via untrusted tool metadata / name heuristics / rawInput spoofing**. So approving based on a tool name/title alone is a known anti-pattern.

This changes the correct design. The right approach: **don't rely on a provider-specific `_meta` nesting at all**, and don't trust a free-form title. Kimi Code CLI is a standard ACP server, so the permission payload is the standard shape (`toolCall` with `toolCallId`/`name`/`title` and `options`). 

The question is how to safely approve only Berry MCP tools. In the standard ACP shape, the agent-side `toolCall.name` for an MCP tool is the tool name, but there is no guaranteed server-qualified identity in the permission request. The robust approach used across these adapters: the MCP tool call's `name`/`title` corresponds to the Berry MCP server's tools, and I gate strictly against the known allow-set, choosing the reject option by default. But a native tool titled like a Berry tool must not be approved.

Let me look at how the actual kiro.ts and cursor.ts resolve this, and whether Kimi Code CLI (which the catalog says is TypeScript, repo `MoonshotAI/kimi-code`) prefixes MCP tool names. Let me first read kiro.ts and cursor.ts permission functions in this checkout to mirror the proven pattern precisely.Now I understand the landscape. Cursor doesn't use ACP permission callbacks (it's `--print --output-format stream-json` with a project-level permissions policy file, so no `request_permission` identity issue). Kiro uses its custom `_meta.kiro.mcpTool.identity`. Kimi Code CLI is a **standard ACP server**, so its `session/request_permission` uses the standard shape.

Let me verify precisely how Kimi Code CLI (the actual implementation, `MoonshotAI/kimi-code`, TypeScript) names MCP tools in the permission request. The critical question: for an MCP server named `berry` with tool `read_issue`, what does `toolCall.name`/`title` look like in Kimi's `request_permission`? Let me search the Kimi Code CLI repo and ACP MCP docs.There's an official `kimi acp` reference page. Let me fetch it to see the exact ACP permission/tool-call payload Kimi emits.Web fetch is being declined. I have enough from the authoritative ACP spec results to make the correct engineering decision. Let me reason it through with the systematic-debugging lens, since this is the crux defect.

**Estab

## Files
- server-ts/src/agents/runtime/adapters/kimi-acp.ts
- server-ts/src/agents/runtime/adapters/kimi.test.ts
- server-ts/src/agents/runtime/adapters/kimi.ts

Repository: laravel42/berry
Branch: software-engineer/ber-244-wire-the-kimi-ai-runtime-workstation
