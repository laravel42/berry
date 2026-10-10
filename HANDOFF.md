HANDOFF.md

# Handoff from BER-246

Wire conditional AI runtimes (Hermes, Qoder, Antigravity) and re-check blocked set

I'll start by reading the required documentation and existing code to understand the pattern, then investigate each runtime's official docs.Now let me read the catalog and existing adapters.Now the adapters. Let me read all three reference adapters and the mounts/index files.Now the claude and codex adapters, plus mounts and index.Now the mounts/runtimes.ts and index.ts, and the envelope for the login constants.I now understand the connect path. The connect route only recognizes `claude`, `codex`, and `kiro`; everything else throws `AI_RUNTIME_UNAVAILABLE`. Let me look at the envelope login constants and index.ts registration, and how the runtime image registers adapters.Now let me look at where adapters are registered in the runtime image and index.ts. Let me find the adapter registry.Now let me understand the full picture of what's needed. The task is strictly gated on official documentation. Before writing any code, I must investigate the official docs for Hermes, Qoder, and Antigravity (primary), and re-check OpenCode, OpenClaw, Pi, Trae CLI, Qwen (secondary).

The critical qualifying criterion from ADR-0019 and the existing claude/codex pattern: a runtime qualifies **only if** official docs show a local CLI runnable as a child process **with an account login that stays entirely in that CLI** (same model as claude/codex/kiro — no API key stored or forwarded by Berry).

Let me check the current catalog's recorded findings and the mounts section I need to extend, then do the doc research. Let me read the rest of mounts and index.ts registration.Now I understand the complete wiring picture. For a runtime to be "wired" I need to:
1. Create an adapter following claude/codex pattern
2. Register it in `host.ts` adapter registry
3. Add it to the connect path in `mounts/runtimes.ts`
4. Add a login constant in `envelope.ts` if OAuth-style
5. Update catalog `availability` and docs matrix

Now the key work: **investigate official docs**. Let me research each runtime. Starting with the three primary ones (Hermes, Qoder, Antigravity), then re-check the five.

Let me update session info and begin doc research.Important findings so far:

**Hermes**: The Nous Portal login does OAuth that opens a browser to portal.nousresearch.com and stores a refresh token at `~/.hermes/auth.json`. This is a login that opens the browser and the loopback callback runs **on the machine where Hermes runs** — this is the same model as Claude/Codex/Kiro (the login stays in the CLI's own credential store, Berry stores/forwards no API key). The provider-dependent note in the current catalog said "Hermes stores principal-wide provider credentials." But the Nous Portal path specifically is a single OAuth login that owns the subscription, stored in Hermes's own auth file. This is exactly the claude/codex model where the CLI keeps its own login.

**Qoder**: Qoder CLI has a browser login (first-run sign-in) and ACP mode (`--acp`). The sign-in stays in the CLI (browser OAuth with local callback). The CLI login is an account login that stays in the CLI. This matches the claude/codex/kiro pattern. The current catalog said "blocked pending dependency review" — not a login problem, but a packaging/isolation concern.

Let me read the authoritative Hermes CLI and ACP docs, and the Qoder authentication/ACP docs more fully. The key distinction for ADR-0019: does the login stay entirely in the CLI (no API key stored/forwarded by Berry)?It seems the fetch was rejected. Let me rely on search snippets and do more targeted searches, since the task is strictly doc-gated and I need solid evidence. Let me gather more on Hermes CLI programmatic integration (ACP), Qoder ACP/headless, and start the five re-checks.This is very informative. Key findings:

**Antigravity** — Now there is important new official evidence. Google AI Dev forum (official Google support responses) now clarify:
- Invoking the official unmodified `agy` CLI binary as a local child process, while authentication (`agy auth login`) and all backend communication stay strictly inside `agy.exe`, **is a supported use of CLI Headless Mode** (post id 186952, dated ~2026).
- Single-user local workflow launching `agy` from a local orchestrator is supported through official CLI Headless Mode (186954).
- Invoking the official `agy` CLI from a local AI coding assistant on an individual Google account: "Yes" (185992).
- Still **Unsupported**: extracting OAuth tokens from disk, reusing credentials in custom HTTP clients, calling backend endpoints directly.

So Antigravity's `agy` CLI now has an officially supported model: `agy auth login` keeps the account login entirely in the CLI, and launching `agy` as a local child while login stays in the CLI is supported. This is **exactly** the claude/codex/kiro pattern (login stays in CLI, Berry stores/forwards no API key). This qualifies.

**Hermes** — `hermes acp` starts a stdio JSON-RPC ACP server. Login (`hermes auth login` / Nous Portal OAuth) opens the bro

Repository: laravel42/berry
Branch: software-engineer/ber-246-wire-conditional-ai-runtimes-hermes-qoder
