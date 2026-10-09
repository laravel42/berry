import { randomBytes } from 'node:crypto';
import { access, chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Tool } from '@strands-agents/sdk';
import { isKiroApiKey } from '../../../runtime/envelope.ts';
import type { LifecycleEvent } from '../../../runtime/lifecycle.ts';
import { KiroAcpClient, classifyKiroText, redactSecret, spawnKiroProcess, type KiroChild, type KiroSpawn } from './kiro-acp.ts';
import { BerryMcpHost } from './kiro-mcp.ts';
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

export type KiroLauncher = (spec: KiroSpawn) => KiroChild;

const DEFAULT_DEADLINE_MS = 2 * 60 * 60 * 1000;
const HANDSHAKE_MS = 20_000;
const BRIDGE = fileURLToPath(new URL('./kiro-mcp-bridge.ts', import.meta.url));

/**
 * macOS `sockaddr_un.sun_path` is 104 bytes, including the trailing NUL, so a
 * socket under the session directory is truncated and `listen` reports
 * EADDRINUSE. `/tmp` keeps the path well under that limit.
 */
export function kiroMcpSocketPath(): string {
   const path = join(process.platform === 'win32' ? tmpdir() : '/tmp', `berry-mcp-${randomBytes(8).toString('hex')}.sock`);
   if (Buffer.byteLength(path) > 103) {
      throw new RuntimeAdapterError('RUNTIME_ERROR', 'The Kiro tool socket path is too long for this operating system.', false);
   }
   return path;
}

export interface KiroAdapterOptions {
   command?: string;
   principalIsolation?: RuntimePrincipalIsolation;
   deadlineMs?: number;
   launcher?: KiroLauncher;
}

interface NormalizationState {
   thinkingChars: number;
   started: Set<string>;
}

/**
 * Kiro CLI V3 as a process on the user's workstation.
 *
 * Each run gets an empty home directory, so another person's `kiro-cli login`
 * cannot win authentication precedence. The subscription API key is passed
 * only as `KIRO_API_KEY` and as the answer to `_kiro/auth/getAccessToken`.
 * Native shell and file tools are denied. Berry tools are the MCP server Kiro
 * is allowed to call.
 */
