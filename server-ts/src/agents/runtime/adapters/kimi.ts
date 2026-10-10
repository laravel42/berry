import { randomBytes } from 'node:crypto';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { KIMI_CLI_LOGIN } from '../../../runtime/envelope.ts';
import type { LifecycleEvent } from '../../../runtime/lifecycle.ts';
import { classifyKimiText, KimiAcpClient, spawnKimiProcess, type KimiChild, type KimiSpawn } from './kimi-acp.ts';
import { BerryMcpHost } from './kiro-mcp.ts';
import {
   RuntimeAdapterError,
   type AgentProcessAdapter,
   type AgentProcessResult,
   type AgentProcessRun,
   type RuntimeAvailability,
   type RuntimeConnectionStatus,
   type RuntimeCredential,
   type RuntimeModel,
   type RuntimePrincipalIsolation,
} from './types.ts';

export type KimiLauncher = (spec: KimiSpawn) => KimiChild;

const DEFAULT_DEADLINE_MS = 2 * 60 * 60 * 1000;
const HANDSHAKE_MS = 20_000;
const BRIDGE = fileURLToPath(new URL('./kiro-mcp-bridge.ts', import.meta.url));

export interface KimiAdapterOptions {
   command?: string;
   principalIsolation?: RuntimePrincipalIsolation;
   deadlineMs?: number;
   launcher?: KimiLauncher;
}

interface NormalizationState {
   thinkingChars: number;
   started: Set<string>;
}

/**
 * Moonshot Kimi Code CLI as a process on the user's workstation.
 *
 * The CLI keeps its own Kimi Code login (`kimi` then `/login`). Berry starts
 * `kimi acp`, forwards no API key, and never answers an auth-token callback —
 * the CLI authenticates itself. Native shell and file tools are denied; Berry
 * tools are the only MCP server the process may call.
 */
export class KimiAgentAdapter implements AgentProcessAdapter {
   readonly identity = {
      id: 'kimi',
      name: 'Kimi',
      kind: 'agent_process' as const,
      provider: 'Kimi Code model service',
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

   readonly #command: string;
   readonly #launch: KimiLauncher;
   readonly #principalIsolation: RuntimePrincipalIsolation;
   readonly #deadlineMs: number;
   readonly #active = new Map<string, KimiAcpClient>();

   constructor(options: KimiAdapterOptions = {}) {
      this.#command = options.command ?? 'kimi';
      this.#launch = options.launcher ?? spawnKimiProcess;
      this.#principalIsolation = options.principalIsolation ?? 'workstation';
      this.#deadlineMs = options.deadlineMs ?? DEFAULT_DEADLINE_MS;
   }

   async checkAvailability(): Promise<RuntimeAvailability> {
      if (this.#principalIsolation === 'shared_process') return this.#isolatedAvailability();
      const home = await mkdtemp(join(tmpdir(), 'berry-kimi-'));
      await chmod(home, 0o700);
      const child = this.#launch({
         command: this.#command,
         args: ['--version'],
         cwd: home,
         env: childEnvironment(home),
      });
      let version = '';
      const read = (async () => {
         for await (const line of child.lines()) {
            if (version === '' && line.trim() !== '') version = line.trim();
         }
      })().catch(() => undefined);
      const exit = await child.exited;
      await read;
      await rm(home, { recursive: true, force: true });
      if (exit.error && (exit.error as NodeJS.ErrnoException).code === 'ENOENT') return this.#missing();
      if (exit.code !== 0 && version === '') return this.#missing();
      return {
         available: true,
         version: version.slice(0, 80) || 'kimi',
         reason: null,
         protocolVersion: 1,
         principalIsolation: this.#principalIsolation,
      };
   }

