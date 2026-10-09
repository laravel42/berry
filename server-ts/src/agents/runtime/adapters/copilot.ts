import { chmod, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
   CopilotClient,
   type CopilotClientOptions,
   type CopilotSession,
   type ModelInfo,
   type PermissionRequestResult,
   type SessionConfig,
   type SessionEvent,
   type Tool as CopilotTool,
} from '@github/copilot-sdk';
import type { Tool, ToolContext } from '@strands-agents/sdk';
import type { LifecycleEvent } from '../../../runtime/lifecycle.ts';
import { WORKDIR_KEY } from '../command-tool.ts';
import type {
   AgentProcessAdapter,
   AgentProcessResult,
   AgentProcessRun,
   RuntimeAvailability,
   RuntimeConnectionStatus,
   RuntimeCredential,
   RuntimeModel,
   RuntimePrincipalIsolation,
} from './types.ts';
import { RuntimeAdapterError } from './types.ts';

interface CopilotSessionLike {
   sessionId: string;
   sendAndWait(options: { prompt: string }, timeout?: number): Promise<{ data: { content: string } } | undefined>;
   disconnect(): Promise<void>;
   abort(): Promise<void>;
}

interface CopilotClientLike {
   start(): Promise<void>;
   stop(): Promise<Error[]>;
   forceStop(): Promise<void>;
   getStatus(): Promise<{ version: string }>;
   getAuthStatus(): Promise<{ isAuthenticated: boolean; login?: string; statusMessage?: string }>;
   listModels(): Promise<ModelInfo[]>;
   getSessionMetadata(sessionId: string): Promise<unknown | undefined>;
   createSession(config: SessionConfig): Promise<CopilotSessionLike>;
   resumeSession(sessionId: string, config: Omit<SessionConfig, 'sessionId'>): Promise<CopilotSessionLike>;
}

export type CopilotClientFactory = (options: CopilotClientOptions) => CopilotClientLike;

interface NormalizationState {
   thinkingChars: number;
}

export interface CopilotAdapterOptions {
   principalIsolation?: RuntimePrincipalIsolation;
   /** Hard wall-clock ceiling. Injected at a tiny value by adapter tests. */
   deadlineMs?: number;
}

const DEFAULT_DEADLINE_MS = 2 * 60 * 60 * 1000;
const CHECKPOINT_GRACE_MS = 60_000;

/**
 * GitHub Copilot as an agent process, not a text-generation provider.
 *
 * The SDK starts its pinned headless runtime over stdio. `mode: empty` removes
 * ambient host tools and credentials; every session receives one user's OAuth
 * token and only the tools Berry admitted for that run.
 */
export class CopilotAgentAdapter implements AgentProcessAdapter {
   readonly identity = {
      id: 'github-copilot',
      name: 'GitHub Copilot',
      kind: 'agent_process' as const,
      provider: 'GitHub Copilot model service',
      billing: 'subscription' as const,
      capabilities: {
         modelDiscovery: true,
         streaming: true,
         tools: true,
         sessions: true,
         cancellation: true,
         usage: true,
      },
   };

   readonly #factory: CopilotClientFactory;
   readonly #principalIsolation: RuntimePrincipalIsolation;
   readonly #deadlineMs: number;
   readonly #active = new Map<string, CopilotSessionLike>();

   constructor(
      factory: CopilotClientFactory = (options) => new CopilotClient(options) as CopilotSessionClient,
      options: CopilotAdapterOptions = {}
   ) {
      this.#factory = factory;
      this.#principalIsolation = options.principalIsolation ?? 'agentcore_session';
      this.#deadlineMs = options.deadlineMs ?? DEFAULT_DEADLINE_MS;
   }