export class KiroAgentAdapter implements AgentProcessAdapter {
   readonly identity = {
      id: 'kiro',
      name: 'Kiro',
      kind: 'agent_process' as const,
      provider: 'Kiro model service',
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
   readonly #launch: KiroLauncher;
   readonly #principalIsolation: RuntimePrincipalIsolation;
   readonly #deadlineMs: number;
   readonly #active = new Map<string, KiroAcpClient>();

   constructor(options: KiroAdapterOptions = {}) {
      this.#command = options.command ?? 'kiro-cli';
      this.#launch = options.launcher ?? spawnKiroProcess;
      this.#principalIsolation = options.principalIsolation ?? 'agentcore_session';
      this.#deadlineMs = options.deadlineMs ?? DEFAULT_DEADLINE_MS;
   }

   async checkAvailability(): Promise<RuntimeAvailability> {
      if (this.#principalIsolation === 'shared_process') return this.#isolatedAvailability();
      const home = await mkdtemp(join(tmpdir(), 'berry-kiro-'));
      await chmod(home, 0o700);
      await exposeKiroChat(home);
      const child = this.#launch({
         command: this.#command,
         args: ['--version'],
         cwd: home,
         env: childEnvironment(home, null),
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
      if (exit.error && (exit.error as NodeJS.ErrnoException).code === 'ENOENT') {
         return this.#missing();
      }
      if (exit.code !== 0 && version === '') return this.#missing();
      return {
         available: true,
         version: version.slice(0, 80) || 'kiro-cli',
         reason: null,
         protocolVersion: 1,
         principalIsolation: this.#principalIsolation,
      };
   }

   async connectionStatus(credential: RuntimeCredential | null): Promise<RuntimeConnectionStatus> {
      if (!credential) {
         return { status: 'missing', accountId: null, accountName: null, detail: 'Paste a Kiro API key first.' };
      }
      if (!usableKey(credential)) {
         return {
            status: 'error',
            accountId: credential.accountId,
            accountName: credential.accountName,
            detail: 'Kiro needs a subscription API key.',
         };
      }
      try {
         await this.discoverModels(credential);
         return {
            status: 'connected',
            accountId: credential.accountId,
            accountName: credential.accountName ?? 'Kiro subscription',
            detail: null,
         };
      } catch (cause) {
         if (
            cause instanceof RuntimeAdapterError &&
            (cause.code === 'RUNTIME_NOT_INSTALLED' || cause.code === 'RUNTIME_ISOLATION_REQUIRED')
         ) {
            throw cause;
         }
         if (cause instanceof RuntimeAdapterError && (cause.code === 'AUTH_EXPIRED' || cause.code === 'AUTH_REQUIRED')) {
            return {
               status: 'expired',
               accountId: credential.accountId,
               accountName: credential.accountName,
               detail: cause.message,
            };
         }
         return {
            status: 'error',
            accountId: credential.accountId,
            accountName: credential.accountName,
            detail: cause instanceof Error ? cause.message : 'Kiro could not verify this key.',
         };
      }
   }

   async disconnect(): Promise<void> {
      await Promise.all([...this.#active.values()].map((client) => client.close()));
   }

   async discoverModels(credential: RuntimeCredential): Promise<RuntimeModel[]> {
      this.#assertKey(credential);
      this.#assertIsolated();
      const home = await mkdtemp(join(tmpdir(), 'berry-kiro-'));
      await chmod(home, 0o700);
      try {
         return await this.#withClient(credential, home, async (client) => {
            await client.request('initialize', initializeParams(), HANDSHAKE_MS);
            const created = await client.request(
               'session/new',
               { cwd: home, mcpServers: [], _meta: { kiro: {} } },
               HANDSHAKE_MS
            );
            const models = modelsFromSession(created);
            return models;
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
         throw new RuntimeAdapterError('RUNTIME_PROTOCOL', 'The Kiro task envelope is incomplete.', false);
      }
      this.#assertKey(input.credential);
      this.#assertIsolated();
      await mkdir(input.stateDirectory, { recursive: true, mode: 0o700 });
      await chmod(input.stateDirectory, 0o700);
      await writePermissions(input.stateDirectory);
      const allowed = new Set(input.tools.map((tool) => tool.name));
      const normalization: NormalizationState = { thinkingChars: 0, started: new Set() };
      let pendingUsage: LifecycleEvent | null = null;
      const handlers = {
         onUpdate: (params: unknown): void => {
            const streamed = kiroUsageEvent(params, runtime.model);
            if (streamed) pendingUsage = streamed;
            for (const event of normalizeKiroUpdate(params, normalization)) input.emit(event);
         },
         onPermission: (params: unknown) => selectKiroPermission(params, allowed),
      };
      const socketPath = kiroMcpSocketPath();
      const host = new BerryMcpHost(socketPath, input.tools, input.workingDirectory, input.signal);
      await host.listen();
      const client = await this.#open(input.credential, input.stateDirectory, handlers);
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
                 .request(
                    'session/load',
                    { sessionId: saved, cwd: input.workingDirectory, mcpServers },
                    HANDSHAKE_MS
                 )
                 .catch(() => null)
            : null;
         const pinModel = runtime.model !== 'default';
         const session =
            loaded ??
            (await client.request(
               'session/new',
               {
                  cwd: input.workingDirectory,
                  mcpServers,
                  _meta: { kiro: pinModel ? { modelId: runtime.model } : {} },
               },
               HANDSHAKE_MS
            ));
         sessionId = (loaded ? saved : sessionIdOf(session)) ?? '';
         if (sessionId === '') {
            throw new RuntimeAdapterError('RUNTIME_PROTOCOL', 'Kiro CLI did not return a session id.', false);
         }
         await writeFile(join(input.stateDirectory, 'session-id'), sessionId, { mode: 0o600 });
         this.#active.set(sessionId, client);
         if (pinModel) {
            await client
               .request(
                  'session/set_config_option',
                  { sessionId, configId: 'model', value: runtime.model },
                  HANDSHAKE_MS
               )
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
         const cold = loaded ? '' : transcriptContext(input.envelope.transcript);
         const result = await client.request(
            'session/prompt',
            {
               sessionId,
               prompt: [{ type: 'text', text: `${cold}${input.envelope.task.prompt}` }],
            },
            this.#deadlineMs
         );
         const reported = kiroUsageEvent(result, runtime.model) ?? pendingUsage;
         if (reported) input.emit(reported);
         if (input.signal.aborted) {
            throw new RuntimeAdapterError('RUNTIME_CANCELLED', 'The Kiro run was cancelled.', false);
         }
         const stop = stopReason(result);
         if (stop === 'cancelled') {
            throw new RuntimeAdapterError('RUNTIME_CANCELLED', 'The Kiro run was cancelled.', false);
         }
         if (stop === 'refusal') {
            throw new RuntimeAdapterError('RUNTIME_ERROR', 'Kiro refused to complete this turn.', false);
         }
         if (stop === 'max_tokens' || stop === 'max_turn_requests') {
            throw new RuntimeAdapterError(
               'RUNTIME_LIMIT_REACHED',
               'Kiro reached its turn limit. Raise the agent limit or split the task into smaller work.',
               false
            );
         }
         return { text: textOf(normalization), sessionId };
      } catch (cause) {
         if (timedOut) {
            throw new RuntimeAdapterError(
               'RUNTIME_LIMIT_REACHED',
               'Kiro reached Berry\'s runtime limit. Split the task into smaller work.',
               false
            );
         }
         if (cause instanceof RuntimeAdapterError) throw cause;
         const text = redactSecret(cause instanceof Error ? cause.message : 'Kiro CLI failed.', input.credential.token);
         throw classifyKiroText(text);
      } finally {
         if (deadline) clearTimeout(deadline);
         input.signal.removeEventListener('abort', abort);
         if (sessionId !== '') this.#active.delete(sessionId);
         await client.close();
         await host.close();
      }
   }

   async #withClient<T>(
      credential: RuntimeCredential,
      home: string,
      operation: (client: KiroAcpClient) => Promise<T>
   ): Promise<T> {
      const client = await this.#open(credential, home);
      try {
         return await operation(client);
      } finally {
         await client.close();
      }
   }

   async #open(
      credential: RuntimeCredential,
      home: string,
      handlers: { onUpdate: (params: unknown) => void; onPermission: (params: unknown) => unknown } = {
         onUpdate: () => undefined,
         onPermission: (params) => selectKiroPermission(params, new Set()),
      }
   ): Promise<KiroAcpClient> {
      await exposeKiroChat(home);
      // v3 rejects `--agent`. The CLI's own default agent is the one that runs.
      const args = ['acp', '--agent-engine=v3'];
      const child = this.#launch({
         command: this.#command,
         args,
         cwd: home,
         env: childEnvironment(home, credential.token),
      });
      const client = new KiroAcpClient(child, credential.token, handlers);
      client.start();
      return client;
   }

