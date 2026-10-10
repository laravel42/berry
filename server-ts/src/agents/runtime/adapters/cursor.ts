import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CURSOR_CLI_LOGIN } from '../../../runtime/envelope.ts';
import type { LifecycleEvent } from '../../../runtime/lifecycle.ts';
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

const BRIDGE = fileURLToPath(new URL('./claude-mcp-bridge.ts', import.meta.url));

const INHERITED = [
   'PATH',
   'HOME',
   'USER',
   'LOGNAME',
   'SHELL',
   'LANG',
   'LC_ALL',
   'LC_CTYPE',
   'TMPDIR',
   'SSL_CERT_FILE',
   'SSL_CERT_DIR',
   'NODE_EXTRA_CA_CERTS',
] as const;

/**
 * Keys that would hand the Cursor CLI an API-key login instead of the
 * workstation account login. They are stripped from the child environment so
 * a value in the server's environment can never switch the run onto API
 * billing.
 */
const API_KEY_ENV = ['CURSOR_API_KEY', 'CURSOR_AUTH_TOKEN'] as const;

export interface CursorSpawn {
   command: string;
   args: string[];
   cwd: string;
   env: Record<string, string>;
   stdin: string;
}

export interface CursorChild {
   lines(): AsyncIterable<string>;
   exited: Promise<{ code: number | null; error: Error | null; stderr: string }>;
   kill(): void;
}

export type CursorLauncher = (spec: CursorSpawn) => CursorChild;

export interface CursorAdapterOptions {
   command?: string;
   launcher?: CursorLauncher;
   principalIsolation?: RuntimePrincipalIsolation;
}

/**
 * Cursor on this workstation.
 *
 * `cursor-agent` keeps its own browser account login. Berry never reads that
 * store and never passes an API key: `CURSOR_API_KEY`/`CURSOR_AUTH_TOKEN` are
 * stripped from the child environment so a connection cannot switch the run
 * onto API billing. The process may only call Berry tools over MCP; its own
 * shell and file tools stay off.
 */
export class CursorAgentAdapter implements AgentProcessAdapter {
   readonly identity = {
      id: 'cursor',
      name: 'Cursor',
      kind: 'agent_process' as const,
      provider: 'Cursor model service',
      billing: 'subscription' as const,
      capabilities: {
         modelDiscovery: true,
         streaming: true,
         tools: true,
         sessions: true,
         cancellation: true,
         usage: false,
      },
   };

   readonly #command: string;
   readonly #launch: CursorLauncher;
   readonly #principalIsolation: RuntimePrincipalIsolation;
   readonly #active = new Map<string, CursorChild>();

   constructor(options: CursorAdapterOptions = {}) {
      this.#command = options.command ?? 'cursor-agent';
      this.#launch = options.launcher ?? spawnCursorProcess;
      this.#principalIsolation = options.principalIsolation ?? 'workstation';
   }

