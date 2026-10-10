export const AI_RUNTIME_IDS = [
   'claude',
   'codex',
   'opencode',
   'openclaw',
   'hermes',
   'pi',
   'cursor',
   'kimi',
   'kiro',
   'antigravity',
   'qoder',
   'trae-cli',
   'grok',
   'qwen',
] as const;

export type AiRuntimeId = (typeof AI_RUNTIME_IDS)[number];
export type AiRuntimeExecutionMode = 'direct_inference' | 'agent_process';
export type AiRuntimeBilling = 'subscription' | 'api_billing' | 'provider_dependent' | 'unknown';
export type AiRuntimeAvailability = 'available' | 'blocked';
export type AiRuntimeCapability = 'supported' | 'unsupported' | 'unknown';

export interface AiRuntimeDefinition {
   id: AiRuntimeId;
   name: string;
   publisher: string;
   product: string;
   description: string;
   executionMode: AiRuntimeExecutionMode;
   provider: string;
   billing: AiRuntimeBilling;
   billingDetail: string;
   subscriptionAccess: AiRuntimeCapability;
   connectionMethods: string[];
   platforms: string[];
   localProcess: boolean;
   installation: string;
   defaultModel: string | null;
   capabilities: {
      modelDiscovery: AiRuntimeCapability;
      streaming: AiRuntimeCapability;
      tools: AiRuntimeCapability;
      sessions: AiRuntimeCapability;
      cancellation: AiRuntimeCapability;
      usage: AiRuntimeCapability;
   };
   availability: AiRuntimeAvailability;
   unavailableReason: string | null;
   officialSources: string[];
}

/**
 * Product facts verified from first-party documentation on 2026-10-08.
 *
 * `available` means this Berry build has both a supported authentication
 * boundary and an executable adapter. A documented CLI alone is not enough:
 * the Berry server cannot reach a person's laptop or copy its credential
 * store into an AgentCore session.
 */