   #assertKey(credential: RuntimeCredential): void {
      if (!usableKey(credential)) {
         throw new RuntimeAdapterError(
            'AUTH_REQUIRED',
            'Kiro needs the subscription API key from a Pro, Pro+, Pro Max, or Power plan. Reconnect it in AI Runtimes settings.',
            false
         );
      }
   }

   #assertIsolated(): void {
      if (this.#principalIsolation === 'shared_process') {
         throw new RuntimeAdapterError(
            'RUNTIME_ISOLATION_REQUIRED',
            'Kiro runs as its own process on the user workstation.',
            false
         );
      }
   }

   #isolatedAvailability(): RuntimeAvailability {
      return {
         available: false,
         version: null,
         reason: 'Kiro runs as its own process on the user workstation.',
         protocolVersion: 1,
         principalIsolation: this.#principalIsolation,
      };
   }

   #missing(): RuntimeAvailability {
      return {
         available: false,
         version: null,
         reason: 'kiro-cli is not installed on this workstation.',
         protocolVersion: 1,
         principalIsolation: this.#principalIsolation,
      };
   }
}

function usableKey(credential: RuntimeCredential): boolean {
   return credential.type === 'api_key' && isKiroApiKey(credential.token);
}

/**
 * `kiro-cli acp` launches `kiro-cli-chat` from `$HOME/.local/bin`. The run's
 * home is empty so another login cannot win, so the chat binary is linked in.
 */
