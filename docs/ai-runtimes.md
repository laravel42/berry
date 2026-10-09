# AI runtimes

Berry distinguishes four facts that are often collapsed into one label:

1. **Execution host** — the AgentCore Runtime or HTTP runtime image that receives a Berry task envelope.
2. **AI runtime** — the model client or provider-owned agent process inside that host.
3. **Model provider** — the service that serves the selected model.
4. **Authentication and billing** — the account, credential, entitlement, and quota charged for the call.

Installing an agent framework does not grant model access. A consumer subscription is used only where the provider documents that path. Berry never extracts browser cookies, reads another CLI's credential store, impersonates a first-party client, or falls back to API billing or another account.

## What works in this release

**GitHub Copilot and Kiro are the connectable subscription runtimes.** Copilot uses GitHub's official SDK in multi-user server mode: `mode: "empty"`, one signed-in user's OAuth token per session, no ambient credentials, and only Berry-authorized tools. That adapter runs inside the runtime image. Kiro runs `kiro-cli acp --agent-engine=v3` on the user workstation, as a process Berry starts beside the server. It does not run inside the runtime container. Each run gets an empty home directory and that user's sealed subscription API key, passed only as `KIRO_API_KEY` and as the answer to `_kiro/auth/getAccessToken`. Native shell and file tools are denied. Berry tools are exposed as the `berry` MCP server. The workstation process streams text, tool events, execution status, and cancellation into Berry's existing run ledger. Model discovery for Kiro runs in that workstation process. The product server still does not call a model.

Every other requested runtime remains visible in Settings → AI Runtimes with a specific blocker. A documented local CLI is not marked available when the Berry deployment cannot safely reach that CLI's runtime-owned login.

## Provider matrix

Evidence was reviewed on 2026-10-08. “Subscription” means an officially documented account or plan path, not an assumption that a web subscription includes API access.