   async checkAvailability(): Promise<RuntimeAvailability> {
      if (this.#principalIsolation === 'shared_process') {
         return {
            available: false,
            version: null,
            reason:
               'GitHub Copilot requires an AgentCore session or one dedicated container per runtime session.',
            protocolVersion: 1,
            principalIsolation: this.#principalIsolation,
         };
      }
      try {
         return await this.#withPrivateClient(null, async (client) => {
            const status = await client.getStatus();
            return {
               available: true,
               version: status.version,
               reason: null,
               protocolVersion: 1,
               principalIsolation: this.#principalIsolation,
            };
         });
      } catch (cause) {
         return {
            available: false,
            version: null,
            reason: safeError(cause, 'The bundled Copilot runtime could not start.'),
            protocolVersion: 1,
            principalIsolation: this.#principalIsolation,
         };
      }
   }

   async connectionStatus(credential: RuntimeCredential | null): Promise<RuntimeConnectionStatus> {
      if (!credential) return { status: 'missing', accountId: null, accountName: null, detail: 'Connect GitHub first.' };
      this.#assertIsolated();
      try {
         return await this.#withPrivateClient(credential, async (client) => {
            const status = await client.getAuthStatus();
            return {
               status: status.isAuthenticated ? 'connected' : 'expired',
               accountId: credential.accountId,
               accountName: status.login ?? credential.accountName,
               detail: status.statusMessage ?? null,
            };
         });
      } catch (cause) {
         if (cause instanceof RuntimeAdapterError) throw cause;
         return {
            status: 'error',
            accountId: credential.accountId,
            accountName: credential.accountName,
            detail: 'GitHub Copilot could not verify this account.',
         };
      }
   }

   async disconnect(): Promise<void> {
      await Promise.all([...this.#active.values()].map((session) => session.abort().catch(() => undefined)));
   }

   async discoverModels(credential: RuntimeCredential): Promise<RuntimeModel[]> {
      this.#assertIsolated();
      try {
         return await this.#withPrivateClient(credential, async (client) =>
            (await client.listModels())
               .filter((model) => model.policy?.state !== 'disabled')
               .map(toRuntimeModel)
         );
      } catch (cause) {
         if (cause instanceof RuntimeAdapterError) throw cause;
         throw classifyCopilotFailure(cause, null, false);
      }
   }

   #assertIsolated(): void {
      if (this.#principalIsolation === 'shared_process') {
         throw new RuntimeAdapterError(
            'RUNTIME_ISOLATION_REQUIRED',
            'GitHub Copilot requires an AgentCore session or one dedicated container per runtime session.',
            false
         );
      }
   }

   async #withPrivateClient<T>(
      credential: RuntimeCredential | null,
      operation: (client: CopilotClientLike) => Promise<T>
   ): Promise<T> {
      const directory = await mkdtemp(join(tmpdir(), 'berry-copilot-'));
      await chmod(directory, 0o700);
      let client: CopilotClientLike | null = null;
      try {
         client = this.#factory({
            ...this.#clientOptions(directory),
            ...(credential ? { gitHubToken: credential.token } : {}),
         });
         await client.start();
         return await operation(client);
      } finally {
         if (client) await stopClient(client);
         await rm(directory, { recursive: true, force: true });
      }
   }

   start(input: AgentProcessRun): Promise<AgentProcessResult> {
      return this.#run(input, false);
   }

   resume(input: AgentProcessRun & { sessionId: string }): Promise<AgentProcessResult> {
      return this.#run(input, true);
   }

   async cancel(sessionId: string): Promise<void> {
      await this.#active.get(sessionId)?.abort();
   }

   async #run(input: AgentProcessRun, preferResume: boolean): Promise<AgentProcessResult> {
      const runtime = input.envelope.runtime;
      if (!runtime || runtime.id !== this.identity.id || runtime.model === null) {
         throw new RuntimeAdapterError('RUNTIME_PROTOCOL', 'The Copilot task envelope is incomplete.', false);
      }
      this.#assertIsolated();
      await mkdir(input.stateDirectory, { recursive: true, mode: 0o700 });
      await chmod(input.stateDirectory, 0o700);
      const client = this.#factory(this.#clientOptions(input.stateDirectory));
      const normalization: NormalizationState = { thinkingChars: 0 };
      let lastError: Extract<SessionEvent, { type: 'session.error' }>['data'] | null = null;
      let session: CopilotSessionLike | null = null;
      let rootTurns = 0;
      let rootOutputTokens = 0;
      let rejectLimit!: (reason: RuntimeAdapterError) => void;
      let limitError: RuntimeAdapterError | null = null;
      const limitReached = new Promise<never>((_resolve, reject) => {
         rejectLimit = reject;
      });
      const tripLimit = (message: string): void => {
         if (limitError) return;
         const failure = new RuntimeAdapterError('RUNTIME_LIMIT_REACHED', message, false);
         limitError = failure;
         rejectLimit(failure);
         void session?.abort().catch(() => undefined);
      };
      const onEvent = (event: SessionEvent): void => {
         if (event.type === 'session.error') lastError = event.data;
         // Emit usage before a ceiling stops the provider so billing evidence is retained.
         for (const normalized of normalizeCopilotEvent(event, normalization)) input.emit(normalized);
         if (event.agentId) return;
         if (event.type === 'assistant.turn_start') {
            rootTurns += 1;
            const maximum = input.envelope.agent.maxTurns;
            if (maximum && rootTurns > maximum) {
               tripLimit(
                  `GitHub Copilot reached this agent's ${maximum}-step limit. Raise the step limit or split the task into smaller work.`
               );
            }
         }
         if (event.type === 'assistant.usage') {
            rootOutputTokens += event.data.outputTokens ?? 0;
            const maximum = input.envelope.agent.maxOutputTokens;
            if (maximum && rootOutputTokens >= maximum) {
               tripLimit(
                  `GitHub Copilot reached this agent's ${maximum}-token output limit. Raise the output limit or split the task into smaller work.`
               );
            }
         }
      };
      const tools = input.tools.map((tool) => toCopilotTool(tool, input.workingDirectory, input.signal));
      const sessionConfig: SessionConfig = {
         sessionId: input.envelope.runtimeSessionId,
         model: runtime.model,
         allowedModels: [runtime.model],
         workingDirectory: input.workingDirectory,
         gitHubToken: input.credential.token,
         streaming: true,
         tools,
         availableTools: ['custom:*'],
         excludedTools: ['builtin:*', 'mcp:*'],
         systemMessage: { mode: 'append', content: input.envelope.agent.instructions },
         onPermissionRequest: denyUnregisteredPermission,
         onEvent,
         enableConfigDiscovery: false,
         skipCustomInstructions: false,
         enableHostGitOperations: false,
         enableSessionStore: false,
         enableSkills: false,
         skipEmbeddingRetrieval: true,
         embeddingCacheStorage: 'in-memory',
         mcpOAuthTokenStorage: 'in-memory',
         remoteSession: 'off',
         enableSessionTelemetry: true,
         infiniteSessions: { enabled: false },
      };

      const abort = () => void session?.abort().catch(() => undefined);
      let deadline: ReturnType<typeof setTimeout> | null = null;
      try {
         await client.start();
         const saved = preferResume || (await client.getSessionMetadata(input.envelope.runtimeSessionId)) !== undefined;
         session = saved
            ? await client.resumeSession(input.envelope.runtimeSessionId, withoutSessionId(sessionConfig))
            : await client.createSession(sessionConfig);
         this.#active.set(session.sessionId, session);
         input.signal.addEventListener('abort', abort, { once: true });
         input.signal.throwIfAborted();
         deadline = setTimeout(() => {
            tripLimit(
               `GitHub Copilot reached Berry's ${durationLabel(this.#deadlineMs)} runtime limit. Split the task into smaller work.`
            );
         }, this.#deadlineMs);
         deadline.unref();
         const coldContext = saved ? '' : transcriptContext(input.envelope.transcript);
         const response = await Promise.race([
            session.sendAndWait(
               { prompt: coldContext + input.envelope.task.prompt },
               this.#deadlineMs + CHECKPOINT_GRACE_MS
            ),
            limitReached,
         ]);
         if (input.signal.aborted) {
            throw new RuntimeAdapterError('RUNTIME_CANCELLED', 'The Copilot run was cancelled.', false);
         }
         if (lastError !== null) throw classifyCopilotFailure(null, lastError, false);
         return { text: response?.data.content ?? '', sessionId: session.sessionId };
      } catch (cause) {
         if (cause instanceof RuntimeAdapterError) throw cause;
         throw classifyCopilotFailure(cause, lastError, input.signal.aborted);
      } finally {
         if (deadline) clearTimeout(deadline);
         input.signal.removeEventListener('abort', abort);
         if (session) {
            this.#active.delete(session.sessionId);
            await session.disconnect().catch(() => undefined);
         }
         await stopClient(client);
      }
   }

   #clientOptions(stateDirectory: string): CopilotClientOptions {
      return {
         mode: 'empty',
         baseDirectory: stateDirectory,
         useLoggedInUser: false,
         logLevel: 'error',
         sessionIdleTimeoutSeconds: 900,
         enableRemoteSessions: false,
         env: safeChildEnvironment(stateDirectory),
         clientInfo: {
            applicationName: 'berry',
            applicationVersion: '0.1.0',
            integrationName: 'subscription-runtime',
         },
      };
   }
}