   async connectionStatus(credential: RuntimeCredential | null): Promise<RuntimeConnectionStatus> {
      this.#assertLogin(credential);
      try {
         const models = await this.discoverModels(credential);
         if (models.length === 0) {
            return {
               status: 'missing',
               accountId: null,
               accountName: null,
               detail: 'Run `kimi` and `/login` with a Kimi Code account on this workstation, then connect again.',
            };
         }
         return { status: 'connected', accountId: null, accountName: 'Kimi Code', detail: null };
      } catch (cause) {
         if (
            cause instanceof RuntimeAdapterError &&
            (cause.code === 'RUNTIME_NOT_INSTALLED' || cause.code === 'RUNTIME_ISOLATION_REQUIRED')
         ) {
            throw cause;
         }
         if (cause instanceof RuntimeAdapterError && (cause.code === 'AUTH_REQUIRED' || cause.code === 'AUTH_EXPIRED')) {
            return {
               status: 'missing',
               accountId: null,
               accountName: null,
               detail: cause.message,
            };
         }
         return {
            status: 'error',
            accountId: credential?.accountId ?? null,
            accountName: credential?.accountName ?? null,
            detail: cause instanceof Error ? cause.message : 'Kimi CLI could not report its login.',
         };
      }
   }

   async disconnect(): Promise<void> {
      await Promise.all([...this.#active.values()].map((client) => client.close()));
   }

   async discoverModels(credential: RuntimeCredential): Promise<RuntimeModel[]> {
      this.#assertLogin(credential);
      this.#assertIsolated();
      const home = await mkdtemp(join(tmpdir(), 'berry-kimi-models-'));
      await chmod(home, 0o700);
      try {
         return await this.#withClient(home, async (client) => {
            await client.request('initialize', initializeParams(), HANDSHAKE_MS);
            const created = await client.request('session/new', { cwd: home, mcpServers: [] }, HANDSHAKE_MS);
            return modelsFromSession(created);
         });
      } finally {
         await rm(home, { recursive: true, force: true });
      }
   }

   start(input: AgentProcessRun): Promise<AgentProcessResult> {
      return this.#run(input);
   }

   resume(input: AgentProcessRun & { sessionId: string }): Promise<AgentProcessResult> {
      return this.#run(input);
   }

   async cancel(sessionId: string): Promise<void> {
      const client = this.#active.get(sessionId);
      client?.notify('session/cancel', { sessionId });
      await client?.close();
   }