async function exposeKiroChat(home: string): Promise<void> {
   const source = join(homedir(), '.local', 'bin', 'kiro-cli-chat');
   try {
      await access(source);
   } catch {
      return;
   }
   const directory = join(home, '.local', 'bin');
   await mkdir(directory, { recursive: true, mode: 0o700 });
   await symlink(source, join(directory, 'kiro-cli-chat')).catch(() => undefined);
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

function childEnvironment(home: string, token: string | null): Record<string, string> {
   const allowed = ['PATH', 'LANG', 'LC_ALL', 'SSL_CERT_FILE', 'SSL_CERT_DIR'] as const;
   const env: Record<string, string> = {
      HOME: home,
      TMPDIR: home,
      XDG_CONFIG_HOME: home,
      XDG_CACHE_HOME: home,
      XDG_DATA_HOME: home,
      KIRO_LOG_LEVEL: 'error',
      KIRO_CHAT_LOG_FILE: join(home, 'kiro.log'),
   };
   if (token) env.KIRO_API_KEY = token;
   for (const name of allowed) {
      const value = process.env[name];
      if (value) env[name] = value;
   }
   return env;
}

async function writePermissions(home: string): Promise<void> {
   const directory = join(home, '.kiro', 'settings');
   await mkdir(directory, { recursive: true, mode: 0o700 });
   // Native capabilities stay denied. Berry tools arrive through the MCP server.
   await writeFile(
      join(directory, 'permissions.yaml'),
      [
         'rules:',
         '  - capability: shell',
         '    effect: deny',
         '  - capability: fs_read',
         '    effect: deny',
         '  - capability: fs_write',
         '    effect: deny',
         '  - capability: mcp',
         '    match: ["berry/*"]',
         '    effect: allow',
         '',
      ].join('\n'),
      { mode: 0o600 }
   );
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

function modelsFromSession(value: unknown): RuntimeModel[] {
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

/**
 * One usage report for the turn. The last report wins.
 *
 * `kiro-cli acp --agent-engine=v3` does not put token counts on the prompt
 * result. It sends `session_info_update` with a context breakdown: prompt,
 * tool, file, and memory tokens, plus `kiroResponses` for model output.
 * A percentage or a credit total is not a token count, and credits are not
 * stored as a dollar price.
 */
export function kiroUsageEvent(payload: unknown, model: string): LifecycleEvent | null {
   for (const source of usageSources(payload)) {
      const event = usageFrom(source, model) ?? breakdownUsage(source, model);
      if (event) return event;
   }
   return null;
}

const CONTEXT_INPUT_BUCKETS = ['contextFiles', 'tools', 'memory', 'yourPrompts', 'sessionFiles'] as const;

function breakdownUsage(source: Record<string, unknown>, model: string): LifecycleEvent | null {
   const breakdown = source.breakdown;
   if (!breakdown || typeof breakdown !== 'object' || Array.isArray(breakdown)) return null;
   const buckets = breakdown as Record<string, unknown>;
   let inputTokens = 0;
   let outputTokens = 0;
   let seen = false;
   for (const key of CONTEXT_INPUT_BUCKETS) {
      const tokens = bucketTokens(buckets[key]);
      if (tokens === null) continue;
      seen = true;
      inputTokens += tokens;
   }
   const output = bucketTokens(buckets.kiroResponses);
   if (output !== null) {
      seen = true;
      outputTokens = output;
   }
   if (!seen || inputTokens + outputTokens === 0) return null;
   return usageEvent(model, inputTokens, outputTokens, 0, 0);
}

function bucketTokens(bucket: unknown): number | null {
   if (!bucket || typeof bucket !== 'object') return null;
   const tokens = (bucket as { tokens?: unknown }).tokens;
   if (typeof tokens !== 'number' || !Number.isFinite(tokens) || tokens < 0) return null;
   return Math.floor(tokens);
}

function usageSources(payload: unknown): Record<string, unknown>[] {
   if (!payload || typeof payload !== 'object') return [];
   const record = payload as Record<string, unknown>;
   const update = record.update && typeof record.update === 'object' ? (record.update as Record<string, unknown>) : null;
   const meta = metaRecord(update) ?? metaRecord(record);
   return [record.usage, update?.usage, meta, update, record].filter(
      (value): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)
   );
}

function metaRecord(value: Record<string, unknown> | null): Record<string, unknown> | null {
   const meta = value?._meta;
   if (!meta || typeof meta !== 'object') return null;
   const kiro = (meta as { kiro?: unknown }).kiro;
   return kiro && typeof kiro === 'object' && !Array.isArray(kiro) ? (kiro as Record<string, unknown>) : null;
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
   const input = pick('inputTokens', 'input_tokens', 'input_token_count');
   let output = pick('outputTokens', 'output_tokens', 'output_token_count');
   const thought = pick('thoughtTokens', 'thought_tokens');
   const cacheRead = pick('cachedReadTokens', 'cacheReadTokens', 'cache_read_tokens', 'cache_read_input_token_count');
   const cacheWrite = pick('cachedWriteTokens', 'cacheWriteTokens', 'cache_write_tokens', 'cache_write_input_token_count');
   const total = pick('totalTokens', 'total_tokens');
   if (thought > 0 && (total === 0 || input + output + thought <= total)) output += thought;
   let inputTokens = input;
   if (inputTokens === 0 && output === 0 && cacheRead === 0 && cacheWrite === 0 && total > 0) inputTokens = total;
   // ACP context meter: `used` is the tokens currently in the window.
   if (
      inputTokens === 0 &&
      output === 0 &&
      cacheRead === 0 &&
      cacheWrite === 0 &&
      (source.sessionUpdate === 'usage_update' || source.size !== undefined)
   ) {
      inputTokens = pick('used');
   }
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
         eventId: 'kiro-prompt',
         model: named || 'kiro',
         inputTokens,
         outputTokens,
         cacheReadTokens,
         cacheWriteTokens,
         reportedCostMicros: null,
      },
   };
}

