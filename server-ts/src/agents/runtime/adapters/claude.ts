import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CLAUDE_CLI_LOGIN } from '../../../runtime/envelope.ts';
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

/** Aliases `claude --model` accepts. The CLI maps each one to its current model. */
const MODELS: readonly RuntimeModel[] = [
   { id: 'sonnet', name: 'Sonnet', reasoning: null, tools: true, policy: null },
   { id: 'opus', name: 'Opus', reasoning: null, tools: true, policy: null },
   { id: 'haiku', name: 'Haiku', reasoning: null, tools: true, policy: null },
];

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

export interface ClaudeSpawn {
   command: string;
   args: string[];
   cwd: string;
   env: Record<string, string>;
   stdin: string;
}

export interface ClaudeChild {
   lines(): AsyncIterable<string>;
   exited: Promise<{ code: number | null; error: Error | null; stderr: string }>;
   kill(): void;
}

export type ClaudeLauncher = (spec: ClaudeSpawn) => ClaudeChild;

export interface ClaudeAdapterOptions {
   command?: string;
   launcher?: ClaudeLauncher;
   principalIsolation?: RuntimePrincipalIsolation;
}

interface AuthStatus {
   loggedIn: boolean;
   authMethod: string;
   accountId: string | null;
   accountName: string | null;
}

/**
 * Claude Code on this workstation.
 *
 * The CLI keeps its own login. Berry never reads that store and never passes
 * an API key. Built-in shell and file tools stay off. Berry tools are the
 * only MCP server the process may call.
 */
