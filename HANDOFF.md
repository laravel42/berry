HANDOFF.md

# Handoff from BER-245

Wire the Grok AI runtime (workstation CLI login)

I now have a proper repository checkout with run_command. Let me first check what's already saved, per the run instructions.Let me load the run_command and other tools I need.The Berry tools are no longer loaded in this new run. Let me check what tools are available by loading them.This is an mcp_berry environment. Let me use the correct tools. First, let me look at the repository structure.The browse_repository shows empty, but execute_bash with git works. Let me use execute_bash to explore the actual checkout.The full repository is here. The working tree is clean (no prior work saved for this task). Let me read the key files, starting with the ADR and the runtime docs.Now the key catalog file and the three adapters.Now the three adapters to mirror. Let me look at the adapters directory.Now the Grok acceptance criteria depend on whether xAI ships an official local CLI with in-CLI account login. The catalog already describes "Grok Build CLI" at docs.x.ai/build. I must verify this against official docs before relying on it. Let me check the ADR evidence requirements, then verify Grok's official docs. First, let me read the kiro.ts and claude.ts adapters and the connect path, then verify the docs.I now understand the connect path. The key branches are `claude`/`codex` and `kiro`. For Grok, which uses CLI login (like claude/codex, no API key stored), I'll add it to the claude/codex branch. 

Before implementing, I must verify Grok (xAI) ships an official local CLI with in-CLI account login that stays in the CLI. The catalog cites `https://docs.x.ai/build/overview` and `https://docs.x.ai/build/cli/reference`. Let me verify these official docs.The search confirms: xAI's "Grok Build" is an official coding-agent CLI (`grok`), with interactive browser login, available to SuperGrok and X Premium Plus subscribers, and supports ACP + headless. Let me verify the authentication detail — that the subscription login stays in the CLI and is distinct from `XAI_API_KEY`. Let me fetch the official authentication doc from the xai-org GitHub repo.This fully confirms the official Grok Build CLI pattern, mirroring Codex/Claude:

1. **Official local CLI**: `grok` binary, installable via `npm install -g @xai-official/grok` or `x.ai/cli/install.sh`.
2. **In-CLI subscription login that stays in the CLI**: Browser login (default) or device-code (`grok login --device-auth`) through SpaceXAI OAuth at auth.x.ai, for SuperGrok/X Premium Plus subscribers. Credentials stay in `~/.grok/auth.json` — Berry never reads that store.
3. **API key is a separate path**: `XAI_API_KEY` is explicitly a fallback for CI/automation, which Berry refuses (no API key stored/forwarded).
4. **Login/connect detection**: Auth precedence is session token ( `~/.grok/auth.json`) over `XAI_API_KEY`. So "connected" = active session token present, not api-key.

This matches the Codex adapter pattern exactly: the CLI keeps its own OAuth login, API-key billing is refused, Berry only starts the process. 

Now let me examine the login-status detection mechanism for Grok. The Codex adapter uses `codex login status`. Let me check if Grok has an equivalent. Let me read the CLI reference.The ACP interface is `grok agent stdio`, and headless is `grok -p`. The Claude adapter uses ACP; Codex uses headless JSONL. Let me look at the CLI reference and the kiro ACP adapter structure to decide which to mirror. Let me fetch the CLI reference for exact subcommands (login status, models, headless flags).Let me search the saved file for the key headless details: JSON output format, model flag, session/resume, and auth-related output.Grok's headless mode is very similar to Codex's but with a richer `streaming-json` ACP-derived format. Importantly: `apiKeySource` field distinguishes `user` (API-key) from `oauth`. The `-p` headless with `--output-format json` and the ACP path (`grok agent`) are both available.

Given the task is "mirror the closest existing adapter," Codex (headless JSONL via `exec --json`) is the closest. Grok's headless uses `grok -p "<prompt>" --output-format json` (or streaming-json). But I should decide between mirroring Codex (headless) or Claude (ACP). Let me check the login-status detection — the critical connection detection. Let me look for a `grok` subcommand that reports login status without browser. Let me check the CLI reference page.The web_fetch to docs.x.ai is being rejected (likely a redirect to a different origin or policy). I have enough from the GitHub source docs. Let me check the models listing and login status via the official GitHub repo docs instead. Let me search the repo for a models/whoami command.Key finding from result #5: the official `xai-org/grok-build-plugin-cc` plugin states "soft auth via **grok models** succeeds" — meaning `grok models` is the official command that both lists models AND confirms authentication (it fails if not logged in). This is the detection mechanism, analogous to Codex's `codex debug models` + `codex login s

## Files
- docs/ai-runtimes.md
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