   async checkAvailability(): Promise<RuntimeAvailability> {
      if (this.#principalIsolation === 'shared_process') return this.#isolatedAvailability();
      const home = await mkdtemp(join(tmpdir(), 'berry-cursor-'));
      const child = this.#launch({
         command: this.#command,
         args: ['--version'],
         cwd: home,
         env: childEnvironment(),
         stdin: '',
      });
      let version = '';
      try {
         for await (const line of child.lines()) {
            if (version === '' && line.trim() !== '') version = line.trim();
         }
      } catch {
         version = '';
      }
      const exit = await child.exited;
      await rm(home, { recursive: true, force: true });
      if (exit.error && (exit.error as NodeJS.ErrnoException).code === 'ENOENT') return this.#missing();
      if (exit.code !== 0 && version === '') return this.#missing();
      return {
         available: true,
         version: version.slice(0, 80) || 'cursor-agent',
         reason: null,
         protocolVersion: 1,
         principalIsolation: this.#principalIsolation,
      };
   }

   async connectionStatus(credential: RuntimeCredential | null): Promise<RuntimeConnectionStatus> {
      this.#assertLogin(credential);
      try {
         const login = await this.#loginStatus();
         if (login === 'account') {
            return { status: 'connected', accountId: null, accountName: 'Cursor', detail: null };
         }
         return {
            status: 'missing',
            accountId: null,
            accountName: null,
            detail: 'Run `cursor-agent login` on this workstation with a Cursor account, then connect again.',
         };
      } catch (cause) {
         if (cause instanceof RuntimeAdapterError && cause.code === 'RUNTIME_NOT_INSTALLED') throw cause;
         return {
            status: 'error',
            accountId: credential?.accountId ?? null,
            accountName: credential?.accountName ?? null,
            detail: cause instanceof Error ? cause.message : 'Cursor CLI could not report its login.',
         };
      }
   }

   async disconnect(): Promise<void> {
      for (const child of this.#active.values()) child.kill();
      this.#active.clear();
   }

   async discoverModels(credential: RuntimeCredential): Promise<RuntimeModel[]> {
      this.#assertLogin(credential);
      const login = await this.#loginStatus();
      if (login !== 'account') {
         throw new RuntimeAdapterError('AUTH_REQUIRED', 'Run `cursor-agent login` on this workstation with a Cursor account, then connect again.', false);
      }
      const home = await mkdtemp(join(tmpdir(), 'berry-cursor-models-'));
      const child = this.#launch({
         command: this.#command,
         args: ['models'],
         cwd: home,
         env: childEnvironment(),
         stdin: '',
      });
      let body = '';
      try {
         for await (const line of child.lines()) body += `${line}\n`;
      } catch (cause) {
         const error = cause as NodeJS.ErrnoException;
         if (error.code === 'ENOENT') throw new RuntimeAdapterError('RUNTIME_NOT_INSTALLED', 'cursor-agent is not installed on this workstation.', false);
         throw cause;
      }
      const exit = await child.exited;
      await rm(home, { recursive: true, force: true });
      if (exit.error && (exit.error as NodeJS.ErrnoException).code === 'ENOENT') {
         throw new RuntimeAdapterError('RUNTIME_NOT_INSTALLED', 'cursor-agent is not installed on this workstation.', false);
      }
      return listedModels(body);
   }

   start(input: AgentProcessRun): Promise<AgentProcessResult> {
      return this.#run(input, null);
   }

   resume(input: AgentProcessRun & { sessionId: string }): Promise<AgentProcessResult> {
      return this.#run(input, input.sessionId);
   }

   async cancel(sessionId: string): Promise<void> {
      this.#active.get(sessionId)?.kill();
   }

   async #run(input: AgentProcessRun, resume: string | null): Promise<AgentProcessResult> {
      const runtime = input.envelope.runtime;
      if (!runtime || runtime.id !== this.identity.id) {
         throw new RuntimeAdapterError('RUNTIME_PROTOCOL', 'The Cursor task envelope is incomplete.', false);
      }
      this.#assertLogin(input.credential);
      this.#assertIsolated();
      await mkdir(input.stateDirectory, { recursive: true, mode: 0o700 });
      await chmod(input.stateDirectory, 0o700);
      // Deny the CLI's own write, delete, and shell tools so Berry's MCP tools
      // are the only way it can act. `--force` would instead auto-approve all
      // of them, which is not the boundary Berry wants: the checkout is
      // writable, but only through admitted Berry tools.
      await writePermissions(input.workingDirectory);
      const socketPath = join(process.platform === 'win32' ? tmpdir() : '/tmp', `berry-cursor-${randomBytes(8).toString('hex')}.sock`);
      const host = new BerryMcpHost(socketPath, input.tools, input.workingDirectory, input.signal);
      await host.listen();
      const model = runtime.model;
      const args = [
         '--print',
         '--output-format',
         'stream-json',
         '--mcp-config',
         mcpConfig(socketPath),
      ];
      if (model && model !== 'default') args.push('--model', model);
      if (resume) args.push('--resume', resume);
      const child = this.#launch({
         command: this.#command,
         args,
         cwd: input.workingDirectory,
         env: childEnvironment(),
         stdin: promptFor(input),
      });
      const tracked = resume ?? input.envelope.runId;
      this.#active.set(tracked, child);
      let text = '';
      let sessionId = resume ?? '';
      const stop = () => child.kill();
      input.signal.addEventListener('abort', stop, { once: true });
      try {
         for await (const line of child.lines()) {
            const parsed = readEvent(line, model ?? 'cursor');
            if (!parsed) continue;
            if (parsed.sessionId) sessionId = parsed.sessionId;
            if (parsed.text) {
               text += parsed.text;
               input.emit({ type: 'task.message', message: { kind: 'output', channel: 'assistant', text: parsed.text } });
            }
            for (const message of parsed.messages) input.emit(message);
            if (parsed.usage) input.emit(parsed.usage);
            if (parsed.failure) throw new RuntimeAdapterError(parsed.failure.code, parsed.failure.message, parsed.failure.retryable);
         }
         const exit = await child.exited;
         if (input.signal.aborted) {
            throw new RuntimeAdapterError('RUNTIME_CANCELLED', 'The Cursor CLI was stopped.', false);
         }
         if (exit.code !== 0 && text === '') {
            throw new RuntimeAdapterError('RUNTIME_ERROR', exit.stderr || `Cursor CLI exited ${exit.code ?? 'without a status'}.`, true);
         }
      } finally {
         input.signal.removeEventListener('abort', stop);
         this.#active.delete(tracked);
         await host.close();
      }
      return { text, sessionId: sessionId || input.envelope.runId };
   }

   async #loginStatus(): Promise<'account' | 'missing'> {
      this.#assertIsolated();
      const home = await mkdtemp(join(tmpdir(), 'berry-cursor-auth-'));
      const child = this.#launch({
         command: this.#command,
         args: ['status'],
         cwd: home,
         env: childEnvironment(),
         stdin: '',
      });
      let stdout = '';
      try {
         for await (const line of child.lines()) stdout += `${line}\n`;
      } catch (cause) {
         const error = cause as NodeJS.ErrnoException;
         if (error.code === 'ENOENT') throw new RuntimeAdapterError('RUNTIME_NOT_INSTALLED', 'cursor-agent is not installed on this workstation.', false);
         throw cause;
      }
      const exit = await child.exited;
      await rm(home, { recursive: true, force: true });
      if (exit.error && (exit.error as NodeJS.ErrnoException).code === 'ENOENT') {
         throw new RuntimeAdapterError('RUNTIME_NOT_INSTALLED', 'cursor-agent is not installed on this workstation.', false);
      }
      return readLogin(`${stdout}\n${exit.stderr}`);
   }

   #assertLogin(credential: RuntimeCredential | null): asserts credential is RuntimeCredential {
      if (!credential || credential.type !== 'oauth' || credential.token !== CURSOR_CLI_LOGIN) {
         throw new RuntimeAdapterError(
            'AUTH_REQUIRED',
            'Connect Cursor in AI Runtimes. Berry uses the Cursor CLI login on this workstation.',
            false
         );
      }
   }

   #assertIsolated(): void {
      if (this.#principalIsolation === 'shared_process') {
         throw new RuntimeAdapterError('RUNTIME_ISOLATION_REQUIRED', 'Cursor runs as its own process on the user workstation.', false);
      }
   }

   #isolatedAvailability(): RuntimeAvailability {
      return {
         available: false,
         version: null,
         reason: 'Cursor runs as its own process on the user workstation.',
         protocolVersion: 1,
         principalIsolation: this.#principalIsolation,
      };
   }

   #missing(): RuntimeAvailability {
      return {
         available: false,
         version: null,
         reason: 'cursor-agent is not installed on this workstation.',
         protocolVersion: 1,
         principalIsolation: this.#principalIsolation,
      };
   }
}