   async #run(input: AgentProcessRun): Promise<AgentProcessResult> {
      const runtime = input.envelope.runtime;
      if (!runtime || runtime.id !== this.identity.id || runtime.model === null) {
         throw new RuntimeAdapterError('RUNTIME_PROTOCOL', 'The Kimi task envelope is incomplete.', false);
      }
      const model = runtime.model;
      this.#assertLogin(input.credential);
      this.#assertIsolated();
      await mkdir(input.stateDirectory, { recursive: true, mode: 0o700 });
      await chmod(input.stateDirectory, 0o700);
      const allowed = new Set(input.tools.map((tool) => tool.name));
      const normalization: NormalizationState = { thinkingChars: 0, started: new Set() };
      let pendingUsage: LifecycleEvent | null = null;
      const handlers = {
         onUpdate: (params: unknown): void => {
            const streamed = kimiUsageEvent(params, model);
            if (streamed) pendingUsage = streamed;
            for (const event of normalizeKimiUpdate(params, normalization)) input.emit(event);
         },
         onPermission: (params: unknown) => selectKimiPermission(params, allowed),
      };
      const socketPath = kimiMcpSocketPath();
      const host = new BerryMcpHost(socketPath, input.tools, input.workingDirectory, input.signal);
      await host.listen();
      const client = await this.#open(input.workingDirectory, handlers);
      let sessionId = '';
      let timedOut = false;
      const abort = () => {
         if (sessionId !== '') client.notify('session/cancel', { sessionId });
         void client.close();
      };
      let deadline: ReturnType<typeof setTimeout> | null = null;
      try {
         await client.request('initialize', initializeParams(), HANDSHAKE_MS);
         const mcpServers = [berryMcpServer(socketPath)];
         const saved = await readSessionId(input.stateDirectory);
         const loaded = saved
            ? await client
                 .request('session/load', { sessionId: saved, cwd: input.workingDirectory, mcpServers }, HANDSHAKE_MS)
                 .catch(() => null)
            : null;
         const pinModel = model !== 'default';
         const session =
            loaded ??
            (await client.request(
               'session/new',
               { cwd: input.workingDirectory, mcpServers },
               HANDSHAKE_MS
            ));
         sessionId = (loaded ? saved : sessionIdOf(session)) ?? '';
         if (sessionId === '') {
            throw new RuntimeAdapterError('RUNTIME_PROTOCOL', 'Kimi CLI did not return a session id.', false);
         }
         await writeFile(join(input.stateDirectory, 'session-id'), sessionId, { mode: 0o600 });
         this.#active.set(sessionId, client);
         if (pinModel) {
            await client
               .request('session/set_config_option', { sessionId, configId: 'model', value: model }, HANDSHAKE_MS)
               .catch((cause: unknown) => {
                  if (cause instanceof RuntimeAdapterError && cause.code === 'RUNTIME_PROTOCOL') return;
                  throw cause;
               });
         }
         input.signal.addEventListener('abort', abort, { once: true });
         input.signal.throwIfAborted();
         deadline = setTimeout(() => {
            timedOut = true;
            abort();
         }, this.#deadlineMs);
         deadline.unref?.();
         const cold = loaded ? '' : promptContext(input);
         const result = await client.request(
            'session/prompt',
            { sessionId, prompt: [{ type: 'text', text: `${cold}${input.envelope.task.prompt}` }] },
            this.#deadlineMs
         );
         const reported = kimiUsageEvent(result, model) ?? pendingUsage;
         if (reported) input.emit(reported);
         if (input.signal.aborted) {
            throw new RuntimeAdapterError('RUNTIME_CANCELLED', 'The Kimi run was cancelled.', false);
         }
         const stop = stopReason(result);
         if (stop === 'cancelled') {
            throw new RuntimeAdapterError('RUNTIME_CANCELLED', 'The Kimi run was cancelled.', false);
         }
         if (stop === 'refusal') {
            throw new RuntimeAdapterError('RUNTIME_ERROR', 'Kimi refused to complete this turn.', false);
         }
         if (stop === 'max_tokens' || stop === 'max_turn_requests') {
            throw new RuntimeAdapterError(
               'RUNTIME_LIMIT_REACHED',
               'Kimi reached its turn limit. Raise the agent limit or split the task into smaller work.',
               false
            );
         }
         return { text: textOf(normalization), sessionId };
      } catch (cause) {
         if (timedOut) {
            throw new RuntimeAdapterError(
               'RUNTIME_LIMIT_REACHED',
               "Kimi reached Berry's runtime limit. Split the task into smaller work.",
               false
            );
         }
         if (cause instanceof RuntimeAdapterError) throw cause;
         throw classifyKimiText(cause instanceof Error ? cause.message : 'Kimi CLI failed.');
      } finally {
         if (deadline) clearTimeout(deadline);
         input.signal.removeEventListener('abort', abort);
         if (sessionId !== '') this.#active.delete(sessionId);
         await client.close();
         await host.close();
      }
   }