type CopilotSessionClient = CopilotClient & {
   createSession(config: SessionConfig): Promise<CopilotSession>;
   resumeSession(sessionId: string, config: Omit<SessionConfig, 'sessionId'>): Promise<CopilotSession>;
};

function withoutSessionId(config: SessionConfig): Omit<SessionConfig, 'sessionId'> {
   const { sessionId: _sessionId, ...rest } = config;
   return rest;
}

function safeChildEnvironment(home: string): Record<string, string> {
   const allowed = ['PATH', 'LANG', 'LC_ALL', 'SSL_CERT_FILE', 'SSL_CERT_DIR', 'NODE_EXTRA_CA_CERTS'] as const;
   return {
      HOME: home,
      TMPDIR: home,
      XDG_CONFIG_HOME: home,
      XDG_CACHE_HOME: home,
      XDG_DATA_HOME: home,
      ...Object.fromEntries(
         allowed.flatMap((name) => {
            const value = process.env[name];
            return value ? [[name, value]] : [];
         })
      ),
   };
}

function durationLabel(milliseconds: number): string {
   const minutes = Math.max(1, Math.round(milliseconds / 60_000));
   return minutes % 60 === 0
      ? `${minutes / 60}-hour`
      : `${minutes}-minute`;
}

function transcriptContext(messages: AgentProcessRun['envelope']['transcript']): string {
   if (messages.length === 0) return '';
   const transcript = messages
      .map((message) => `${message.role === 'user' ? 'Person' : 'Agent'}: ${message.text}`)
      .join('\n');
   return `Conversation restored by Berry before this turn:\n<transcript>\n${transcript}\n</transcript>\n\n`;
}

