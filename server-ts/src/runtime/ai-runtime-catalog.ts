export const AI_RUNTIME_IDS = [
   'claude',
   'codex',
   'cursor',
   'grok',
   'kiro',
   'qoder',
   'kimi',
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
 * Connectable subscription CLIs. A product is omitted until Berry can start
 * its official child on a workstation login without reading a credential
 * store or forwarding a key. OpenCode, OpenClaw, Hermes, Pi, Antigravity,
 * Trae, and Qwen stay out until those adapters ship.
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
      id: 'grok',
      name: 'Grok',
      publisher: 'xAI',
      product: 'Grok Build CLI',
      description: 'xAI’s coding-agent CLI. Berry starts the Grok Build CLI already signed in on this workstation.',
      executionMode: 'agent_process',
      provider: 'xAI Grok models',
      billing: 'subscription',
      billingDetail: 'A SuperGrok or X Premium Plus `grok login` session signs in the CLI. XAI_API_KEY is a separate API bill and is refused.',
      subscriptionAccess: 'supported',
      connectionMethods: ['grok login on this workstation'],
      platforms: ['macOS', 'Linux', 'Windows'],
      localProcess: true,
      installation: 'Install the official Grok Build CLI on the workstation PATH and sign in with `grok login`. Berry does not bundle the CLI and does not read its credential store.',
      defaultModel: null,
      capabilities: {
         modelDiscovery: 'supported', streaming: 'supported', tools: 'supported', sessions: 'supported',
         cancellation: 'supported', usage: 'supported',
      },
      availability: 'available',
      unavailableReason: null,
      officialSources: [
         'https://docs.x.ai/build/overview',
         'https://docs.x.ai/build/cli/reference',
         'https://github.com/xai-org/grok-build/blob/main/crates/codegen/xai-grok-pager/docs/user-guide/02-authentication.md',
         'https://github.com/xai-org/grok-build/blob/main/crates/codegen/xai-grok-pager/docs/user-guide/14-headless-mode.md',
         'https://github.com/xai-org/grok-build/blob/main/crates/codegen/xai-grok-pager/docs/user-guide/07-mcp-servers.md',
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
      billingDetail: 'The Kiro CLI login on this workstation draws that subscription. Berry does not store a key and does not switch the run to another billing path.',
      subscriptionAccess: 'supported',
      connectionMethods: ['kiro login on this workstation'],
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
      id: 'qoder',
      name: 'Qoder',
      publisher: 'Qoder',
      product: 'Qoder CLI and Agent SDK',
      description: 'Qoder’s coding agent. Berry starts the Qoder CLI already signed in on this workstation and drives it over ACP.',
      executionMode: 'agent_process',
      provider: 'Qoder model service',
      billing: 'subscription',
      billingDetail: 'The CLI’s browser sign-in uses the person’s Qoder account and its plan quota. A Qoder PAT is a separate CI path and is not used.',
      subscriptionAccess: 'supported',
      connectionMethods: ['Qoder browser login on this workstation'],
      platforms: ['macOS', 'Linux', 'Windows'],
      localProcess: true,
      installation: 'Install the official Qoder CLI on the workstation PATH and sign in on first run. Berry starts `qoder --acp`, does not bundle the CLI, does not read its credential store, and does not pass a PAT or API key.',
      defaultModel: null,
      capabilities: {
         modelDiscovery: 'supported', streaming: 'supported', tools: 'supported', sessions: 'supported',
         cancellation: 'supported', usage: 'supported',
      },
      availability: 'available',
      unavailableReason: null,
      officialSources: [
         'https://docs.qoder.com/cli/acp',
         'https://docs.qoder.com/cli/authentication',
         'https://docs.qoder.com/cli/cli-reference',
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
];

export function findAiRuntime(id: string): AiRuntimeDefinition | undefined {
   return AI_RUNTIME_CATALOG.find((runtime) => runtime.id === id);
}

export function isAiRuntimeId(value: string): value is AiRuntimeId {
   return (AI_RUNTIME_IDS as readonly string[]).includes(value);
}

/** Adapter `checkAvailability` for a workstation CLI, or nothing when it was not probed. */
export type WorkstationCliPresence = {
   available: boolean;
   reason: string | null;
};

/**
 * Settings prints Available only when the CLI is on PATH. Static `availability`
 * stays product connectability so a missed probe cannot hide a connected runtime.
 */
export function withWorkstationCliPresence(
   definition: AiRuntimeDefinition,
   presence: WorkstationCliPresence | undefined,
): AiRuntimeDefinition & { installed: boolean } {
   return {
      ...definition,
      installed:
         definition.availability === 'available' &&
         definition.localProcess &&
         presence?.available === true,
   };
}
