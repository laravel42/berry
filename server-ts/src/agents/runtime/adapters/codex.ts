import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { chmod, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CODEX_CLI_LOGIN } from '../../../runtime/envelope.ts';
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

export interface CodexSpawn {
   command: string;
   args: string[];
   cwd: string;
   env: Record<string, string>;
   stdin: string;
}

export interface CodexChild {
   lines(): AsyncIterable<string>;
   exited: Promise<{ code: number | null; error: Error | null; stderr: string }>;
   kill(): void;
}

export type CodexLauncher = (spec: CodexSpawn) => CodexChild;

export interface CodexAdapterOptions {
   command?: string;
   launcher?: CodexLauncher;
   principalIsolation?: RuntimePrincipalIsolation;
}

/**
 * Codex on this workstation.
 *
 * The CLI keeps its ChatGPT login. Berry never reads that store and never
 * passes an API key. The process may only call Berry tools; its own shell
 * stays read-only.
 */
export class CodexAgentAdapter implements AgentProcessAdapter {
   readonly identity = {
      id: 'codex',
      name: 'Codex',
      kind: 'agent_process' as const,
      provider: 'OpenAI Codex models',
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
   readonly #launch: CodexLauncher;
   readonly #principalIsolation: RuntimePrincipalIsolation;
   readonly #active = new Map<string, CodexChild>();

   constructor(options: CodexAdapterOptions = {}) {
      this.#command = options.command ?? 'codex';
      this.#launch = options.launcher ?? spawnCodexProcess;
      this.#principalIsolation = options.principalIsolation ?? 'workstation';
   }

   async checkAvailability(): Promise<RuntimeAvailability> {
      if (this.#principalIsolation === 'shared_process') return this.#isolatedAvailability();
      const home = await mkdtemp(join(tmpdir(), 'berry-codex-'));
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
         version: version.slice(0, 80) || 'codex',
         reason: null,
         protocolVersion: 1,
         principalIsolation: this.#principalIsolation,
      };
   }

   async connectionStatus(credential: RuntimeCredential | null): Promise<RuntimeConnectionStatus> {
      this.#assertLogin(credential);
      try {
         const login = await this.#loginStatus();
         if (login === 'chatgpt') {
            return { status: 'connected', accountId: null, accountName: 'ChatGPT', detail: null };
         }
         if (login === 'api_key') {
            return {
               status: 'error',
               accountId: null,
               accountName: null,
               detail: 'Codex CLI is signed in with API billing. Sign in with ChatGPT.',
            };
         }
         return {
            status: 'missing',
            accountId: null,
            accountName: null,
            detail: 'Run `codex login` on this workstation with a ChatGPT account, then connect again.',
         };
      } catch (cause) {
         if (cause instanceof RuntimeAdapterError && cause.code === 'RUNTIME_NOT_INSTALLED') throw cause;
         return {
            status: 'error',
            accountId: credential?.accountId ?? null,
            accountName: credential?.accountName ?? null,
            detail: cause instanceof Error ? cause.message : 'Codex CLI could not report its login.',
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
      if (login === 'missing') {
         throw new RuntimeAdapterError('AUTH_REQUIRED', 'Run `codex login` on this workstation with a ChatGPT account, then connect again.', false);
      }
      if (login === 'api_key') {
         throw new RuntimeAdapterError('AUTH_REQUIRED', 'Codex CLI is signed in with API billing. Sign in with ChatGPT.', false);
      }
      const home = await mkdtemp(join(tmpdir(), 'berry-codex-models-'));
      const child = this.#launch({
         command: this.#command,
         args: ['debug', 'models', '--bundled'],
         cwd: home,
         env: childEnvironment(),
         stdin: '',
      });
      let body = '';
      try {
         for await (const line of child.lines()) body += `${line}\n`;
      } catch (cause) {
         const error = cause as NodeJS.ErrnoException;
         if (error.code === 'ENOENT') throw new RuntimeAdapterError('RUNTIME_NOT_INSTALLED', 'codex is not installed on this workstation.', false);
         throw cause;
      }
      const exit = await child.exited;
      await rm(home, { recursive: true, force: true });
      if (exit.error && (exit.error as NodeJS.ErrnoException).code === 'ENOENT') {
         throw new RuntimeAdapterError('RUNTIME_NOT_INSTALLED', 'codex is not installed on this workstation.', false);
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
         throw new RuntimeAdapterError('RUNTIME_PROTOCOL', 'The Codex task envelope is incomplete.', false);
      }
      this.#assertLogin(input.credential);
      this.#assertIsolated();
      await mkdir(input.stateDirectory, { recursive: true, mode: 0o700 });
      await chmod(input.stateDirectory, 0o700);
      const socketPath = join(process.platform === 'win32' ? tmpdir() : '/tmp', `berry-codex-${randomBytes(8).toString('hex')}.sock`);
      const host = new BerryMcpHost(socketPath, input.tools, input.workingDirectory, input.signal);
      await host.listen();
      const model = runtime.model;
      const args = [
         'exec',
         '--json',
         '--ignore-user-config',
         '--skip-git-repo-check',
         '--sandbox',
         'read-only',
         '--config',
         `mcp_servers.berry.command=${tomlString(process.execPath)}`,
         '--config',
         `mcp_servers.berry.args=${tomlArray(['--experimental-strip-types', BRIDGE, socketPath])}`,
      ];
      if (!resume) args.push('--ephemeral');
      if (model && model !== 'default') args.push('--model', model);
      if (resume) args.push('resume', resume);
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
            const parsed = readEvent(line, model ?? 'codex');
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
            throw new RuntimeAdapterError('RUNTIME_CANCELLED', 'The Codex CLI was stopped.', false);
         }
         if (exit.code !== 0 && text === '') {
            throw new RuntimeAdapterError('RUNTIME_ERROR', exit.stderr || `Codex CLI exited ${exit.code ?? 'without a status'}.`, true);
         }
      } finally {
         input.signal.removeEventListener('abort', stop);
         this.#active.delete(tracked);
         await host.close();
      }
      return { text, sessionId: sessionId || input.envelope.runId };
   }

   async #loginStatus(): Promise<'chatgpt' | 'api_key' | 'missing'> {
      this.#assertIsolated();
      const home = await mkdtemp(join(tmpdir(), 'berry-codex-auth-'));
      const child = this.#launch({
         command: this.#command,
         args: ['login', 'status'],
         cwd: home,
         env: childEnvironment(),
         stdin: '',
      });
      let stdout = '';
      try {
         for await (const line of child.lines()) stdout += `${line}\n`;
      } catch (cause) {
         const error = cause as NodeJS.ErrnoException;
         if (error.code === 'ENOENT') throw new RuntimeAdapterError('RUNTIME_NOT_INSTALLED', 'codex is not installed on this workstation.', false);
         throw cause;
      }
      const exit = await child.exited;
      await rm(home, { recursive: true, force: true });
      if (exit.error && (exit.error as NodeJS.ErrnoException).code === 'ENOENT') {
         throw new RuntimeAdapterError('RUNTIME_NOT_INSTALLED', 'codex is not installed on this workstation.', false);
      }
      const report = `${stdout}\n${exit.stderr}`;
      if (/logged in using chatgpt/i.test(report)) return 'chatgpt';
      if (/api key/i.test(report)) return 'api_key';
      return 'missing';
   }

   #assertLogin(credential: RuntimeCredential | null): asserts credential is RuntimeCredential {
      if (!credential || credential.type !== 'oauth' || credential.token !== CODEX_CLI_LOGIN) {
         throw new RuntimeAdapterError(
            'AUTH_REQUIRED',
            'Connect Codex in AI Runtimes. Berry uses the Codex CLI login on this workstation.',
            false
         );
      }
   }

   #assertIsolated(): void {
      if (this.#principalIsolation === 'shared_process') {
         throw new RuntimeAdapterError('RUNTIME_ISOLATION_REQUIRED', 'Codex runs as its own process on the user workstation.', false);
      }
   }

   #isolatedAvailability(): RuntimeAvailability {
      return {
         available: false,
         version: null,
         reason: 'Codex runs as its own process on the user workstation.',
         protocolVersion: 1,
         principalIsolation: this.#principalIsolation,
      };
   }

   #missing(): RuntimeAvailability {
      return {
         available: false,
         version: null,
         reason: 'codex is not installed on this workstation.',
         protocolVersion: 1,
         principalIsolation: this.#principalIsolation,
      };
   }
}