   async #withClient<T>(home: string, operation: (client: KimiAcpClient) => Promise<T>): Promise<T> {
      const client = await this.#open(home);
      try {
         return await operation(client);
      } finally {
         await client.close();
      }
   }

   async #open(
      cwd: string,
      handlers: { onUpdate: (params: unknown) => void; onPermission: (params: unknown) => unknown } = {
         onUpdate: () => undefined,
         onPermission: (params) => selectKimiPermission(params, new Set()),
      }
   ): Promise<KimiAcpClient> {
      const child = this.#launch({
         command: this.#command,
         args: ['acp'],
         cwd,
         env: childEnvironment(cwd),
      });
      const client = new KimiAcpClient(child, handlers);
      client.start();
      return client;
   }

   #assertLogin(credential: RuntimeCredential | null): asserts credential is RuntimeCredential {
      if (!credential || credential.type !== 'oauth' || credential.token !== KIMI_CLI_LOGIN) {
         throw new RuntimeAdapterError(
            'AUTH_REQUIRED',
            'Connect Kimi in AI Runtimes. Berry uses the Kimi Code CLI login on this workstation.',
            false
         );
      }
   }

   #assertIsolated(): void {
      if (this.#principalIsolation === 'shared_process') {
         throw new RuntimeAdapterError(
            'RUNTIME_ISOLATION_REQUIRED',
            'Kimi runs as its own process on the user workstation.',
            false
         );
      }
   }

   #isolatedAvailability(): RuntimeAvailability {
      return {
         available: false,
         version: null,
         reason: 'Kimi runs as its own process on the user workstation.',
         protocolVersion: 1,
         principalIsolation: this.#principalIsolation,
      };
   }

   #missing(): RuntimeAvailability {
      return {
         available: false,
         version: null,
         reason: 'kimi is not installed on this workstation.',
         protocolVersion: 1,
         principalIsolation: this.#principalIsolation,
      };
   }
}

/**
 * macOS `sockaddr_un.sun_path` is 104 bytes including the trailing NUL, so a
 * socket under the session directory is truncated. `/tmp` keeps it short.
 */
export function kimiMcpSocketPath(): string {
   const path = join(process.platform === 'win32' ? tmpdir() : '/tmp', `berry-mcp-${randomBytes(8).toString('hex')}.sock`);
   if (Buffer.byteLength(path) > 103) {
      throw new RuntimeAdapterError('RUNTIME_ERROR', 'The Kimi tool socket path is too long for this operating system.', false);
   }
   return path;
}

function initializeParams(): unknown {
   return {
      protocolVersion: 1,
      clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
      clientInfo: { name: 'berry', version: '0.1.0' },
   };
}

function berryMcpServer(socketPath: string): unknown {
   return {
      name: 'berry',
      command: process.execPath,
      args: ['--experimental-strip-types', BRIDGE, socketPath],
      env: [],
   };
}

/**
 * The run inherits only safe, non-secret variables. No API key is set: the
 * Kimi CLI reads its own login from its own store.
 */
function childEnvironment(home: string): Record<string, string> {
   const allowed = ['PATH', 'HOME', 'USER', 'LOGNAME', 'SHELL', 'LANG', 'LC_ALL', 'LC_CTYPE', 'SSL_CERT_FILE', 'SSL_CERT_DIR', 'NODE_EXTRA_CA_CERTS'] as const;
   const env: Record<string, string> = { TMPDIR: home };
   for (const name of allowed) {
      const value = process.env[name];
      if (value) env[name] = value;
   }
   return env;
}

async function readSessionId(directory: string): Promise<string | null> {
   try {
      const text = (await readFile(join(directory, 'session-id'), 'utf8')).trim();
      return /^[A-Za-z0-9_-]{1,200}$/.test(text) ? text : null;
   } catch {
      return null;
   }
}

function sessionIdOf(value: unknown): string | null {
   if (!value || typeof value !== 'object') return null;
   const id = (value as { sessionId?: unknown }).sessionId;
   return typeof id === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(id) ? id : null;
}

export function modelsFromSession(value: unknown): RuntimeModel[] {
   if (!value || typeof value !== 'object') return [];
   const options = (value as { configOptions?: unknown }).configOptions;
   if (!Array.isArray(options)) return [];
   const model = options.find(
      (option) => option && typeof option === 'object' && (option as { id?: unknown }).id === 'model'
   ) as { options?: unknown } | undefined;
   if (!model || !Array.isArray(model.options)) return [];
   return model.options.flatMap((option) => {
      if (!option || typeof option !== 'object') return [];
      const id = (option as { value?: unknown }).value;
      const name = (option as { name?: unknown }).name;
      if (typeof id !== 'string' || id === '') return [];
      return [{ id, name: typeof name === 'string' && name !== '' ? name : id, reasoning: null, tools: true, policy: null }];
   });
}