function toRuntimeModel(model: ModelInfo): RuntimeModel {
   return {
      id: model.id,
      name: model.name,
      reasoning: model.capabilities.supports.reasoningEffort,
      tools: null,
      policy: model.policy?.state ?? null,
   };
}

function toCopilotTool(tool: Tool, workingDirectory: string, signal: AbortSignal): CopilotTool {
   return {
      name: tool.name,
      description: tool.description,
      parameters: (tool.toolSpec.inputSchema ?? { type: 'object', properties: {} }) as Record<string, unknown>,
      skipPermission: true,
      defer: 'never',
      handler: async (input, invocation) => {
         const cancelSignal = invocation.signal
            ? AbortSignal.any([signal, invocation.signal])
            : signal;
         const context = {
            toolUse: { name: tool.name, toolUseId: invocation.toolCallId, input },
            agent: { appState: new Map([[WORKDIR_KEY, workingDirectory]]) },
            invocationState: new Map<string, unknown>(),
            cancelSignal,
         } as unknown as ToolContext;
         return invokeStrandsTool(tool, input, context);
      },
   };
}

async function invokeStrandsTool(tool: Tool, input: unknown, context: ToolContext): Promise<unknown> {
   const candidate = tool as unknown as { invoke?: (value: unknown, toolContext: ToolContext) => Promise<unknown> };
   if (typeof candidate.invoke === 'function') return candidate.invoke(input, context);
   const stream = tool.stream(context);
   let next = await stream.next();
   while (!next.done) next = await stream.next();
   return next.value;
}

const denyUnregisteredPermission = (): PermissionRequestResult => ({
   kind: 'denied-interactively-by-user',
});