export function spawnCodexProcess(spec: CodexSpawn): CodexChild {
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
   return env;
}

function promptFor(input: AgentProcessRun): string {
   const transcript = input.envelope.transcript
      .map((message) => `${message.role}: ${message.text}`)
      .join('\n');
   const restored = transcript === '' ? '' : `Conversation restored by Berry before this turn:\n${transcript}\n\n`;
   return `${restored}${input.envelope.agent.instructions}\n\n${input.envelope.task.prompt}`;
}

function tomlString(value: string): string {
   return `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
}

function tomlArray(values: string[]): string {
   return `[${values.map(tomlString).join(',')}]`;
}

function listedModels(body: string): RuntimeModel[] {
   let parsed: unknown;
   try {
      parsed = JSON.parse(body);
   } catch {
      throw new RuntimeAdapterError('RUNTIME_PROTOCOL', 'Codex CLI did not list its models.', true);
   }
   const models = parsed && typeof parsed === 'object' ? (parsed as { models?: unknown }).models : null;
   if (!Array.isArray(models)) {
      throw new RuntimeAdapterError('RUNTIME_PROTOCOL', 'Codex CLI did not list its models.', true);
   }
   const listed: RuntimeModel[] = [];
   for (const entry of models) {
      if (!entry || typeof entry !== 'object') continue;
      const model = entry as Record<string, unknown>;
      if (model.visibility === 'hide') continue;
      if (typeof model.slug !== 'string' || model.slug === '') continue;
      const name = typeof model.display_name === 'string' && model.display_name !== '' ? model.display_name : model.slug;
      const levels = model.supported_reasoning_levels;
      listed.push({
         id: model.slug,
         name,
         reasoning: Array.isArray(levels) ? levels.length > 0 : null,
         tools: true,
         policy: null,
      });
   }
   return listed;
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
   if (record.type === 'thread.started' && typeof record.thread_id === 'string') {
      return { sessionId: record.thread_id, text: '', messages: [], usage: null, failure: null };
   }
   if (record.type === 'error') {
      const message = typeof record.message === 'string' ? record.message : 'Codex CLI did not finish the task.';
      const quota = /quota|rate limit|usage limit/i.test(message);
      return {
         sessionId: null,
         text: '',
         messages: [],
         usage: null,
         failure: { code: quota ? 'QUOTA_EXHAUSTED' : 'RUNTIME_ERROR', message: message.slice(0, 500), retryable: quota },
      };
   }
   if (record.type === 'turn.completed') {
      return { sessionId: null, text: '', messages: [], usage: usageEvent(record.usage, model), failure: null };
   }
   if (record.type !== 'item.completed' && record.type !== 'item.started') return null;
   const item = record.item;
   if (!item || typeof item !== 'object') return null;
   const part = item as Record<string, unknown>;
   const sessionId = null;
   if (part.type === 'agent_message' && typeof part.text === 'string' && part.text !== '' && record.type === 'item.completed') {
      return { sessionId, text: part.text, messages: [], usage: null, failure: null };
   }
   if (part.type === 'mcp_tool_call' && typeof part.id === 'string') {
      const name = typeof part.tool === 'string' ? part.tool : 'tool';
      const message: LifecycleEvent = record.type === 'item.started'
         ? { type: 'task.message', message: { kind: 'tool.started', toolCallId: part.id, name } }
         : { type: 'task.message', message: { kind: 'tool.completed', toolCallId: part.id, succeeded: part.error == null } };
      return { sessionId, text: '', messages: [message], usage: null, failure: null };
   }
   return null;
}

function usageEvent(value: unknown, model: string): LifecycleEvent | null {
   if (!value || typeof value !== 'object') return null;
   const source = value as Record<string, unknown>;
   const whole = (key: string): number => {
      const item = source[key];
      return typeof item === 'number' && Number.isFinite(item) && item >= 0 ? Math.floor(item) : 0;
   };
   const inputTokens = whole('input_tokens');
   const outputTokens = whole('output_tokens');
   const cacheReadTokens = whole('cached_input_tokens');
   if (inputTokens + outputTokens + cacheReadTokens === 0) return null;
   return {
      type: 'task.usage',
      usage: {
         eventId: 'codex-turn',
         model,
         inputTokens,
         outputTokens,
         cacheReadTokens,
         cacheWriteTokens: 0,
         reportedCostMicros: null,
      },
   };
}

function redact(text: string): string {
   return text.replace(/sk-[A-Za-z0-9_-]+/g, '[redacted]');
}