function stopReason(value: unknown): string | null {
   if (!value || typeof value !== 'object') return null;
   const reason = (value as { stopReason?: unknown }).stopReason;
   return typeof reason === 'string' ? reason : null;
}

/** One usage report for the turn; the last report wins. A credit total is not a token count. */
export function kimiUsageEvent(payload: unknown, model: string): LifecycleEvent | null {
   for (const source of usageSources(payload)) {
      const event = usageFrom(source, model);
      if (event) return event;
   }
   return null;
}

function usageSources(payload: unknown): Record<string, unknown>[] {
   if (!payload || typeof payload !== 'object') return [];
   const record = payload as Record<string, unknown>;
   const update = record.update && typeof record.update === 'object' ? (record.update as Record<string, unknown>) : null;
   return [record.usage, update?.usage, update, record].filter(
      (value): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)
   );
}

function usageFrom(source: Record<string, unknown>, model: string): LifecycleEvent | null {
   const whole = (value: unknown): number =>
      typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
   const pick = (...keys: string[]): number => {
      for (const key of keys) {
         if (source[key] !== undefined) return whole(source[key]);
      }
      return 0;
   };
   const input = pick('inputTokens', 'input_tokens', 'promptTokens', 'prompt_tokens');
   const output = pick('outputTokens', 'output_tokens', 'completionTokens', 'completion_tokens');
   const cacheRead = pick('cachedReadTokens', 'cacheReadTokens', 'cache_read_tokens', 'cachedInputTokens', 'cached_input_tokens');
   const cacheWrite = pick('cachedWriteTokens', 'cacheWriteTokens', 'cache_write_tokens');
   const total = pick('totalTokens', 'total_tokens');
   let inputTokens = input;
   if (inputTokens === 0 && output === 0 && cacheRead === 0 && cacheWrite === 0 && total > 0) inputTokens = total;
   if (inputTokens + output + cacheRead + cacheWrite === 0) return null;
   const named = typeof source.modelId === 'string' && source.modelId.trim() !== '' ? source.modelId.trim() : model;
   return usageEvent(named, inputTokens, output, cacheRead, cacheWrite);
}

function usageEvent(
   model: string,
   inputTokens: number,
   outputTokens: number,
   cacheReadTokens: number,
   cacheWriteTokens: number
): LifecycleEvent {
   const named = model.trim();
   return {
      type: 'task.usage',
      usage: {
         eventId: 'kimi-prompt',
         model: named || 'kimi',
         inputTokens,
         outputTokens,
         cacheReadTokens,
         cacheWriteTokens,
         reportedCostMicros: null,
      },
   };
}

const stateText = new WeakMap<NormalizationState, string>();

function rememberText(state: NormalizationState, text: string): void {
   stateText.set(state, `${stateText.get(state) ?? ''}${text}`);
}

function textOf(state: NormalizationState): string {
   return stateText.get(state) ?? '';
}

export function selectKimiPermission(
   params: unknown,
   allowed: ReadonlySet<string>
): { outcome: { outcome: 'selected'; optionId: string } } {
   const options = permissionOptions(params);
   const toolName = berryToolName(params);
   const permit = toolName !== null && allowed.has(toolName);
   const kind = permit ? 'allow_once' : 'reject_once';
   const chosen =
      options.find((option) => option.kind === kind) ??
      options.find((option) => option.kind.includes(permit ? 'allow_once' : 'reject'));
   const optionId = chosen?.optionId ?? options.find((option) => option.kind.includes('reject'))?.optionId ?? 'reject';
   return { outcome: { outcome: 'selected', optionId } };
}

