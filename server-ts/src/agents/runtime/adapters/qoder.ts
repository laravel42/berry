import { randomBytes } from 'node:crypto';
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { QODER_CLI_LOGIN } from '../../../runtime/envelope.ts';
import type { LifecycleEvent } from '../../../runtime/lifecycle.ts';
import { KiroAcpClient, spawnKiroProcess, type KiroChild, type KiroSpawn } from './kiro-acp.ts';
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

export type QoderLauncher = (spec: KiroSpawn) => KiroChild;

const DEFAULT_DEADLINE_MS = 2 * 60 * 60 * 1000;
const HANDSHAKE_MS = 20_000;
const BRIDGE = fileURLToPath(new URL('./kiro-mcp-bridge.ts', import.meta.url));

/**
 * `sockaddr_un.sun_path` on macOS is 104 bytes including the trailing NUL, so
 * the ACP tool socket lives under `/tmp` to stay well under that limit.
 */
export function qoderMcpSocketPath(): string {
   const path = join(process.platform === 'win32' ? tmpdir() : '/tmp', `berry-qoder-${randomBytes(8).toString('hex')}.sock`);
   if (Buffer.byteLength(path) > 103) {
      throw new RuntimeAdapterError('RUNTIME_ERROR', 'The Qoder tool socket path is too long for this operating system.', false);
   }
   return path;
}

export interface QoderAdapterOptions {
   command?: string;
   principalIsolation?: RuntimePrincipalIsolation;
   deadlineMs?: number;
   launcher?: QoderLauncher;
}

interface NormalizationState {
   thinkingChars: number;
   started: Set<string>;
}

/**
 * Qoder CLI as a process on the user's workstation.
 *
 * The CLI owns its login: a first-run browser PKCE sign-in keeps the account
 * token in Qoder's own local store (`docs.qoder.com/cli/authentication`).
 * Berry never reads that store and never passes an API key or a PAT. The CLI
 * runs as an ACP server over stdio (`qoder --acp`, `docs.qoder.com/cli/acp`),
 * the same Agent Client Protocol family Kiro speaks, so the ACP transport is
 * reused. No access-token callback is answered — unlike Kiro, Qoder keeps the
 * credential entirely in the CLI, so the ACP client carries an empty token.
 * Native shell and file tools are denied; Berry tools arrive over MCP.
 *
 * Flags are the official CLI reference (`docs.qoder.com/cli/cli-reference`):
 * `--acp` starts the ACP server, `--list-models` lists models and exits,
 * and the child's working directory is the task checkout.
 */