export function spawnCursorProcess(spec: CursorSpawn): CursorChild {
   const child = spawn(spec.command, spec.args, { cwd: spec.cwd, env: spec.env, stdio: ['pipe', 'pipe', 'pipe'] });
   child.stdin.on('error', () => undefined);
   child.stdin.end(spec.stdin);
   let error: Error | null = null;
   const stderr: string[] = [];
   child.on('error', (cause) => {
      error = cause;
   });
   child.stderr.on('data', (chunk: Buffer | string) => {
      stderr.push(typeof chunk === 'string' ? chunk : chunk.toString('utf8'));
   });
   return {
      async *lines() {
         let buffer = '';
         for await (const chunk of child.stdout) {
            buffer += Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk);
            let newline = buffer.indexOf('\n');
            while (newline !== -1) {
               const line = buffer.slice(0, newline).trim();
               buffer = buffer.slice(newline + 1);
               if (line) yield line;
               newline = buffer.indexOf('\n');
            }
         }
         const rest = buffer.trim();
         if (rest) yield rest;
      },
      exited: new Promise((resolve) => {
         child.on('close', (code) => resolve({ code, error, stderr: redact(stderr.join('')).slice(-500) }));
      }),
      kill() {
         child.kill('SIGTERM');
      },
   };
}

function childEnvironment(): Record<string, string> {
   const env: Record<string, string> = {};
   for (const name of INHERITED) {
      const value = process.env[name];
      if (value) env[name] = value;
   }
   for (const name of API_KEY_ENV) delete env[name];
   return env;
}