function permissionOptions(params: unknown): Array<{ optionId: string; kind: string }> {
   if (!params || typeof params !== 'object') return [];
   const options = (params as { options?: unknown }).options;
   if (!Array.isArray(options)) return [];
   return options.flatMap((option) => {
      if (!option || typeof option !== 'object') return [];
      const optionId = (option as { optionId?: unknown }).optionId;
      const kind = (option as { kind?: unknown }).kind;
      if (typeof optionId !== 'string' || typeof kind !== 'string') return [];
      return [{ optionId, kind }];
   });
}

function berryToolName(params: unknown): string | null {
   if (!params || typeof params !== 'object') return null;
   const record = params as {
      toolCall?: { title?: unknown };
      _meta?: { mcpTool?: { identity?: { serverName?: unknown; toolName?: unknown } } };
   };
   const identity = record._meta?.mcpTool?.identity;
   if (identity && identity.serverName === 'berry' && typeof identity.toolName === 'string') return identity.toolName;
   const title = record.toolCall?.title;
   return typeof title === 'string' && title !== '' ? title : null;
}

function promptContext(input: AgentProcessRun): string {
   const transcript = input.envelope.transcript
      .map((message) => `${message.role === 'user' ? 'Person' : 'Agent'}: ${message.text}`)
      .join('\n');
   const restored =
      transcript === ''
         ? ''
         : `Conversation restored by Berry before this turn:\n<transcript>\n${transcript}\n</transcript>\n\n`;
   const instructions = input.envelope.agent.instructions.trim();
   return `${restored}${instructions === '' ? '' : `${instructions}\n\n`}`;
}

/** ACP session updates, skipping replay so a loaded session is not recorded twice. */
export function normalizeKimiUpdate(params: unknown, state: NormalizationState): LifecycleEvent[] {
   if (!params || typeof params !== 'object') return [];
   const update = (params as { update?: unknown }).update ?? params;
   if (!update || typeof update !== 'object') return [];
   const body = update as {
      sessionUpdate?: unknown;
      content?: { type?: unknown; text?: unknown } | Array<{ type?: unknown; text?: unknown }>;
      toolCallId?: unknown;
      title?: unknown;
      status?: unknown;
      _meta?: { replay?: unknown };
   };
   if (body._meta?.replay === true) return [];
   const kind = body.sessionUpdate;
   if (kind === 'agent_message_chunk') {
      const text = contentText(body.content);
      if (text === '') return [];
      rememberText(state, text);
      return [{ type: 'task.message', message: { kind: 'output', channel: 'assistant', text } }];
   }
   if (kind === 'agent_thought_chunk') {
      const text = contentText(body.content);
      state.thinkingChars += text.length;
      return text === '' ? [] : [{ type: 'task.message', message: { kind: 'thinking', chars: state.thinkingChars, text } }];
   }
   if (kind === 'tool_call' && typeof body.toolCallId === 'string' && !state.started.has(body.toolCallId)) {
      state.started.add(body.toolCallId);
      return [
         {
            type: 'task.message',
            message: {
               kind: 'tool.started',
               toolCallId: body.toolCallId,
               name: typeof body.title === 'string' && body.title !== '' ? body.title : 'tool',
            },
         },
      ];
   }
   if (kind === 'tool_call_update' && typeof body.toolCallId === 'string') {
      if (body.status !== 'completed' && body.status !== 'failed') return [];
      return [
         {
            type: 'task.message',
            message: { kind: 'tool.completed', toolCallId: body.toolCallId, succeeded: body.status === 'completed', durationMs: 0 },
         },
      ];
   }
   return [];
}

function contentText(
   content: { type?: unknown; text?: unknown } | Array<{ type?: unknown; text?: unknown }> | undefined
): string {
   if (Array.isArray(content)) return content.map((block) => contentText(block)).join('');
   if (!content || content.type !== 'text' || typeof content.text !== 'string') return '';
   return content.text;
}