export class QoderAgentAdapter implements AgentProcessAdapter {
   readonly identity = {
      id: 'qoder',
      name: 'Qoder',
      kind: 'agent_process' as const,
      provider: 'Qoder model service',
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
   readonly #launch: QoderLauncher;
   readonly #principalIsolation: RuntimePrincipalIsolation;
   readonly #deadlineMs: number;
   readonly #active = new Map<string, KiroAcpClient>();

   constructor(options: QoderAdapterOptions = {}) {
      this.#command = options.command ?? 'qoder';
      this.#launch = options.launcher ?? spawnKiroProcess;
      this.#principalIsolation = options.principalIsolation ?? 'workstation';
      this.#deadlineMs = options.deadlineMs ?? DEFAULT_DEADLINE_MS;
   }

   async checkAvailability(): Promise<RuntimeAvailability> {
      if (this.#principalIsolation === 'shared_process') return this.#isolatedAvailability();
      const home = await mkdtemp(join(tmpdir(), 'berry-qoder-'));
      const child = this.#launch({
         command: this.#command,
         args: ['--version'],
         cwd: home,
         env: childEnvironment(),
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
         version: version.slice(0, 80) || 'qoder',
         reason: null,
         protocolVersion: 1,
         principalIsolation: this.#principalIsolation,
      };
   }

   async connectionStatus(credential: RuntimeCredential | null): Promise<RuntimeConnectionStatus> {
      this.#assertLogin(credential);
      try {
         const models = await this.#listModels();
         if (models.length === 0) {
            return {
               status: 'missing',
               accountId: null,
               accountName: null,
               detail: 'Run `qoder` once on this workstation and sign in, then connect again.',
            };
         }
         return { status: 'connected', accountId: null, accountName: 'Qoder', detail: null };
      } catch (cause) {
         if (cause instanceof RuntimeAdapterError && cause.code === 'RUNTIME_NOT_INSTALLED') throw cause;
         if (cause instanceof RuntimeAdapterError && (cause.code === 'AUTH_REQUIRED' || cause.code === 'AUTH_EXPIRED')) {
            return {
               status: cause.code === 'AUTH_EXPIRED' ? 'expired' : 'missing',
               accountId: null,
               accountName: null,
               detail: cause.message,
            };
         }
         return {
            status: 'error',
            accountId: credential?.accountId ?? null,
            accountName: credential?.accountName ?? null,
            detail: cause instanceof Error ? cause.message : 'Qoder CLI could not report its login.',
         };
      }
   }

   async disconnect(): Promise<void> {
      await Promise.all([...this.#active.values()].map((client) => client.close()));
      this.#active.clear();
   }

   async discoverModels(credential: RuntimeCredential): Promise<RuntimeModel[]> {
      this.#assertLogin(credential);
      this.#assertIsolated();
      const models = await this.#listModels();
      if (models.length === 0) {
         throw new RuntimeAdapterError('AUTH_REQUIRED', 'Run `qoder` once on this workstation and sign in, then connect again.', false);
      }
      return models;
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

   /** `qoder --list-models` lists models and exits; it fails when the CLI is not signed in. */
   async #listModels(): Promise<RuntimeModel[]> {
      this.#assertIsolated();
      const home = await mkdtemp(join(tmpdir(), 'berry-qoder-models-'));
      const child = this.#launch({
         command: this.#command,
         args: ['--list-models'],
         cwd: home,
         env: childEnvironment(),
      });
      let body = '';
      let stderr = '';
      const readErr = (async () => {
         for await (const line of child.errors()) stderr += `${line}\n`;
      })().catch(() => undefined);
      try {
         for await (const line of child.lines()) body += `${line}\n`;
      } catch (cause) {
         const error = cause as NodeJS.ErrnoException;
         if (error.code === 'ENOENT') throw new RuntimeAdapterError('RUNTIME_NOT_INSTALLED', 'qoder is not installed on this workstation.', false);
         throw cause;
      }
      const exit = await child.exited;
      await readErr;
      await rm(home, { recursive: true, force: true });
      if (exit.error && (exit.error as NodeJS.ErrnoException).code === 'ENOENT') {
         throw new RuntimeAdapterError('RUNTIME_NOT_INSTALLED', 'qoder is not installed on this workstation.', false);
      }
      if (exit.code !== 0) {
         const report = `${body}\n${stderr}`.toLowerCase();
         if (/log ?in|sign ?in|unauthenticated|unauthorized|not authenticated|authentication/.test(report)) {
            throw new RuntimeAdapterError('AUTH_REQUIRED', 'Run `qoder` once on this workstation and sign in, then connect again.', false);
         }
         // A non-zero exit that is not an auth error is a CLI or flag problem,
         // not a signed-out account: surface it instead of reporting signed out.
         throw new RuntimeAdapterError(
            'RUNTIME_ERROR',
            `qoder --list-models exited ${exit.code ?? 'without a status'}. Check that the installed Qoder CLI supports --list-models.`,
            true
         );
      }
      return parseModels(body);
   }

   async #run(input: AgentProcessRun): Promise<AgentProcessResult> {
      const runtime = input.envelope.runtime;
      if (!runtime || runtime.id !== this.identity.id || runtime.model === null) {
         throw new RuntimeAdapterError('RUNTIME_PROTOCOL', 'The Qoder task envelope is incomplete.', false);
      }
      this.#assertLogin(input.credential);
      this.#assertIsolated();
      await mkdir(input.stateDirectory, { recursive: true, mode: 0o700 });
      await chmod(input.stateDirectory, 0o700);
      const allowed = new Set(input.tools.map((tool) => tool.name));
      const normalization: NormalizationState = { thinkingChars: 0, started: new Set() };
      let pendingUsage: LifecycleEvent | null = null;
      const handlers = {
         onUpdate: (params: unknown): void => {
            const streamed = qoderUsageEvent(params, runtime.model ?? 'qoder');
            if (streamed) pendingUsage = streamed;
            for (const event of normalizeQoderUpdate(params, normalization)) input.emit(event);
         },
         onPermission: (params: unknown) => selectQoderPermission(params, allowed),
      };
      const socketPath = qoderMcpSocketPath();
      const host = new BerryMcpHost(socketPath, input.tools, input.workingDirectory, input.signal);
      await host.listen();
      const client = this.#open(input.workingDirectory, handlers);
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
         const pinModel = runtime.model !== 'default';
         const session = await client.request(
            'session/new',
            { cwd: input.workingDirectory, mcpServers },
            HANDSHAKE_MS
         );
         sessionId = sessionIdOf(session) ?? '';
         if (sessionId === '') {
            throw new RuntimeAdapterError('RUNTIME_PROTOCOL', 'Qoder CLI did not return a session id.', false);
         }
         this.#active.set(sessionId, client);
         if (pinModel) {
            await client
               .request('session/set_config_option', { sessionId, configId: 'model', value: runtime.model }, HANDSHAKE_MS)
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
         const cold = transcriptContext(input.envelope.transcript);
         const result = await client.request(
            'session/prompt',
            { sessionId, prompt: [{ type: 'text', text: `${cold}${input.envelope.task.prompt}` }] },
            this.#deadlineMs
         );
         const reported = qoderUsageEvent(result, runtime.model) ?? pendingUsage;
         if (reported) input.emit(reported);
         if (input.signal.aborted) {
            throw new RuntimeAdapterError('RUNTIME_CANCELLED', 'The Qoder run was cancelled.', false);
         }
         const stop = stopReason(result);
         if (stop === 'cancelled') {
            throw new RuntimeAdapterError('RUNTIME_CANCELLED', 'The Qoder run was cancelled.', false);
         }
         if (stop === 'refusal') {
            throw new RuntimeAdapterError('RUNTIME_ERROR', 'Qoder refused to complete this turn.', false);
         }
         if (stop === 'max_tokens' || stop === 'max_turn_requests') {
            throw new RuntimeAdapterError(
               'RUNTIME_LIMIT_REACHED',
               'Qoder reached its turn limit. Raise the agent limit or split the task into smaller work.',
               false
            );
         }
         return { text: textOf(normalization), sessionId };
      } catch (cause) {
         if (timedOut) {
            throw new RuntimeAdapterError(
               'RUNTIME_LIMIT_REACHED',
               "Qoder reached Berry's runtime limit. Split the task into smaller work.",
               false
            );
         }
         if (cause instanceof RuntimeAdapterError) throw cause;
         throw new RuntimeAdapterError('RUNTIME_ERROR', 'Qoder CLI could not complete the task.', true);
      } finally {
         if (deadline) clearTimeout(deadline);
         input.signal.removeEventListener('abort', abort);
         if (sessionId !== '') this.#active.delete(sessionId);
         await client.close();
         await host.close();
      }
   }