export class ClaudeAgentAdapter implements AgentProcessAdapter {
   readonly identity = {
      id: 'claude',
      name: 'Claude',
      kind: 'agent_process' as const,
      provider: 'Anthropic Claude',
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
   readonly #launch: ClaudeLauncher;
   readonly #principalIsolation: RuntimePrincipalIsolation;
   readonly #active = new Map<string, ClaudeChild>();

   constructor(options: ClaudeAdapterOptions = {}) {
      this.#command = options.command ?? 'claude';
      this.#launch = options.launcher ?? spawnClaudeProcess;
      this.#principalIsolation = options.principalIsolation ?? 'workstation';
   }

   async checkAvailability(): Promise<RuntimeAvailability> {
      if (this.#principalIsolation === 'shared_process') return this.#isolatedAvailability();
      const home = await mkdtemp(join(tmpdir(), 'berry-claude-'));
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
         version: version.slice(0, 80) || 'claude',
         reason: null,
         protocolVersion: 1,
         principalIsolation: this.#principalIsolation,
      };
   }

   async connectionStatus(credential: RuntimeCredential | null): Promise<RuntimeConnectionStatus> {
      this.#assertLogin(credential);
      try {
         const status = await this.#authStatus();
         if (!status.loggedIn) {
            return {
               status: 'missing',
               accountId: null,
               accountName: null,
               detail: 'Run `claude auth login` on this workstation, then connect again.',
            };
         }
         if (status.authMethod !== '' && status.authMethod !== 'claude.ai') {
            return {
               status: 'error',
               accountId: status.accountId,
               accountName: status.accountName,
               detail: 'Claude CLI is signed in with API billing. Sign in with a Claude subscription.',
            };
         }
         return {
            status: 'connected',
            accountId: status.accountId,
            accountName: status.accountName ?? 'Claude',
            detail: null,
         };
      } catch (cause) {
         if (cause instanceof RuntimeAdapterError && cause.code === 'RUNTIME_NOT_INSTALLED') throw cause;
         return {
            status: 'error',
            accountId: credential?.accountId ?? null,
            accountName: credential?.accountName ?? null,
            detail: cause instanceof Error ? cause.message : 'Claude CLI could not report its login.',
         };
      }
   }

   async disconnect(): Promise<void> {
      for (const child of this.#active.values()) child.kill();
      this.#active.clear();
   }

   async discoverModels(credential: RuntimeCredential): Promise<RuntimeModel[]> {
      this.#assertLogin(credential);
      const status = await this.#authStatus();
      if (!status.loggedIn) {
         throw new RuntimeAdapterError('AUTH_REQUIRED', 'Run `claude auth login` on this workstation, then connect again.', false);
      }
      if (status.authMethod !== '' && status.authMethod !== 'claude.ai') {
         throw new RuntimeAdapterError('AUTH_REQUIRED', 'Claude CLI is signed in with API billing. Sign in with a Claude subscription.', false);
      }
      return [...MODELS];
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
         throw new RuntimeAdapterError('RUNTIME_PROTOCOL', 'The Claude task envelope is incomplete.', false);
      }
      this.#assertLogin(input.credential);
      this.#assertIsolated();
      await mkdir(input.stateDirectory, { recursive: true, mode: 0o700 });
      await chmod(input.stateDirectory, 0o700);
      const socketPath = join(process.platform === 'win32' ? tmpdir() : '/tmp', `berry-claude-${randomBytes(8).toString('hex')}.sock`);
      const host = new BerryMcpHost(socketPath, input.tools, input.workingDirectory, input.signal);
      await host.listen();
      const configPath = join(input.stateDirectory, 'mcp.json');
      const instructionsPath = join(input.stateDirectory, 'instructions.txt');
      await writeFile(
         configPath,
         `${JSON.stringify({
            mcpServers: {
               berry: {
                  command: process.execPath,
                  args: ['--experimental-strip-types', BRIDGE, socketPath],
               },
            },
         })}\n`
      );
      await writeFile(instructionsPath, input.envelope.agent.instructions);
      const model = runtime.model;
      const args = [
         '-p',
         '--output-format',
         'stream-json',
         '--verbose',
         '--tools',
         '',
         '--strict-mcp-config',
         '--mcp-config',
         configPath,
         '--permission-mode',
         'dontAsk',
         '--append-system-prompt-file',
         instructionsPath,
         ...input.tools.flatMap((tool) => ['--allowedTools', `mcp__berry__${tool.name}`]),
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
            const parsed = readEvent(line, model ?? 'claude');
            if (!parsed) continue;
            if (parsed.sessionId) sessionId = parsed.sessionId;
            if (parsed.text) {
               text += parsed.text;
               input.emit({ type: 'task.message', message: { kind: 'output', channel: 'assistant', text: parsed.text } });
            }
            if (parsed.finalText !== null) {
               if (text === '') {
                  input.emit({ type: 'task.message', message: { kind: 'output', channel: 'assistant', text: parsed.finalText } });
               }
               text = parsed.finalText;
            }
            for (const message of parsed.messages) input.emit(message);
            if (parsed.usage) input.emit(parsed.usage);
            if (parsed.failure) throw new RuntimeAdapterError(parsed.failure.code, parsed.failure.message, parsed.failure.retryable);
         }
         const exit = await child.exited;
         if (input.signal.aborted) {
            throw new RuntimeAdapterError('RUNTIME_CANCELLED', 'The Claude CLI was stopped.', false);
         }
         if (exit.code !== 0 && text === '') {
            throw new RuntimeAdapterError('RUNTIME_ERROR', exit.stderr || `Claude CLI exited ${exit.code ?? 'without a status'}.`, true);
         }
      } finally {
         input.signal.removeEventListener('abort', stop);
         this.#active.delete(tracked);
         await host.close();
      }
      return { text, sessionId: sessionId || input.envelope.runId };
   }