export const AI_RUNTIME_CATALOG: readonly AiRuntimeDefinition[] = [
   {
      id: 'claude',
      name: 'Claude',
      publisher: 'Anthropic',
      product: 'Claude Code CLI',
      description: 'Anthropic’s coding agent. Berry starts the Claude Code CLI already signed in on this workstation.',
      executionMode: 'agent_process',
      provider: 'Anthropic Claude',
      billing: 'subscription',
      billingDetail: 'Claude Pro, Max, Team, or Enterprise can authenticate Claude Code. API credentials remain separately billed.',
      subscriptionAccess: 'supported',
      connectionMethods: ['claude auth login on this workstation'],
      platforms: ['macOS', 'Linux', 'Windows'],
      localProcess: true,
      installation: 'Install the official Claude Code CLI on the workstation PATH and sign in with `claude auth login`. Berry does not bundle the CLI and does not read its credential store.',
      defaultModel: null,
      capabilities: {
         modelDiscovery: 'supported', streaming: 'supported', tools: 'supported', sessions: 'supported',
         cancellation: 'supported', usage: 'supported',
      },
      availability: 'available',
      unavailableReason: null,
      officialSources: [
         'https://docs.anthropic.com/en/docs/claude-code/team',
         'https://docs.anthropic.com/en/docs/claude-code/sdk/sdk-headless',
      ],
   },
   {
      id: 'codex',
      name: 'Codex',
      publisher: 'OpenAI',
      product: 'Codex CLI',
      description: 'OpenAI’s coding agent. Berry starts the Codex CLI already signed in with ChatGPT on this workstation.',
      executionMode: 'agent_process',
      provider: 'OpenAI Codex models',
      billing: 'subscription',
      billingDetail: 'A ChatGPT plan signs in the Codex CLI. API-key login is a separate bill and is refused.',
      subscriptionAccess: 'supported',
      connectionMethods: ['codex login on this workstation'],
      platforms: ['macOS', 'Linux', 'Windows'],
      localProcess: true,
      installation: 'Install the official Codex CLI on the workstation PATH and sign in with ChatGPT. Berry does not bundle the CLI and does not read its credential store.',
      defaultModel: null,
      capabilities: {
         modelDiscovery: 'supported', streaming: 'supported', tools: 'supported', sessions: 'supported',
         cancellation: 'supported', usage: 'supported',
      },
      availability: 'available',
      unavailableReason: null,
      officialSources: [
         'https://developers.openai.com/codex/cli',
         'https://developers.openai.com/codex/app-server',
      ],
   },
   {
      id: 'opencode',
      name: 'OpenCode',
      publisher: 'OpenCode',
      product: 'OpenCode coding agent and server',
      description: 'An open coding-agent framework with an HTTP/OpenAPI server. Its model access belongs to the configured provider, not OpenCode itself.',
      executionMode: 'agent_process',
      provider: 'Provider selected in OpenCode',
      billing: 'provider_dependent',
      billingDetail: 'OpenCode Go is its own plan; other models use the configured provider subscription or API billing.',
      subscriptionAccess: 'supported',
      connectionMethods: ['Provider OAuth/device flow', 'Provider API key', 'OpenCode Go key'],
      platforms: ['macOS', 'Linux', 'Windows'],
      localProcess: true,
      installation: 'Install OpenCode and configure a protected `opencode serve` process on the runtime host.',
      defaultModel: null,
      capabilities: {
         modelDiscovery: 'supported', streaming: 'supported', tools: 'supported', sessions: 'supported',
         cancellation: 'supported', usage: 'unknown',
      },
      availability: 'blocked',
      unavailableReason:
         'OpenCode is a framework, not a subscription entitlement. Berry has no per-user OpenCode server boundary and will not copy ~/.local/share/opencode/auth.json.',
      officialSources: ['https://opencode.ai/docs/providers/', 'https://opencode.ai/docs/server/'],
   },
   {
      id: 'openclaw',
      name: 'OpenClaw',
      publisher: 'OpenClaw',
      product: 'OpenClaw Gateway',
      description: 'A self-hosted agent gateway with WebSocket control, sessions, approvals, models, channels, and provider-owned authentication.',
      executionMode: 'agent_process',
      provider: 'Provider configured in OpenClaw',
      billing: 'provider_dependent',
      billingDetail: 'OAuth or API billing belongs to the selected model provider; installing OpenClaw grants no model entitlement.',
      subscriptionAccess: 'supported',
      connectionMethods: ['Provider OAuth', 'Provider API key', 'Claude CLI reuse', 'Anthropic setup-token'],
      platforms: ['macOS', 'Linux', 'Windows'],
      localProcess: true,
      installation: 'Install and operate an authenticated OpenClaw Gateway.',
      defaultModel: null,
      capabilities: {
         modelDiscovery: 'supported', streaming: 'supported', tools: 'supported', sessions: 'supported',
         cancellation: 'supported', usage: 'supported',
      },
      availability: 'blocked',
      unavailableReason:
         'OpenClaw credentials are gateway- or provider-owned. Berry has no principal-isolated Gateway registration and will not read its per-agent credential store.',
      officialSources: [
         'https://docs.openclaw.ai/gateway/authentication',
         'https://github.com/openclaw/openclaw/blob/main/docs/gateway/protocol.md',
      ],
   },
   {
      id: 'hermes',
      name: 'Hermes',
      publisher: 'Nous Research',
      product: 'Hermes Agent',
      description: 'An agent framework exposing ACP, a JSON-RPC TUI gateway, and an HTTP/SSE API server.',
      executionMode: 'agent_process',
      provider: 'Nous Portal or configured provider',
      billing: 'provider_dependent',
      billingDetail: 'Nous Portal has a subscription; other routes consume their provider’s subscription, plan, or API billing.',
      subscriptionAccess: 'supported',
      connectionMethods: ['Nous Portal OAuth', 'Provider OAuth/device flow', 'Provider API key'],
      platforms: ['Linux', 'macOS', 'Windows through WSL2'],
      localProcess: true,
      installation: 'Install Hermes Agent and configure one provider on the runtime host.',
      defaultModel: null,
      capabilities: {
         modelDiscovery: 'supported', streaming: 'supported', tools: 'supported', sessions: 'supported',
         cancellation: 'supported', usage: 'supported',
      },
      availability: 'blocked',
      unavailableReason:
         'Hermes is an agent framework whose credentials live in its own principal-wide store. Berry has not shipped an isolated Hermes gateway per connected user.',
      officialSources: [
         'https://hermes-agent.nousresearch.com/docs/developer-guide/programmatic-integration',
         'https://hermes-agent.nousresearch.com/docs/integrations/providers',
      ],
   },
   {
      id: 'pi',
      name: 'Pi',
      publisher: 'Earendil Works',
      product: 'Pi coding agent',
      description: 'A minimal coding-agent harness with a JSONL RPC process mode and provider-specific OAuth or API credentials.',
      executionMode: 'agent_process',
      provider: 'Provider selected in Pi',
      billing: 'provider_dependent',
      billingDetail: 'The selected provider owns entitlement and billing; Pi itself does not grant model access.',
      subscriptionAccess: 'supported',
      connectionMethods: ['Provider browser/device OAuth', 'Provider API key', 'ambient cloud credentials'],
      platforms: ['macOS', 'Linux', 'Windows'],
      localProcess: true,
      installation: 'Install the Pi coding-agent CLI on the runtime host.',
      defaultModel: null,
      capabilities: {
         modelDiscovery: 'supported', streaming: 'supported', tools: 'supported', sessions: 'supported',
         cancellation: 'supported', usage: 'supported',
      },
      availability: 'blocked',
      unavailableReason:
         'Pi stores OAuth and API credentials in its local auth file. Berry has no supported delegated token boundary and will not scrape or copy that file.',
      officialSources: [
         'https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/rpc.md',
         'https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/providers.md',
      ],
   },
   {
      id: 'cursor',
      name: 'Cursor',
      publisher: 'Cursor',
      product: 'Cursor Agent CLI',
      description: 'Cursor’s coding agent. Berry starts the Cursor Agent CLI already signed in with a Cursor account on this workstation.',
      executionMode: 'agent_process',
      provider: 'Cursor model service',
      billing: 'subscription',
      billingDetail: 'A Cursor account login signs in the CLI. API-key automation is a separate billing path and is not forwarded by Berry.',
      subscriptionAccess: 'supported',
      connectionMethods: ['cursor-agent login on this workstation'],
      platforms: ['macOS', 'Linux', 'Windows'],
      localProcess: true,
      installation: 'Install the official Cursor Agent CLI on the workstation PATH and sign in with `cursor-agent login`. Berry does not bundle the CLI and does not read its credential store.',
      defaultModel: null,
      capabilities: {
         modelDiscovery: 'supported', streaming: 'supported', tools: 'supported', sessions: 'supported',
         cancellation: 'supported', usage: 'unknown',
      },
      availability: 'available',
      unavailableReason: null,
      officialSources: [
         'https://cursor.com/docs/cli/overview',
         'https://cursor.com/docs/cli/reference/authentication',
         'https://cursor.com/docs/cli/reference/parameters',
      ],
   },
   {
      id: 'kimi',
      name: 'Kimi',
      publisher: 'Moonshot AI',
      product: 'Kimi Code CLI',
      description: 'Moonshot’s coding agent. Berry starts the Kimi Code CLI already signed in on this workstation over its ACP server.',
      executionMode: 'agent_process',
      provider: 'Kimi Code model service',
      billing: 'subscription',
      billingDetail: 'A Kimi Code account signs in the CLI; the CLI reports its own quota. Moonshot platform API keys are a separate billing path and are not forwarded.',
      subscriptionAccess: 'supported',
      connectionMethods: ['kimi /login on this workstation'],
      platforms: ['macOS', 'Linux', 'Windows'],
      localProcess: true,
      installation: 'Install the official Kimi Code CLI on the workstation PATH and sign in with `kimi` then `/login`. Berry does not bundle the CLI and does not read its credential store.',
      defaultModel: null,
      capabilities: {
         modelDiscovery: 'supported', streaming: 'supported', tools: 'supported', sessions: 'supported',
         cancellation: 'supported', usage: 'supported',
      },
      availability: 'available',
      unavailableReason: null,
      officialSources: [
         'https://github.com/MoonshotAI/kimi-code',
         'https://www.kimi.com/code/docs/en/kimi-cli/guides/getting-started.html',
      ],
   },
   {
      id: 'kiro',
      name: 'Kiro',
      publisher: 'AWS',
      product: 'Kiro CLI V3 ACP server',
      description: 'Kiro’s coding-agent harness exposed over ACP, with negotiated models, tool approvals, sessions, streaming, cancellation, and usage extensions.',
      executionMode: 'agent_process',
      provider: 'Kiro model service',
      billing: 'subscription',
      billingDetail: 'A paid-plan API key is the official headless credential. Credits come off that subscription. Berry does not switch the run to another billing path.',
      subscriptionAccess: 'supported',
      connectionMethods: ['KIRO_API_KEY from a Pro, Pro+, Pro Max, or Power plan'],
      platforms: ['macOS', 'Linux', 'Windows 11'],
      localProcess: true,
      installation: 'Install the official kiro-cli binary on the user workstation PATH. Berry does not bundle it and does not start it inside the runtime container.',
      defaultModel: null,
      capabilities: {
         modelDiscovery: 'supported', streaming: 'supported', tools: 'supported', sessions: 'supported',
         cancellation: 'supported', usage: 'supported',
      },
      availability: 'available',
      unavailableReason: null,
      officialSources: [
         'https://kiro.dev/docs/cli/v3/acp-migration/',
         'https://kiro.dev/docs/getting-started/authentication/',
         'https://kiro.dev/docs/cli/headless/',
      ],
   },
   {
      id: 'antigravity',
      name: 'Antigravity',
      publisher: 'Google',
      product: 'Google Antigravity CLI and Gemini API managed agent',
      description: 'Google’s agent harness. The local CLI can be orchestrated headlessly; the similarly named managed agent is a Gemini API preview.',
      executionMode: 'agent_process',
      provider: 'Google account for CLI; Gemini API for managed agent',
      billing: 'unknown',
      billingDetail: 'Local CLI account usage and Gemini API pay-as-you-go are distinct. The managed-agent API does not consume a consumer subscription.',
      subscriptionAccess: 'supported',
      connectionMethods: ['Antigravity CLI Google login', 'Gemini API key for managed agent'],
      platforms: ['macOS', 'Linux', 'Windows'],
      localProcess: true,
      installation: 'Install and authenticate the official Antigravity CLI on the runtime host.',
      defaultModel: null,
      capabilities: {
         modelDiscovery: 'supported', streaming: 'supported', tools: 'supported', sessions: 'supported',
         cancellation: 'supported', usage: 'supported',
      },
      availability: 'blocked',
      unavailableReason:
         'Google supports launching the official CLI as a local child but forbids extracting or reusing its OAuth credential. Berry has no local companion; the remote managed agent is API-billed preview access, not subscription access.',
      officialSources: [
         'https://ai.google.dev/gemini-api/docs/antigravity-agent',
         'https://discuss.ai.google.dev/t/is-external-orchestration-of-antigravity-cli-headless-mode-supported-with-account-based-usage/183051',
      ],
   },
   {
      id: 'qoder',
      name: 'Qoder',
      publisher: 'Qoder',
      product: 'Qoder CLI and Agent SDK',
      description: 'Qoder’s coding-agent process, available through ACP or its TypeScript/Python Agent SDK.',
      executionMode: 'agent_process',
      provider: 'Qoder model service',
      billing: 'subscription',
      billingDetail: 'Browser login or a Qoder PAT uses the Qoder account and its plan quota; it is not a model-provider API key.',
      subscriptionAccess: 'supported',
      connectionMethods: ['Qoder browser login', 'Qoder Personal Access Token'],
      platforms: ['macOS', 'Linux', 'Windows'],
      localProcess: true,
      installation: 'Install Qoder CLI on the runtime host; third-party automation should use its PAT or SDK authentication.',
      defaultModel: null,
      capabilities: {
         modelDiscovery: 'supported', streaming: 'supported', tools: 'supported', sessions: 'supported',
         cancellation: 'supported', usage: 'supported',
      },
      availability: 'blocked',
      unavailableReason:
         'Qoder has an official third-party PAT boundary, but its CLI/SDK is not shipped in Berry’s runtime image and has not completed Berry’s dependency and protocol validation.',
      officialSources: [
         'https://docs.qoder.com/cli/acp',
         'https://docs.qoder.com/cli/authentication',
         'https://docs.qoder.com/cli/sdk/quick-start',
      ],
   },
   {
      id: 'trae-cli',
      name: 'Trae CLI',
      publisher: 'ByteDance',
      product: 'Trae Agent CLI',
      description: 'An open-source research-oriented software-engineering agent that runs against separately configured model providers.',
      executionMode: 'agent_process',
      provider: 'OpenAI, Anthropic, Google, Doubao, OpenRouter, Ollama, or another configured provider',
      billing: 'provider_dependent',
      billingDetail: 'Trae Agent requires credentials for the chosen provider; a Trae product account does not grant this CLI model access.',
      subscriptionAccess: 'unsupported',
      connectionMethods: ['Provider API key', 'local Ollama endpoint'],
      platforms: ['macOS', 'Linux', 'Windows through a compatible Python environment'],
      localProcess: true,
      installation: 'Clone/install the open-source Trae Agent CLI and configure a model provider.',
      defaultModel: null,
      capabilities: {
         modelDiscovery: 'unknown', streaming: 'supported', tools: 'supported', sessions: 'supported',
         cancellation: 'unknown', usage: 'supported',
      },
      availability: 'blocked',
      unavailableReason:
         'The maintained Trae Agent source requires provider API keys and documents no Trae subscription OAuth or delegated account entitlement. Berry will not label provider billing as Trae subscription access.',
      officialSources: ['https://github.com/bytedance/trae-agent'],
   },
   {
      id: 'grok',
      name: 'Grok',
      publisher: 'xAI',
      product: 'Grok Build CLI',
      description: 'xAI’s coding-agent CLI with TUI, headless streaming, ACP, tools, permissions, sessions, and model discovery.',
      executionMode: 'agent_process',
      provider: 'xAI Grok models or a configured custom provider',
      billing: 'subscription',
      billingDetail: 'Browser/device login may use eligible Grok account access; XAI_API_KEY is a distinct API-billed path.',
      subscriptionAccess: 'supported',
      connectionMethods: ['xAI browser login', 'device-code login', 'XAI_API_KEY'],
      platforms: ['macOS', 'Linux', 'Windows'],
      localProcess: true,
      installation: 'Install the official Grok Build CLI on the runtime host.',
      defaultModel: null,
      capabilities: {
         modelDiscovery: 'supported', streaming: 'supported', tools: 'supported', sessions: 'supported',
         cancellation: 'supported', usage: 'unknown',
      },
      availability: 'blocked',
      unavailableReason:
         'Subscription login is owned by the local Grok process. Berry has no provider-documented delegated token or local companion, and will not switch to XAI_API_KEY billing.',
      officialSources: ['https://docs.x.ai/build/overview', 'https://docs.x.ai/build/cli/reference'],
   },
   {
      id: 'qwen',
      name: 'Qwen',
      publisher: 'Alibaba Cloud / Qwen',
      product: 'Qwen Code CLI and experimental daemon',
      description: 'Qwen’s terminal coding agent with ACP and an HTTP/SSE daemon. The current subscription route is Alibaba ModelStudio Coding Plan.',
      executionMode: 'agent_process',
      provider: 'Alibaba ModelStudio Coding Plan or configured provider',
      billing: 'subscription',
      billingDetail: 'Coding Plan is a fixed subscription with a dedicated key and endpoint. Token Plan and standard API keys use different billing.',
      subscriptionAccess: 'supported',
      connectionMethods: ['Alibaba Coding Plan key', 'Token Plan key', 'provider API key'],
      platforms: ['macOS', 'Linux', 'Windows'],
      localProcess: true,
      installation: 'Install Qwen Code; configure Coding Plan through `/auth` or its documented environment variables.',
      defaultModel: null,
      capabilities: {
         modelDiscovery: 'supported', streaming: 'supported', tools: 'supported', sessions: 'supported',
         cancellation: 'supported', usage: 'supported',
      },
      availability: 'blocked',
      unavailableReason:
         'Qwen OAuth was discontinued. Coding Plan uses a subscription key, while `qwen serve` is currently experimental and explicitly local/single-principal; Berry will not expose it as a production multi-user runtime yet.',
      officialSources: [
         'https://qwenlm.github.io/qwen-code-docs/en/users/configuration/auth/',
         'https://qwenlm.github.io/qwen-code-docs/en/users/qwen-serve/',
      ],
   },
];

export function findAiRuntime(id: string): AiRuntimeDefinition | undefined {
   return AI_RUNTIME_CATALOG.find((runtime) => runtime.id === id);
}

export function isAiRuntimeId(value: string): value is AiRuntimeId {
   return (AI_RUNTIME_IDS as readonly string[]).includes(value);
}