   #open(
      workingDirectory: string,
      handlers: { onUpdate: (params: unknown) => void; onPermission: (params: unknown) => unknown }
   ): KiroAcpClient {
      const child = this.#launch({
         command: this.#command,
         args: ['--acp'],
         // Start the CLI in the task checkout, not the server's own directory.
         cwd: workingDirectory,
         env: childEnvironment(),
      });
      // Qoder keeps its login in the CLI, so no access token is forwarded.
      const client = new KiroAcpClient(child, '', handlers);
      client.start();
      return client;
   }

   #assertLogin(credential: RuntimeCredential | null): asserts credential is RuntimeCredential {
      if (!credential || credential.type !== 'oauth' || credential.token !== QODER_CLI_LOGIN) {
         throw new RuntimeAdapterError(
            'AUTH_REQUIRED',
            'Connect Qoder in AI Runtimes. Berry uses the Qoder CLI login on this workstation.',
            false
         );
      }
   }

   #assertIsolated(): void {
      if (this.#principalIsolation === 'shared_process') {
         throw new RuntimeAdapterError('RUNTIME_ISOLATION_REQUIRED', 'Qoder runs as its own process on the user workstation.', false);
      }
   }

   #isolatedAvailability(): RuntimeAvailability {
      return {
         available: false,
         version: null,
         reason: 'Qoder runs as its own process on the user workstation.',
         protocolVersion: 1,
         principalIsolation: this.#principalIsolation,
      };
   }

   #missing(): RuntimeAvailability {
      return {
         available: false,
         version: null,
         reason: 'qoder is not installed on this workstation.',
         protocolVersion: 1,
         principalIsolation: this.#principalIsolation,
      };
   }
}