function mcpConfig(socketPath: string): string {
   return JSON.stringify({
      mcpServers: {
         berry: {
            command: process.execPath,
            args: ['--experimental-strip-types', BRIDGE, socketPath],
         },
      },
   });
}

/**
 * Writes the project-level Cursor CLI permissions policy into the checkout.
 *
 * The run is non-interactive, so without a policy the CLI would prompt and
 * stall. Rather than `--force` (which auto-approves the CLI's own writes,
 * deletes, and shell), Berry allows only reads and the `berry` MCP tools and
 * denies the built-in write, delete, and shell tools. Berry's admitted tools
 * remain the only way the agent changes anything.
 */
async function writePermissions(workingDirectory: string): Promise<void> {
   const directory = join(workingDirectory, '.cursor');
   await mkdir(directory, { recursive: true });
   await writeFile(
      join(directory, 'cli.json'),
      JSON.stringify(
         {
            permissions: {
               allow: ['Read(**)', 'Mcp(berry:*)'],
               deny: ['Write(**)', 'Delete(**)', 'Shell(*)'],
            },
         },
         null,
         2
      ),
      { mode: 0o600 }
   );
}

function promptFor(input: AgentProcessRun): string {
   const transcript = input.envelope.transcript
      .map((message) => `${message.role}: ${message.text}`)
      .join('\n');
   const restored = transcript === '' ? '' : `Conversation restored by Berry before this turn:\n${transcript}\n\n`;
   return `${restored}${input.envelope.agent.instructions}\n\n${input.envelope.task.prompt}`;
}

/**
 * Reads only whether the CLI reports a signed-in Cursor account. The account
 * email the CLI prints is deliberately not captured: Berry stores no personal
 * identifier from the credential store, only that a login exists.
 */
function readLogin(report: string): 'account' | 'missing' {
   if (/not logged in|not authenticated|no (?:active )?(?:login|session)|please (?:run )?.*login/i.test(report)) {
      return 'missing';
   }
   if (/logged in|signed in|authenticated/i.test(report)) return 'account';
   return 'missing';
}

function listedModels(body: string): RuntimeModel[] {
   const trimmed = body.trim();
   let names: string[] = [];
   try {
      const parsed = JSON.parse(trimmed);
      names = modelNamesFromJson(parsed);
   } catch {
      names = trimmed
         .split('\n')
         .map((line) => line.replace(/^[\s*\u2022\-]+/, '').trim())
         .filter((line) => line !== '' && !/available models|current model/i.test(line));
   }
   const listed: RuntimeModel[] = [];
   const seen = new Set<string>();
   for (const name of names) {
      const id = name.replace(/\s*\(default\)\s*$/i, '').trim();
      if (id === '' || seen.has(id)) continue;
      seen.add(id);
      listed.push({ id, name: id, reasoning: null, tools: true, policy: null });
   }
   return listed;
}

function modelNamesFromJson(parsed: unknown): string[] {
   if (Array.isArray(parsed)) {
      return parsed.map((entry) => modelName(entry)).filter((name): name is string => name !== null);
   }
   if (parsed && typeof parsed === 'object') {
      const models = (parsed as { models?: unknown }).models;
      if (Array.isArray(models)) {
         return models.map((entry) => modelName(entry)).filter((name): name is string => name !== null);
      }
   }
   return [];
}

function modelName(entry: unknown): string | null {
   if (typeof entry === 'string') return entry;
   if (entry && typeof entry === 'object') {
      const record = entry as Record<string, unknown>;
      for (const key of ['id', 'name', 'slug', 'model']) {
         const value = record[key];
         if (typeof value === 'string' && value !== '') return value;
      }
   }
   return null;
}

interface ParsedLine {
   sessionId: string | null;
   text: string;
   messages: LifecycleEvent[];
   usage: LifecycleEvent | null;
   failure: { code: 'RUNTIME_ERROR' | 'QUOTA_EXHAUSTED'; message: string; retryable: boolean } | null;
}