| Runtime | Identity and platforms | Subscription support and auth | Machine interface and capabilities | Execution boundary | Berry status and limitation | Official evidence |
| --- | --- | --- | --- | --- | --- | --- |
| Claude | Anthropic Claude Agent SDK / Claude Code CLI; macOS, Linux, Windows | Yes: Claude account login for eligible Pro, Max, Team, or Enterprise plans; official setup token for unattended CLI use. Console/API and cloud-provider billing are separate. | Agent SDK or headless CLI; model selection, streamed output, built-in tools, permissions, resumable sessions, cancellation, and usage status. | Local process operated by the integrator; Managed Agents are a separate hosted API product. | **Blocked.** Berry does not copy Claude's local credential store between AgentCore sessions. An official delegated token or persistent per-user host is required. | [Authentication](https://docs.anthropic.com/en/docs/claude-code/team), [Agent SDK](https://docs.anthropic.com/en/docs/claude-code/sdk/sdk-headless) |
| Codex | OpenAI Codex app-server; macOS, Linux, Windows | Yes: ChatGPT account/device login and Sign in with ChatGPT. API keys are separate. | Documented JSON-RPC app-server: model list, threads, turns, deltas, tools, approvals, resume, interrupt, usage, and rate limits. | Local process; experimental WebSocket transport exists but is not production-supported. | **Blocked by eligibility.** Hosted/commercial app-server auth requires Sign in with ChatGPT and partner/client registration. Berry has no approved OAuth client and does not reuse CLI credentials. | [App-server](https://developers.openai.com/codex/app-server), [Sign in with ChatGPT cookbook](https://developers.openai.com/siwc/token-sharing-open-source/codex-app-server) |
| GitHub Copilot | GitHub Copilot SDK plus bundled headless CLI runtime; macOS, Linux, Windows | Yes: GitHub OAuth user token; each request consumes that user's Copilot entitlement and limits. BYOK is a separate provider-billing mode. | Official SDK/JSON-RPC runtime: dynamic models, streaming, custom tools, sessions, persistence, cancellation, usage and policy errors. | Child process or protected backend runtime. GitHub documents shared runtime pools with per-session tokens and `mode: "empty"`. | **Available and implemented.** Requires Berry GitHub sign-in and an active Copilot entitlement. No API-key fallback. | [OAuth setup](https://docs.github.com/en/copilot/how-tos/copilot-sdk/set-up-copilot-sdk/github-oauth), [Multi-user servers](https://docs.github.com/en/copilot/how-tos/copilot-sdk/setup/multi-tenancy), [Backend runtime](https://docs.github.com/en/copilot/how-tos/copilot-sdk/setup/backend-services) |
| OpenCode | OpenCode coding agent/server; macOS, Linux, Windows | Provider-dependent. OpenCode Go is its own plan; GitHub Copilot, ChatGPT, and provider API paths are distinct. Claude subscription plugins are explicitly not supported. | HTTP/OpenAPI server and SDK: providers/models, SSE events, sessions, prompts, tools, permission replies, abort, fork and diffs. | Local/headless server; remote exposure requires operator authentication and network controls. | **Blocked.** OpenCode is a framework, not one entitlement. Berry has no principal-isolated OpenCode server and will not read `auth.json`. | [Providers](https://opencode.ai/docs/providers/), [Server API](https://opencode.ai/docs/server/) |
| OpenClaw | OpenClaw Gateway; macOS, Linux, Windows | Provider-dependent OAuth/API credentials. It can route through a sanctioned local Claude CLI or provider setup token where supported. | WebSocket gateway for models, agent runs, sessions, approvals, cancellation, status, and usage. | Long-running local/self-hosted gateway. | **Blocked.** No per-user Gateway registration or safe credential delegation exists in Berry; Gateway credential stores are not imported. | [Authentication](https://docs.openclaw.ai/gateway/authentication), [Gateway protocol](https://github.com/openclaw/openclaw/blob/main/docs/gateway/protocol.md) |
| Hermes | Nous Research Hermes Agent; Linux/macOS, Windows through WSL2 | Provider-dependent. Nous Portal is a subscription; other OAuth and API routes retain their own billing rules. | ACP, JSON-RPC TUI gateway, and HTTP/SSE API; model discovery, streaming, tools, approvals, sessions, branch/resume, stop, and usage. | Local process or self-hosted API server. | **Blocked.** Hermes stores principal-wide provider credentials. Berry has not shipped one isolated Hermes gateway per user. | [Programmatic integration](https://hermes-agent.nousresearch.com/docs/developer-guide/programmatic-integration), [Provider/billing guide](https://hermes-agent.nousresearch.com/docs/integrations/providers) |
| Pi | Earendil Works Pi coding agent; macOS, Linux, Windows | Provider-dependent browser/device OAuth or API key; Pi itself supplies no model subscription. | JSONL RPC and TypeScript SDK: model discovery/switching, events, tools, sessions, fork/switch, abort, compact, and stats. | Local child process or in-process SDK. | **Blocked.** Credentials live in Pi's local auth file and no provider-neutral delegated token boundary is documented. | [RPC mode](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/rpc.md), [Providers](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/providers.md) |
| Cursor | Cursor Agent CLI; macOS, Linux, Windows | Yes: browser login with a Cursor account. API-key automation is a separate path. | ACP or headless `stream-json`; model listing, tools, permissions, sessions/resume, streaming and cancellation. | Local child process; remote worker is a separate first-party feature. | **Blocked.** Cursor login remains in the local CLI. Berry has neither a user-machine companion nor a documented delegated subscription token. | [ACP](https://cursor.com/docs/cli/acp), [Authentication](https://cursor.com/docs/cli/reference/authentication), [CLI parameters](https://cursor.com/docs/cli/reference/parameters) |
| Kimi | Moonshot Kimi Code CLI, successor to the archived Kimi CLI; macOS, Linux, Windows | Yes for Kimi Code membership/login; Moonshot platform API keys are separate. | Multi-session ACP plus JSONL print mode; models, tools, sessions/resume, streaming, cancellation, and `/usage` quota reporting. | Local child process. | **Blocked.** ACP requires an existing runtime-owned `kimi login`; it returns an auth-required error rather than delegating credentials to the client. | [ACP](https://moonshotai.github.io/kimi-cli/en/reference/kimi-acp.html), [Quota/auth FAQ](https://moonshotai.github.io/kimi-cli/en/faq.html) |
| Kiro | AWS Kiro CLI V3 ACP server; macOS, Linux, Windows 11 | Yes: a paid-plan `KIRO_API_KEY` is the official headless credential and draws that subscription's credits. | ACP JSON-RPC: negotiated models, streamed text/thought/tool events, permissions, sessions, and cancellation. | `kiro-cli` on the user workstation, with an empty home per run. | **Available and implemented.** Requires `kiro-cli` on the workstation PATH and a Pro, Pro+, Pro Max, or Power API key. Berry does not start it inside the runtime container. No other billing path. | [V3 ACP migration](https://kiro.dev/docs/cli/v3/acp-migration/), [Authentication](https://kiro.dev/docs/getting-started/authentication/), [Headless](https://kiro.dev/docs/cli/headless/) |
| Antigravity | Google Antigravity CLI and the separately billed Gemini API managed Antigravity agent; macOS, Linux, Windows | Local CLI account orchestration is supported and uses the account's entitlement. The managed API is pay-as-you-go/free-project quota, not consumer-subscription inference. | CLI structured streaming; managed Interactions API supports streaming, tools, stateful environments, background runs, continuation, usage budget, and cancellation. | Local official CLI, or Google-hosted API sandbox. | **Blocked.** Google forbids extracting/reusing CLI OAuth. Berry has no local companion; using the managed API would silently change the billing product. | [Managed agent](https://ai.google.dev/gemini-api/docs/antigravity-agent), [Official support clarification](https://discuss.ai.google.dev/t/is-external-orchestration-of-antigravity-cli-headless-mode-supported-with-account-based-usage/183051) |
| Qoder | Qoder CLI and Agent SDK; macOS, Linux, Windows | Yes: browser account login or Qoder PAT intended for CI and third-party integrations. | ACP or TypeScript/Python SDK; models, streamed tools/output, sessions, permissions, cancellation, and quota status. | Local child process/SDK. | **Blocked pending dependency review.** The official auth boundary is suitable, but Qoder's SDK/CLI has not completed Berry's license, packaging, protocol, and isolation validation. | [ACP](https://docs.qoder.com/cli/acp), [Authentication](https://docs.qoder.com/cli/authentication), [Agent SDK](https://docs.qoder.com/cli/sdk/quick-start) |
| Trae CLI | ByteDance open-source Trae Agent CLI; Python on compatible macOS/Linux/Windows environments | No Trae subscription path is documented. It requires a configured provider API key or local model endpoint. | CLI agent with tools, interactive/one-shot execution, trajectories, and provider selection; no maintained ACP contract is documented. | Local process or its Docker mode. | **Unavailable by external limitation.** A provider API key cannot be presented as Trae subscription access. | [Maintained source](https://github.com/bytedance/trae-agent) |
| Grok | xAI Grok Build CLI; macOS, Linux, Windows | Account browser/device login is documented; `XAI_API_KEY` is a separate API path. Entitlement can vary by account plan. | ACP, headless streaming JSON, model list, tools, permission rules, sessions/resume and cancellation. | Local child process. | **Blocked.** Subscription login is local-process-owned; Berry has no delegated token or companion and will not switch to API billing. | [Overview](https://docs.x.ai/build/overview), [CLI reference](https://docs.x.ai/build/cli/reference) |
| Qwen | Alibaba/Qwen Code CLI and experimental `qwen serve`; macOS, Linux, Windows | Yes through Alibaba ModelStudio Coding Plan with its subscription key and dedicated endpoint. Qwen OAuth free access ended; Token Plan and standard API keys bill differently. | ACP and experimental HTTP/SSE daemon: models, tools, permission events, sessions/load/resume, cancellation, usage and reconnect replay. | Current daemon is explicitly local/single-principal and experimental. | **Blocked.** The current daemon is not a production multi-user boundary. Berry will not treat discontinued OAuth or another plan's key as Coding Plan access. | [Authentication](https://qwenlm.github.io/qwen-code-docs/en/users/configuration/auth/), [Daemon](https://qwenlm.github.io/qwen-code-docs/en/users/qwen-serve/) |

Content was rephrased for compliance with licensing restrictions.

## User setup: GitHub Copilot

Prerequisites:

- Berry GitHub sign-in is configured and the user signed in through GitHub.
- The GitHub account has an active Copilot plan and its organization/enterprise policy permits SDK or CLI use.
- `INTEGRATION_ENCRYPTION_KEY` and the normal Better Auth secret remain configured as documented for Berry. No Copilot API key is added.
- The AgentCore/HTTP runtime image is rebuilt from this revision so it includes `@github/copilot-sdk@1.0.18` and the matching platform runtime artifact.

Steps:

1. Open **Settings → AI runtimes**.
2. On **GitHub Copilot**, select **Connect**. Berry verifies the GitHub OAuth identity and asks the runtime for the models available to that token.
3. Confirm the account name and models. Choose a default runtime and model. `Automatic` is the portable default.
4. On an idle task or conversation, use the runtime control to inherit the workspace preference, force **Berry managed**, or select GitHub Copilot and a model.
5. Start work. The run record stores `aiRuntimeId` and `aiModelId`; usage is attributed to the Copilot subscription and has no fabricated USD cost.
6. Disconnecting cancels active runs using that connection and clears the user's default. It does not sign the user out of Berry or revoke the GitHub OAuth grant.

## User setup: Kiro

Prerequisites:

- The workstation that runs Berry has the official `kiro-cli` binary on `PATH`. Berry does not ship that binary and does not start it inside the runtime container.
- The person has a Kiro Pro, Pro+, Pro Max, or Power plan and has created an API key at app.kiro.dev.
- `INTEGRATION_ENCRYPTION_KEY` is configured. The key is sealed at rest and is not returned by the API.

Steps:

1. Open **Settings → AI runtimes**.
2. On **Kiro**, select **Connect** and paste the API key. Berry asks `kiro-cli` on this workstation to verify it and to list models.
3. Choose a default runtime and one of the models Kiro advertised.
4. Start work. The run record stores `aiRuntimeId` and `aiModelId`. Usage stays on that Kiro subscription.
5. Disconnecting deletes the sealed key, clears the default, and cancels active runs that used the connection.

## Failure behavior

| Condition | Berry behavior | Action |
| --- | --- | --- |
| Runtime image not rebuilt / process missing | `RUNTIME_NOT_INSTALLED`; no fallback | For Copilot, rebuild and deploy the runtime image. For Kiro, install `kiro-cli` on the workstation PATH. |
| GitHub OAuth token missing, wrong type, or expired | `AI_RUNTIME_AUTH_REQUIRED` / `AUTH_EXPIRED`; no fallback | Sign out of Berry, sign in with GitHub again, then reconnect Copilot. |
| Organization disables Copilot runtime access | Connection/model discovery or run fails with normalized auth/policy error | Ask the GitHub organization owner to enable the feature. |
| Model not entitled or removed | `MODEL_UNAVAILABLE`; no replacement model | Select **Automatic** or another model returned by live discovery. |
| Subscription quota exhausted | `QUOTA_EXHAUSTED`; no API-key switch | Check the Copilot quota/reset and retry after it resets. |
| Runtime network failure | `NETWORK_ERROR`, retryable | Restore egress from the runtime host and retry. |
| Person cancels login/run | No connection is recorded, or the run becomes cancelled | Start the flow again only when wanted. |
| Connection is removed mid-run | Berry cancels every active run carrying that connection id | Reconnect and explicitly restart if the work should continue. |

## Manual validation with a real account

Automated tests never call GitHub or a model. For a release candidate, use a non-production workspace and account:

1. Build/deploy the runtime image and migrate a disposable Berry database through migration 221.
2. Connect a GitHub account with Copilot access. Verify Settings shows the exact login and a live model list.
3. Set Copilot/Automatic as the personal default. Start a chat and a repository task; verify text, tool start/completion, command output, usage, final result, and delivery appear in order.
4. Cancel while a command is running. Verify the run becomes cancelled, the Copilot child exits, and no process remains in the session.
5. Resume the conversation and verify the same connection-scoped session is used. Start the same task as another member and verify Berry requires that member's own connection.
6. Select a model the account cannot use and verify Berry reports `MODEL_UNAVAILABLE` without invoking Berry-managed Bedrock/Kilo.
7. Exhaust or temporarily restrict the test account quota and verify the actionable quota message and absent API fallback.
8. Disconnect during a run. Verify cancellation, default clearing, and that the GitHub sign-in remains available for normal Berry repository access.
9. Inspect product-server/runtime logs and prompt logs. Verify no OAuth token, task token, repository credential, or provider body appears.

## Adding a future adapter

1. **Verify the product first.** Add official links and evidence to `server-ts/src/runtime/ai-runtime-catalog.ts`. Record product identity, platforms, subscription eligibility, billing owner, auth method, machine interface, local/remote boundary, models, streaming, tools, sessions, cancellation, usage, and restrictions. Leave `availability: "blocked"` until the full path works.
2. **Choose the correct interface.** Implement `DirectInferenceAdapter` only for a model interface driven by Berry's loop. Implement `AgentProcessAdapter` when the provider owns planning, tools, permissions, sessions, or execution semantics.
3. **Keep SDK imports in the runtime image.** Provider/agent SDK imports belong under `server-ts/src/agents/runtime/` and must pass `pnpm check:models`. Pin the dependency exactly and confirm an MIT/Apache-2.0-compatible license and runtime artifact license.
4. **Define credential ownership.** Prefer the runtime's official login when one persistent principal owns that host. Berry may seal a token only when the provider explicitly supports third-party/server delegation. Never read another CLI's files, browser cookies, keychain, or undocumented endpoint.
5. **Enforce the user boundary.** Resolve the connection by `(workspace_id, user_id, runtime_key)`, snapshot its id onto the run, include the connection in the runtime session key, and refuse unattended work unless the provider documents a suitable service entitlement.
6. **Normalize, do not flatten.** Map text, thought summaries, tool start/output/completion, status, usage, cancellation, and provider errors into Berry lifecycle events. Preserve the provider session id for resume. Do not represent an agent process as a text completion.
7. **Fail closed on tools.** For a shared process use the provider's empty/safe mode, remove ambient tools and credentials, register only the intersection of the role contract and Berry permissions, and keep the human release gate unchanged.
8. **Add control operations.** Implement availability, auth status, disconnect, and live model discovery through the authenticated runtime-control seam. Return only account labels and model metadata; credentials never come back.
9. **Cover transitions.** Test missing/connected/expired auth, model discovery, event ordering, cancellation/process cleanup, timeout, normalized quota/network/model errors, user isolation, and absence of fallback.
10. **Document live validation.** Automated tests mock the provider. Add real-account steps and any preview, organization-policy, geography, or plan restrictions before changing the catalog to available.