const INHERITED = ['PATH', 'HOME', 'USER', 'LOGNAME', 'SHELL', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TMPDIR', 'SSL_CERT_FILE', 'SSL_CERT_DIR', 'NODE_EXTRA_CA_CERTS'] as const;

function childEnvironment(): Record<string, string> {
   const env: Record<string, string> = {};
   for (const name of INHERITED) {
      const value = process.env[name];
      if (value) env[name] = value;
   }
   return env;
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

function parseModels(body: string): RuntimeModel[] {
   const trimmed = body.trim();
   if (trimmed === '') return [];
   // Prefer a JSON array/object list; fall back to one id per line.
   try {
      const parsed = JSON.parse(trimmed) as unknown;
      const list = Array.isArray(parsed)
         ? parsed
         : parsed && typeof parsed === 'object' && Array.isArray((parsed as { models?: unknown }).models)
           ? ((parsed as { models: unknown[] }).models)
           : null;
      if (list) {
         return list.flatMap((entry) => {
            if (typeof entry === 'string' && entry.trim() !== '') {
               return [{ id: entry.trim(), name: entry.trim(), reasoning: null, tools: true, policy: null }];
            }
            if (entry && typeof entry === 'object') {
               const record = entry as Record<string, unknown>;
               const id = typeof record.id === 'string' ? record.id : typeof record.model === 'string' ? record.model : '';
               if (id.trim() === '') return [];
               const name = typeof record.name === 'string' && record.name !== '' ? record.name : id;
               return [{ id: id.trim(), name, reasoning: null, tools: true, policy: null }];
            }
            return [];
         });
      }
   } catch {
      // Not JSON; parse line by line below.
   }
   const seen = new Set<string>();
   const models: RuntimeModel[] = [];
   for (const raw of trimmed.split('\n')) {
      const id = raw.replace(/^[\s*-]+/, '').trim();
      if (id === '' || seen.has(id) || !/^[\w./:-]{1,200}$/.test(id)) continue;
      seen.add(id);
      models.push({ id, name: id, reasoning: null, tools: true, policy: null });
   }
   return models;
}

function sessionIdOf(value: unknown): string | null {
   if (!value || typeof value !== 'object') return null;
   const id = (value as { sessionId?: unknown }).sessionId;
   return typeof id === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(id) ? id : null;
}

function stopReason(value: unknown): string | null {
   if (!value || typeof value !== 'object') return null;
   const reason = (value as { stopReason?: unknown }).stopReason;
   return typeof reason === 'string' ? reason : null;
}

function transcriptContext(messages: AgentProcessRun['envelope']['transcript']): string {
   if (messages.length === 0) return '';
   const transcript = messages
      .map((message) => `${message.role === 'user' ? 'Person' : 'Agent'}: ${message.text}`)
      .join('\n');
   return `Conversation restored by Berry before this turn:\n<transcript>\n${transcript}\n</transcript>\n\n`;
}

const stateText = new WeakMap<NormalizationState, string>();

function rememberText(state: NormalizationState, text: string): void {
   stateText.set(state, `${stateText.get(state) ?? ''}${text}`);
}

function textOf(state: NormalizationState): string {
   return stateText.get(state) ?? '';
}

/** One usage report for the turn. The last report wins. */
export function qoderUsageEvent(payload: unknown, model: string): LifecycleEvent | null {
   if (!payload || typeof payload !== 'object') return null;
   const record = payload as Record<string, unknown>;
   const update = record.update && typeof record.update === 'object' ? (record.update as Record<string, unknown>) : null;
   for (const source of [record.usage, update?.usage].filter((value): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value))) {
      const whole = (...keys: string[]): number => {
         for (const key of keys) {
            const value = source[key];
            if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return Math.floor(value);
         }
         return 0;
      };
      const inputTokens = whole('inputTokens', 'input_tokens', 'promptTokens', 'prompt_tokens');
      const outputTokens = whole('outputTokens', 'output_tokens', 'completionTokens', 'completion_tokens');
      const cacheReadTokens = whole('cacheReadTokens', 'cache_read_tokens', 'cachedInputTokens', 'cached_input_tokens');
      const cacheWriteTokens = whole('cacheWriteTokens', 'cache_write_tokens');
      if (inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens === 0) continue;
      return {
         type: 'task.usage',
         usage: {
            eventId: 'qoder-prompt',
            model: model.trim() || 'qoder',
            inputTokens,
            outputTokens,
            cacheReadTokens,
            cacheWriteTokens,
            reportedCostMicros: null,
         },
      };
   }
   return null;
}

export function selectQoderPermission(
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
   const title = (params as { toolCall?: { title?: unknown } }).toolCall?.title;
   if (typeof title === 'string') {
      const match = title.match(/berry[\/.]([A-Za-z0-9_]+)/);
      if (match) return match[1] ?? null;
   }
   return null;
}

/** CLI session updates mapped to Berry lifecycle events, skipping replayed history. */
export function normalizeQoderUpdate(params: unknown, state: NormalizationState): LifecycleEvent[] {
   if (!params || typeof params !== 'object') return [];
   const update = (params as { update?: unknown }).update ?? params;
   if (!update || typeof update !== 'object') return [];
   const body = update as {
      sessionUpdate?: unknown;
      content?: { type?: unknown; text?: unknown } | Array<{ type?: unknown; text?: unknown }>;
      toolCallId?: unknown;
      title?: unknown;
      status?: unknown;
   };
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
         message: { kind: 'tool.completed', toolCallId: body.toolCallId, succeeded: body.status === 'completed', durationMs: 0 },
      }];
   }
   return [];
}

function contentText(content: { type?: unknown; text?: unknown } | Array<{ type?: unknown; text?: unknown }> | undefined): string {
   if (Array.isArray(content)) return content.map((block) => contentText(block)).join('');
   if (!content || content.type !== 'text' || typeof content.text !== 'string') return '';
   return content.text;
}