/** Provider events normalized into Berry's stable lifecycle vocabulary. */
export function normalizeCopilotEvent(
   event: SessionEvent,
   state: NormalizationState = { thinkingChars: 0 }
): LifecycleEvent[] {
   if (event.agentId) return [];
   switch (event.type) {
      case 'assistant.message_delta':
         return event.data.deltaContent
            ? [{ type: 'task.message', message: { kind: 'output', channel: 'assistant', text: event.data.deltaContent } }]
            : [];
      case 'assistant.reasoning_delta':
         state.thinkingChars += event.data.deltaContent.length;
         return event.data.deltaContent
            ? [{
                 type: 'task.message',
                 message: { kind: 'thinking', chars: state.thinkingChars, text: event.data.deltaContent },
              }]
            : [];
      case 'tool.execution_start':
         return [{
            type: 'task.message',
            message: { kind: 'tool.started', toolCallId: event.data.toolCallId, name: event.data.toolName },
         }];
      case 'tool.execution_complete':
         return [{
            type: 'task.message',
            message: {
               kind: 'tool.completed',
               toolCallId: event.data.toolCallId,
               succeeded: event.data.success,
               durationMs: 0,
            },
         }];
      case 'assistant.usage':
         return [{
            type: 'task.usage',
            usage: {
               eventId: event.data.accounting?.usageId ?? event.data.apiCallId ?? event.id,
               model: event.data.model,
               inputTokens: event.data.inputTokens ?? 0,
               outputTokens: event.data.outputTokens ?? 0,
               cacheReadTokens: event.data.cacheReadTokens ?? 0,
               cacheWriteTokens: event.data.cacheWriteTokens ?? 0,
               // Subscription usage has no USD price. Explicit null prevents
               // the control plane from applying its Bedrock price book.
               reportedCostMicros: null,
            },
         }];
      default:
         return [];
   }
}

function classifyCopilotFailure(
   cause: unknown,
   reported: Extract<SessionEvent, { type: 'session.error' }>['data'] | null,
   cancelled: boolean
): RuntimeAdapterError {
   if (cancelled) return new RuntimeAdapterError('RUNTIME_CANCELLED', 'The Copilot run was cancelled.', false);
   if (reported?.errorType === 'authentication' || reported?.statusCode === 401) {
      return new RuntimeAdapterError(
         'AUTH_EXPIRED',
         'GitHub Copilot could not authenticate this account. Reconnect it in AI Runtimes settings.',
         false
      );
   }
   if (reported?.errorType === 'quota' || reported?.errorType === 'rate_limit') {
      return new RuntimeAdapterError(
         'QUOTA_EXHAUSTED',
         'This GitHub Copilot subscription has reached its current usage limit. Check the account limit and reset time before retrying.',
         false
      );
   }
   if (reported?.errorType === 'model') {
      return new RuntimeAdapterError(
         'MODEL_UNAVAILABLE',
         'The selected GitHub Copilot model is unavailable for this account. Choose Automatic or another listed model.',
         false
      );
   }
   const text = cause instanceof Error ? cause.message.toLowerCase() : '';
   if (text.includes('timed out') || text.includes('timeout')) {
      return new RuntimeAdapterError('RUNTIME_TIMEOUT', 'GitHub Copilot did not finish before the runtime timeout.', true);
   }
   if (text.includes('enoent') || text.includes('not found')) {
      return new RuntimeAdapterError('RUNTIME_NOT_INSTALLED', 'The GitHub Copilot runtime is not installed in this image.', false);
   }
   if (text.includes('network') || text.includes('connect') || text.includes('socket')) {
      return new RuntimeAdapterError('NETWORK_ERROR', 'GitHub Copilot could not be reached. Check runtime egress and retry.', true);
   }
   return new RuntimeAdapterError(
      'RUNTIME_ERROR',
      'GitHub Copilot could not complete the task. Check the runtime logs for a credential-redacted diagnostic.',
      true
   );
}

async function stopClient(client: CopilotClientLike): Promise<void> {
   try {
      const errors = await client.stop();
      if (errors.length > 0) await client.forceStop();
   } catch {
      await client.forceStop().catch(() => undefined);
   }
}

function safeError(cause: unknown, fallback: string): string {
   if (!(cause instanceof Error)) return fallback;
   const message = cause.message.trim();
   return message === '' ? fallback : message.slice(0, 400);
}