function textOf(state: NormalizationState): string {
   return stateText.get(state) ?? '';
}

const stateText = new WeakMap<NormalizationState, string>();

function rememberText(state: NormalizationState, text: string): void {
   stateText.set(state, `${stateText.get(state) ?? ''}${text}`);
}

export function selectKiroPermission(
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
   const meta = (params as { _meta?: { kiro?: { mcpTool?: { identity?: { serverName?: unknown; toolName?: unknown } } } } })
      ._meta?.kiro?.mcpTool?.identity;
   if (!meta || meta.serverName !== 'berry' || typeof meta.toolName !== 'string') return null;
   return meta.toolName;
}

function transcriptContext(messages: AgentProcessRun['envelope']['transcript']): string {
   if (messages.length === 0) return '';
   const transcript = messages
      .map((message) => `${message.role === 'user' ? 'Person' : 'Agent'}: ${message.text}`)
      .join('\n');
   return `Conversation restored by Berry before this turn:\n<transcript>\n${transcript}\n</transcript>\n\n`;
}

/** CLI V3 session updates, skipping replay so a loaded session is not recorded twice. */
export function normalizeKiroUpdate(params: unknown, state: NormalizationState): LifecycleEvent[] {
   if (!params || typeof params !== 'object') return [];
   const update = (params as { update?: unknown }).update ?? params;
   if (!update || typeof update !== 'object') return [];
   const body = update as {
      sessionUpdate?: unknown;
      content?: { type?: unknown; text?: unknown } | Array<{ type?: unknown; text?: unknown }>;
      toolCallId?: unknown;
      title?: unknown;
      status?: unknown;
      _meta?: { kiro?: { replay?: unknown; kind?: unknown } };
   };
   if (body._meta?.kiro?.replay === true) return [];
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
      return text === ''
         ? []
         : [{ type: 'task.message', message: { kind: 'thinking', chars: state.thinkingChars, text } }];
   }
   if (kind === 'tool_call' && typeof body.toolCallId === 'string' && !state.started.has(body.toolCallId)) {
      state.started.add(body.toolCallId);
      return [{
         type: 'task.message',
         message: {
            kind: 'tool.started',
            toolCallId: body.toolCallId,
            name: typeof body.title === 'string' && body.title !== '' ? body.title : 'tool',
         },
      }];
   }
   if (kind === 'tool_call_update' && typeof body.toolCallId === 'string') {
      if (body.status !== 'completed' && body.status !== 'failed') return [];
      return [{
         type: 'task.message',
         message: {
            kind: 'tool.completed',
            toolCallId: body.toolCallId,
            succeeded: body.status === 'completed',
            durationMs: 0,
         },
      }];
   }
   return [];
}

function contentText(content: { type?: unknown; text?: unknown } | Array<{ type?: unknown; text?: unknown }> | undefined): string {
   if (Array.isArray(content)) return content.map((block) => contentText(block)).join('');
   if (!content || content.type !== 'text' || typeof content.text !== 'string') return '';
   return content.text;
}