function readEvent(line: string, model: string): ParsedLine | null {
   let parsed: unknown;
   try {
      parsed = JSON.parse(line);
   } catch {
      return null;
   }
   if (!parsed || typeof parsed !== 'object') return null;
   const record = parsed as Record<string, unknown>;
   const sessionId = sessionIdOf(record);
   if (record.type === 'system') {
      return { sessionId, text: '', messages: [], usage: null, failure: null };
   }
   if (record.type === 'assistant' && record.subtype !== 'delta') {
      return { sessionId, text: assistantText(record), messages: [], usage: null, failure: null };
   }
   if (record.type === 'tool_call') {
      const id = typeof record.id === 'string' ? record.id : typeof record.tool_call_id === 'string' ? record.tool_call_id : null;
      if (!id) return { sessionId, text: '', messages: [], usage: null, failure: null };
      const name = typeof record.name === 'string' ? record.name : typeof record.tool === 'string' ? record.tool : 'tool';
      const subtype = record.subtype;
      if (subtype === 'started') {
         return { sessionId, text: '', messages: [{ type: 'task.message', message: { kind: 'tool.started', toolCallId: id, name } }], usage: null, failure: null };
      }
      if (subtype === 'completed') {
         const succeeded = record.error == null && record.is_error !== true;
         return { sessionId, text: '', messages: [{ type: 'task.message', message: { kind: 'tool.completed', toolCallId: id, succeeded } }], usage: null, failure: null };
      }
      return { sessionId, text: '', messages: [], usage: null, failure: null };
   }
   if (record.type === 'result') {
      const errored = record.is_error === true || record.subtype === 'error';
      if (errored) {
         const message = typeof record.result === 'string' && record.result !== '' ? record.result : 'Cursor CLI did not finish the task.';
         const quota = /quota|rate limit|usage limit/i.test(message);
         return {
            sessionId,
            text: '',
            messages: [],
            usage: null,
            failure: { code: quota ? 'QUOTA_EXHAUSTED' : 'RUNTIME_ERROR', message: message.slice(0, 500), retryable: quota },
         };
      }
      return { sessionId, text: '', messages: [], usage: usageEvent(record.usage, model), failure: null };
   }
   if (record.type === 'error') {
      const message = typeof record.message === 'string' ? record.message : 'Cursor CLI did not finish the task.';
      const quota = /quota|rate limit|usage limit/i.test(message);
      return {
         sessionId,
         text: '',
         messages: [],
         usage: null,
         failure: { code: quota ? 'QUOTA_EXHAUSTED' : 'RUNTIME_ERROR', message: message.slice(0, 500), retryable: quota },
      };
   }
   return null;
}

function sessionIdOf(record: Record<string, unknown>): string | null {
   const value = record.session_id ?? record.sessionId ?? record.chat_id ?? record.chatId;
   return typeof value === 'string' && value !== '' ? value : null;
}

function assistantText(record: Record<string, unknown>): string {
   const message = record.message;
   if (typeof message === 'string') return message;
   if (message && typeof message === 'object') {
      const content = (message as { content?: unknown }).content;
      const fromContent = textFromContent(content);
      if (fromContent !== '') return fromContent;
      const text = (message as { text?: unknown }).text;
      if (typeof text === 'string') return text;
   }
   const text = record.text;
   if (typeof text === 'string') return text;
   return textFromContent(record.content);
}

function textFromContent(content: unknown): string {
   if (typeof content === 'string') return content;
   if (Array.isArray(content)) {
      return content
         .map((part) => {
            if (typeof part === 'string') return part;
            if (part && typeof part === 'object') {
               const value = (part as { text?: unknown }).text;
               if (typeof value === 'string') return value;
            }
            return '';
         })
         .join('');
   }
   return '';
}

function usageEvent(value: unknown, model: string): LifecycleEvent | null {
   if (!value || typeof value !== 'object') return null;
   const source = value as Record<string, unknown>;
   const whole = (...keys: string[]): number => {
      for (const key of keys) {
         const item = source[key];
         if (typeof item === 'number' && Number.isFinite(item) && item >= 0) return Math.floor(item);
      }
      return 0;
   };
   const inputTokens = whole('input_tokens', 'inputTokens', 'prompt_tokens');
   const outputTokens = whole('output_tokens', 'outputTokens', 'completion_tokens');
   const cacheReadTokens = whole('cache_read_input_tokens', 'cached_input_tokens', 'cacheReadTokens');
   const cacheWriteTokens = whole('cache_creation_input_tokens', 'cacheWriteTokens');
   if (inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens === 0) return null;
   return {
      type: 'task.usage',
      usage: {
         eventId: 'cursor-result',
         model,
         inputTokens,
         outputTokens,
         cacheReadTokens,
         cacheWriteTokens,
         reportedCostMicros: null,
      },
   };
}

function redact(text: string): string {
   return text
      .replace(/sk-[A-Za-z0-9_-]+/g, '[redacted]')
      .replace(/\bcursor_[A-Za-z0-9_-]+/g, '[redacted]');
}
