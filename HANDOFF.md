HANDOFF.md

# Handoff from BER-245

Wire the Grok AI runtime (workstation CLI login)

This run resumes with specific review feedback to address. Let me first see the current state of the work.The branch shows `main` with a `snapshot` commit, and there's a `HANDOFF.md` at the repo root (which the review says to remove). The run instructions say my work is on branch `software-engineer/ber-245-...` (commit 8d05373), but git shows `main` at `a6778a6 snapshot`. The workspace is a flattened snapshot of that branch's tree. Let me confirm my prior Grok files are present.The prior Grok adapter and test are present. Let me confirm the wiring files still have the GROK references.All prior wiring is in place. Now I'll address the review feedback point by point. Let me read the current `grok.ts` adapter's `#run` method and MCP config writing to make the fixes.The repo path differs now (repo-TajUZo was last run). Let me read via the current workspace relative path.Now I understand the current state. Let me address each review point. First I need to verify the actual `grok` CLI flags against the installed CLI — the review explicitly asks me to prove the flags rather than trust the stub. Let me check whether `grok` is installed.The command was rejected (grok CLI isn't available in this environment, and running it may be undesired). I cannot install or run the real `grok` CLI here. The review asks to "prove those flags against the installed grok CLI" — since I cannot execute it, I must verify the flags against xAI's official documentation (the authoritative source) and cite the exact flag reference, then make the auth-detection robust so a wrong assumption cannot make every connect look signed out.

Let me verify the exact CLI reference flags from the official docs: stdin prompt support, `--output-format` values, and the correct auth/models command. Let me fetch the official CLI reference.Let me fetch the headless-mode doc to confirm stdin prompt support and the exact prompt-passing mechanism. The review says "pass the prompt on stdin" — I need to confirm `grok` reads the prompt from stdin.This is critical and the review was right. Line 397 says: **"Headless mode does not read piped stdin into the prompt. Pass external content through command substitution or `--prompt-file`."** So I cannot pass the prompt on stdin — the official mechanism for a long prompt is **`--prompt-file <PATH>`**. That solves the argv-length problem the review raised, the officially-supported way.

Let me also confirm the sandbox profiles and that `read-only` must become writable. Let me check the sandbox doc for the writable profile name, and confirm `--disallowed-tools` tool names.Important finding at line 56: "Tool names are internal tool IDs (e.g. the shell tool is `run_terminal_cmd`, **not `bash`**)." So my `--disallowed-tools` list of `bash,...` includes a wrong name. Let me check the sandbox profiles doc for the writable profile name. Let me fetch the sandbox doc.Now I have the authoritative facts:
- **`workspace`** profile: reads everywhere, **writes to CWD** + `~/.grok/` + temp, network allowed. This is "the recommended profile for everyday development" and gives the CLI a writable checkout. This fixes the review's #1 (read-only checkout).
- Prompt via **`--prompt-file`** (stdin is NOT read into the prompt). Fixes #3.
- Tool IDs: shell is **`run_terminal_cmd`**, not `bash`. My denylist must use correct IDs — but importantly, if I use `workspace` sandbox, the CLI *should* be able to edit files, so I should NOT deny the file-writing tools. The whole point is to let Grok edit the checkout (like Claude/Codex which run their agent loop with Berry tools over MCP). 

Wait — let me reconsider the design against Claude/Codex. Claude runs with `--tools ''` (deny all builtins) and only Berry MCP tools; Codex runs `--sandbox read-only` and relies on Berry MCP tools for everything including writes. So in Berry's model, the agent edits the checkout **through Berry's MCP tools**, not the CLI's native file tools. The review says "The CLI cannot edit the checkout, so Berry has nothing to commit. Give the CLI a writable checkout."

So the fix is: the agent must be able to write the checkout. In Berry's architecture that happens via Berry MCP tools (the BerryMcpHost gives tools scoped to `input.workingDirectory`). But the review explicitly says to make the checkout writable — meaning the sandbox must not block writes to CWD. Let me check how Codex handles this — Codex uses `--sandbox read-only` yet the review passed Codex. The difference: Codex's Berry MCP tools do the writing, and the MCP bridge process runs outside Codex's sandbox. 

Let me reconsider: the review is specific that Grok's `read-only` + disallowed-tools means "the CLI cannot edit the checkout." The cleanest fix aligned with the reviewer: use `--sandbox workspace` (writable CWD) and stop denying the file/edit tools, so Grok can edit the checkout directly. Let me verify how the MCP config-out-of-checkout concern interacts. Let me first check the MCP config approach

## Files
- docs/ai-runtimes.md
- server-ts/src/agents/runtime/adapters/grok.test.ts
- server-ts/src/agents/runtime/adapters/grok.ts

Repository: laravel42/berry
Branch: software-engineer/ber-245-wire-the-grok-ai-runtime-workstation