   async #authStatus(): Promise<AuthStatus> {
      this.#assertIsolated();
      const home = await mkdtemp(join(tmpdir(), 'berry-claude-auth-'));
      const child = this.#launch({
         command: this.#command,
         args: ['auth', 'status', '--json'],
         cwd: home,
         env: childEnvironment(),
         stdin: '',
      });
      let body = '';
      try {
         for await (const line of child.lines()) body += `${line}\n`;
      } catch (cause) {
         const error = cause as NodeJS.ErrnoException;
         if (error.code === 'ENOENT') throw new RuntimeAdapterError('RUNTIME_NOT_INSTALLED', 'claude is not installed on this workstation.', false);
         throw cause;
      }
      const exit = await child.exited;
      await rm(home, { recursive: true, force: true });
      if (exit.error && (exit.error as NodeJS.ErrnoException).code === 'ENOENT') {
         throw new RuntimeAdapterError('RUNTIME_NOT_INSTALLED', 'claude is not installed on this workstation.', false);
      }
      let parsed: unknown;
      try {
         parsed = JSON.parse(body.trim());
      } catch {
         throw new RuntimeAdapterError('RUNTIME_PROTOCOL', 'Claude CLI did not report its login.', true);
      }
      if (!parsed || typeof parsed !== 'object') {
         throw new RuntimeAdapterError('RUNTIME_PROTOCOL', 'Claude CLI did not report its login.', true);
      }
      const record = parsed as Record<string, unknown>;
      return {
         loggedIn: record.loggedIn === true,
         authMethod: typeof record.authMethod === 'string' ? record.authMethod : '',
         accountId: typeof record.orgId === 'string' && record.orgId !== '' ? record.orgId : null,
         accountName: typeof record.orgName === 'string' && record.orgName !== '' ? record.orgName : null,
      };
   }

   #assertLogin(credential: RuntimeCredential | null): asserts credential is RuntimeCredential {
      if (!credential || credential.type !== 'oauth' || credential.token !== CLAUDE_CLI_LOGIN) {
         throw new RuntimeAdapterError(
            'AUTH_REQUIRED',
            'Connect Claude in AI Runtimes. Berry uses the Claude CLI login on this workstation.',
            false
         );
      }
   }

   #assertIsolated(): void {
      if (this.#principalIsolation === 'shared_process') {
         throw new RuntimeAdapterError('RUNTIME_ISOLATION_REQUIRED', 'Claude runs as its own process on the user workstation.', false);
      }
   }

   #isolatedAvailability(): RuntimeAvailability {
      return {
         available: false,
         version: null,
         reason: 'Claude runs as its own process on the user workstation.',
         protocolVersion: 1,
         principalIsolation: this.#principalIsolation,
      };
   }

   #missing(): RuntimeAvailability {
      return {
         available: false,
         version: null,
         reason: 'claude is not installed on this workstation.',
         protocolVersion: 1,
         principalIsolation: this.#principalIsolation,
      };
   }
}

export function spawnClaudeProcess(spec: ClaudeSpawn): ClaudeChild {
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
   return `${restored}${input.envelope.task.prompt}`;
}

interface ParsedLine {
   sessionId: string | null;
   text: string;
   /** The CLI's final answer. Null until the result event. */
   finalText: string | null;
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
   const sessionId = typeof record.session_id === 'string' ? record.session_id : null;
   if (record.type === 'result') {
      const subtype = typeof record.subtype === 'string' ? record.subtype : '';
      const usage = usageEvent(record.usage, typeof record.model === 'string' ? record.model : model);
      const resultText = typeof record.result === 'string' ? record.result : '';
      if (subtype !== 'success' || record.is_error === true) {
         const message = resultText !== '' ? resultText : 'Claude CLI did not finish the task.';
         const quota = /quota|rate limit|usage limit/i.test(message);
         return {
            sessionId,
            text: '',
            finalText: null,
            messages: [],
            usage,
            failure: { code: quota ? 'QUOTA_EXHAUSTED' : 'RUNTIME_ERROR', message: message.slice(0, 500), retryable: quota },
         };
      }
      return { sessionId, text: '', finalText: resultText, messages: [], usage, failure: null };
   }
   if (record.type !== 'assistant' && record.type !== 'user') {
      return { sessionId, text: '', finalText: null, messages: [], usage: null, failure: null };
   }
   const message = record.message;
   if (!message || typeof message !== 'object') {
      return { sessionId, text: '', finalText: null, messages: [], usage: null, failure: null };
   }
   const content = (message as { content?: unknown }).content;
   const blocks = Array.isArray(content) ? content : [];
   let text = '';
   const messages: LifecycleEvent[] = [];
   for (const block of blocks) {
      if (!block || typeof block !== 'object') continue;
      const part = block as Record<string, unknown>;
      if (part.type === 'text' && typeof part.text === 'string' && part.text !== '') text += part.text;
      if (part.type === 'tool_use' && typeof part.id === 'string' && typeof part.name === 'string') {
         messages.push({ type: 'task.message', message: { kind: 'tool.started', toolCallId: part.id, name: part.name } });
      }
      if (part.type === 'tool_result' && typeof part.tool_use_id === 'string') {
         messages.push({
            type: 'task.message',
            message: { kind: 'tool.completed', toolCallId: part.tool_use_id, succeeded: part.is_error !== true },
         });
      }
   }
   return { sessionId, text, finalText: null, messages, usage: null, failure: null };
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
   const cacheReadTokens = whole('cache_read_input_tokens');
   const cacheWriteTokens = whole('cache_creation_input_tokens');
   if (inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens === 0) return null;
   return {
      type: 'task.usage',
      usage: {
         eventId: 'claude-prompt',
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
   return text.replace(/sk-ant-[A-Za-z0-9_-]+/g, '[redacted]');
}
