import { spawn } from 'node:child_process';
import { chmod, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GROK_CLI_LOGIN } from '../../../runtime/envelope.ts';
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
   // Grok's own config home. Inherited so a probe or run finds the user's own
   // subscription login (`$GROK_HOME/auth.json`); Berry never reads that file.
   'GROK_HOME',
] as const;

/**
 * Grok reads its session login and its MCP servers from the same config home
 * (`$GROK_HOME`, default `~/.grok`). Berry needs the login but must not write
 * its own MCP config into either the user's home or the committed checkout.
 * The files Grok owns in that home that a per-run home must still reach:
 * the login and its MCP OAuth tokens. They stay owned by the user; Berry
 * links to them and never reads their bytes.
 */
const LINKED_FROM_REAL_HOME = ['auth.json', 'mcp_credentials.json'] as const;

export interface GrokSpawn {
   command: string;
   args: string[];
   cwd: string;
   env: Record<string, string>;
   stdin: string;
}

export interface GrokChild {
   lines(): AsyncIterable<string>;
   exited: Promise<{ code: number | null; error: Error | null; stderr: string }>;
   kill(): void;
}

export type GrokLauncher = (spec: GrokSpawn) => GrokChild;

export interface GrokAdapterOptions {
   command?: string;
   launcher?: GrokLauncher;
   principalIsolation?: RuntimePrincipalIsolation;
}

/**
 * Grok Build on this workstation.
 *
 * The CLI keeps its own subscription login (`grok login`, stored in
 * `$GROK_HOME/auth.json`). Berry never reads that store and never passes
 * `XAI_API_KEY`: the API key is a distinct, separately billed path, and the
 * child process is spawned without it so the session token stays in control.
 * The process may only call Berry tools over MCP.
 */
export class GrokAgentAdapter implements AgentProcessAdapter {
   readonly identity = {
      id: 'grok',
      name: 'Grok',
      kind: 'agent_process' as const,
      provider: 'xAI Grok models',
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
   readonly #launch: GrokLauncher;
   readonly #principalIsolation: RuntimePrincipalIsolation;
   readonly #active = new Map<string, GrokChild>();

   constructor(options: GrokAdapterOptions = {}) {
      this.#command = options.command ?? 'grok';
      this.#launch = options.launcher ?? spawnGrokProcess;
      this.#principalIsolation = options.principalIsolation ?? 'workstation';
   }

   async checkAvailability(): Promise<RuntimeAvailability> {
      if (this.#principalIsolation === 'shared_process') return this.#isolatedAvailability();
      const home = await mkdtemp(join(tmpdir(), 'berry-grok-'));
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
         version: version.slice(0, 80) || 'grok',
         reason: null,
         protocolVersion: 1,
         principalIsolation: this.#principalIsolation,
      };
   }

   async connectionStatus(credential: RuntimeCredential | null): Promise<RuntimeConnectionStatus> {
      this.#assertLogin(credential);
      try {
         const login = await this.#loginStatus();
         if (login.kind === 'session') {
            return { status: 'connected', accountId: null, accountName: login.accountName ?? 'Grok', detail: null };
         }
         if (login.kind === 'api_key') {
            return {
               status: 'error',
               accountId: null,
               accountName: null,
               detail: 'Grok CLI is using XAI_API_KEY (API billing). Sign in with `grok login` on this workstation.',
            };
         }
         return {
            status: 'missing',
            accountId: null,
            accountName: null,
            detail: 'Run `grok login` on this workstation with a Grok subscription account, then connect again.',
         };
      } catch (cause) {
         if (cause instanceof RuntimeAdapterError && cause.code === 'RUNTIME_NOT_INSTALLED') throw cause;
         return {
            status: 'error',
            accountId: credential?.accountId ?? null,
            accountName: credential?.accountName ?? null,
            detail: cause instanceof Error ? cause.message : 'Grok CLI could not report its login.',
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
      if (login.kind === 'missing') {
         throw new RuntimeAdapterError('AUTH_REQUIRED', 'Run `grok login` on this workstation with a Grok subscription account, then connect again.', false);
      }
      if (login.kind === 'api_key') {
         throw new RuntimeAdapterError('AUTH_REQUIRED', 'Grok CLI is using XAI_API_KEY (API billing). Sign in with `grok login`.', false);
      }
      return login.models;
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
         throw new RuntimeAdapterError('RUNTIME_PROTOCOL', 'The Grok task envelope is incomplete.', false);
      }
      this.#assertLogin(input.credential);
      this.#assertIsolated();
      await mkdir(input.stateDirectory, { recursive: true, mode: 0o700 });
      await chmod(input.stateDirectory, 0o700);
      const socketPath = join(process.platform === 'win32' ? tmpdir() : '/tmp', `berry-grok-${randomSuffix()}.sock`);
      const host = new BerryMcpHost(socketPath, input.tools, input.workingDirectory, input.signal);
      await host.listen();
      // Grok reads MCP servers only from a `config.toml` in the cwd, the git
      // root, or `$GROK_HOME`. Writing one into the working directory would put
      // the socket path and bridge command into the tree Berry commits, so
      // Berry builds a private `$GROK_HOME` under the run's state directory
      // instead: Berry's MCP server is written there, and the user's own login
      // files are linked in so the CLI keeps its subscription session. Berry
      // never reads those files.
      const grokHome = join(input.stateDirectory, 'grok-home');
      await this.#prepareHome(grokHome, socketPath);
      // The prompt can be large; `-p` would overflow the argv limit, and Grok
      // does not read a piped prompt from stdin, so pass it as a file.
      const promptPath = join(input.stateDirectory, 'prompt.txt');
      await writeFile(promptPath, promptFor(input));
      const model = runtime.model;
      const args = [
         '--prompt-file',
         promptPath,
         '--output-format',
         'streaming-json',
         '--no-auto-update',
         '--cwd',
         input.workingDirectory,
         // Writable checkout: read everywhere, write the working directory and
         // temp. This is Grok's recommended development profile.
         '--sandbox',
         'workspace',
         // Remove Grok's own web tools; repository work goes through Berry's
         // admitted tools over MCP. (Tool ids are Grok internal names.)
         '--disallowed-tools',
         'web_search,web_fetch',
         // Auto-approve tool calls: the run is unattended and Berry already
         // gates which tools exist.
         '--permission-mode',
         'bypassPermissions',
      ];
      if (model && model !== 'default') args.push('--model', model);
      if (resume) args.push('--resume', resume);
      const child = this.#launch({
         command: this.#command,
         args,
         cwd: input.workingDirectory,
         env: childEnvironment(grokHome),
         stdin: '',
      });
      const tracked = resume ?? input.envelope.runId;
      this.#active.set(tracked, child);
      let text = '';
      let sessionId = resume ?? '';
      const stop = () => child.kill();
      input.signal.addEventListener('abort', stop, { once: true });
      try {
         for await (const line of child.lines()) {
            const parsed = readEvent(line, model ?? 'grok');
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
            throw new RuntimeAdapterError('RUNTIME_CANCELLED', 'The Grok CLI was stopped.', false);
         }
         if (exit.code !== 0 && text === '') {
            throw new RuntimeAdapterError('RUNTIME_ERROR', exit.stderr || `Grok CLI exited ${exit.code ?? 'without a status'}.`, true);
         }
      } finally {
         input.signal.removeEventListener('abort', stop);
         this.#active.delete(tracked);
         await host.close();
      }
      return { text, sessionId: sessionId || input.envelope.runId };
   }

   /**
    * Builds a private `$GROK_HOME` for one run: Berry's MCP server config, and
    * symlinks to the user's own login files in the real home. The links point
    * at files owned by the user; Berry does not open or copy them, so the
    * credential never enters Berry's memory or the checkout.
    */
   async #prepareHome(grokHome: string, socketPath: string): Promise<void> {
      await rm(grokHome, { recursive: true, force: true });
      await mkdir(grokHome, { recursive: true, mode: 0o700 });
      const realHome = realGrokHome();
      for (const name of LINKED_FROM_REAL_HOME) {
         await symlink(join(realHome, name), join(grokHome, name)).catch(() => undefined);
      }
      const argv = tomlArray([process.execPath, '--experimental-strip-types', BRIDGE, socketPath]);
      // `[mcp_servers]` is read from this private home. The session login lives
      // in the symlinked `auth.json`, not in `config.toml`, so a Berry-only
      // config.toml here does not drop the user's login.
      const toml = `[mcp_servers.berry]\ncommand = ${tomlString(process.execPath)}\nargs = ${argv}\nenabled = true\n`;
      await writeFile(join(grokHome, 'config.toml'), toml);
   }

   async #loginStatus(): Promise<
      | { kind: 'session'; accountName: string | null; models: RuntimeModel[] }
      | { kind: 'api_key' }
      | { kind: 'missing' }
   > {
      this.#assertIsolated();
      // Berry never passes XAI_API_KEY, so a `grok models` that succeeds here
      // proves a CLI-owned session login — the official plugin uses the same
      // "soft auth via `grok models`" probe. An API key present in the
      // ambient environment is treated as API billing and refused.
      if (apiKeyInEnvironment()) return { kind: 'api_key' };
      // `grok models` lists models and, because Berry passes no API key, only
      // succeeds when a CLI-owned session login is active. It takes no --json
      // flag (unlike `grok inspect`/`grok mcp list`), so Berry parses whatever
      // the subcommand prints and never passes an unsupported flag that would
      // make a signed-in account look signed out.
      const child = this.#launch({
         command: this.#command,
         args: ['models'],
         cwd: realGrokHome(),
         env: childEnvironment(),
         stdin: '',
      });
      let body = '';
      try {
         for await (const line of child.lines()) body += `${line}\n`;
      } catch (cause) {
         const error = cause as NodeJS.ErrnoException;
         if (error.code === 'ENOENT') throw new RuntimeAdapterError('RUNTIME_NOT_INSTALLED', 'grok is not installed on this workstation.', false);
         throw cause;
      }
      const exit = await child.exited;
      if (exit.error && (exit.error as NodeJS.ErrnoException).code === 'ENOENT') {
         throw new RuntimeAdapterError('RUNTIME_NOT_INSTALLED', 'grok is not installed on this workstation.', false);
      }
      // `grok models` exits non-zero when no session is active, directing the
      // user to sign in. Treat any non-zero exit as not signed in rather than
      // guessing a model list.
      if (exit.code !== 0) return { kind: 'missing' };
      return { kind: 'session', accountName: null, models: listedModels(body) };
   }

   #assertLogin(credential: RuntimeCredential | null): asserts credential is RuntimeCredential {
      if (!credential || credential.type !== 'oauth' || credential.token !== GROK_CLI_LOGIN) {
         throw new RuntimeAdapterError(
            'AUTH_REQUIRED',
            'Connect Grok in AI Runtimes. Berry uses the Grok CLI login on this workstation.',
            false
         );
      }
   }

   #assertIsolated(): void {
      if (this.#principalIsolation === 'shared_process') {
         throw new RuntimeAdapterError('RUNTIME_ISOLATION_REQUIRED', 'Grok runs as its own process on the user workstation.', false);
      }
   }

   #isolatedAvailability(): RuntimeAvailability {
      return {
         available: false,
         version: null,
         reason: 'Grok runs as its own process on the user workstation.',
         protocolVersion: 1,
         principalIsolation: this.#principalIsolation,
      };
   }

   #missing(): RuntimeAvailability {
      return {
         available: false,
         version: null,
         reason: 'grok is not installed on this workstation.',
         protocolVersion: 1,
         principalIsolation: this.#principalIsolation,
      };
   }
}

export function spawnGrokProcess(spec: GrokSpawn): GrokChild {
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

function realGrokHome(): string {
   const configured = process.env.GROK_HOME;
   if (typeof configured === 'string' && configured.trim() !== '') return configured;
   return join(homedir(), '.grok');
}

function childEnvironment(grokHome?: string): Record<string, string> {
   const env: Record<string, string> = {};
   for (const name of INHERITED) {
      const value = process.env[name];
      if (value) env[name] = value;
   }
   // Never forward an API key: the subscription session login must own the run.
   delete env.XAI_API_KEY;
   // A run points Grok at the private per-run home that holds Berry's MCP
   // config and the symlinked login. A probe leaves GROK_HOME as inherited.
   if (grokHome !== undefined) env.GROK_HOME = grokHome;
   return env;
}

function apiKeyInEnvironment(): boolean {
   const key = process.env.XAI_API_KEY;
   return typeof key === 'string' && key.trim() !== '';
}

function randomSuffix(): string {
   return `${process.pid.toString(36)}-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`;
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
   return `[${values.map(tomlString).join(', ')}]`;
}

/** Grok's default model when the list cannot be parsed; the run keeps the CLI's own default. */
const DEFAULT_MODEL: RuntimeModel = { id: 'default', name: 'Grok (CLI default)', reasoning: null, tools: true, policy: null };

/**
 * Parses the output of `grok models`. The subcommand's format is not a
 * documented machine contract, so Berry reads JSON when it is given JSON and
 * otherwise reads one model id per line. Either way a signed-in account with
 * no parseable list still gets a usable `default` entry rather than none.
 */
function listedModels(body: string): RuntimeModel[] {
   const fromJson = modelsFromJson(body);
   if (fromJson.length > 0) return fromJson;
   const fromLines = modelsFromLines(body);
   if (fromLines.length > 0) return fromLines;
   return [DEFAULT_MODEL];
}

function modelsFromJson(body: string): RuntimeModel[] {
   let parsed: unknown;
   try {
      parsed = JSON.parse(body);
   } catch {
      return [];
   }
   const rows = Array.isArray(parsed)
      ? parsed
      : parsed && typeof parsed === 'object' && Array.isArray((parsed as { models?: unknown }).models)
        ? ((parsed as { models?: unknown }).models as unknown[])
        : [];
   const listed: RuntimeModel[] = [];
   for (const entry of rows) {
      if (!entry || typeof entry !== 'object') continue;
      const model = entry as Record<string, unknown>;
      const id =
         typeof model.id === 'string' && model.id !== ''
            ? model.id
            : typeof model.name === 'string' && model.name !== ''
              ? model.name
              : typeof model.slug === 'string' && model.slug !== ''
                ? model.slug
                : '';
      if (id === '') continue;
      const name =
         typeof model.display_name === 'string' && model.display_name !== ''
            ? model.display_name
            : typeof model.name === 'string' && model.name !== ''
              ? model.name
              : id;
      listed.push({ id, name, reasoning: null, tools: true, policy: null });
   }
   return listed;
}

function modelsFromLines(body: string): RuntimeModel[] {
   const listed: RuntimeModel[] = [];
   const seen = new Set<string>();
   for (const raw of body.split('\n')) {
      // Take the first word-like token on each line and keep plausible model
      // ids. A heading or a decorative row contributes nothing.
      const line = raw.replace(/^[\s*\-•\u2022]+/, '').trim();
      const token = line.split(/[\s,]+/)[0] ?? '';
      if (!/^[A-Za-z][A-Za-z0-9._:-]{1,80}$/.test(token)) continue;
      if (!token.toLowerCase().includes('grok')) continue;
      if (seen.has(token)) continue;
      seen.add(token);
      listed.push({ id: token, name: token, reasoning: null, tools: true, policy: null });
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

/**
 * Grok's `streaming-json` is newline-delimited, one type-tagged object per
 * line, derived from the agent's ACP session updates: `text`, `thought`,
 * `tool_call`, `tool_call_update`, `usage`, `end`, `error`.
 */
function readEvent(line: string, model: string): ParsedLine | null {
   let parsed: unknown;
   try {
      parsed = JSON.parse(line);
   } catch {
      return null;
   }
   if (!parsed || typeof parsed !== 'object') return null;
   const record = parsed as Record<string, unknown>;
   const type = record.type;
   if (type === 'text') {
      const data = typeof record.data === 'string' ? record.data : '';
      return data === '' ? null : { sessionId: null, text: data, messages: [], usage: null, failure: null };
   }
   if (type === 'tool_call' && typeof record.toolCallId === 'string') {
      const name =
         typeof record.toolName === 'string'
            ? record.toolName
            : typeof record.title === 'string'
              ? record.title
              : 'tool';
      return {
         sessionId: null,
         text: '',
         messages: [{ type: 'task.message', message: { kind: 'tool.started', toolCallId: record.toolCallId, name } }],
         usage: null,
         failure: null,
      };
   }
   if (type === 'tool_call_update' && typeof record.toolCallId === 'string') {
      const status = typeof record.status === 'string' ? record.status : '';
      if (status !== 'completed' && status !== 'failed' && status !== 'error') return null;
      return {
         sessionId: null,
         text: '',
         messages: [
            {
               type: 'task.message',
               message: { kind: 'tool.completed', toolCallId: record.toolCallId, succeeded: status === 'completed' },
            },
         ],
         usage: null,
         failure: null,
      };
   }
   if (type === 'usage') {
      return { sessionId: null, text: '', messages: [], usage: usageEvent(record.usage, model), failure: null };
   }
   if (type === 'end') {
      const sessionId = typeof record.sessionId === 'string' ? record.sessionId : null;
      return { sessionId, text: '', messages: [], usage: usageEvent(record.usage, model), failure: null };
   }
   if (type === 'error') {
      const message = typeof record.message === 'string' ? record.message : 'Grok CLI did not finish the task.';
      const quota = /quota|rate limit|usage limit|insufficient/i.test(message);
      return {
         sessionId: null,
         text: '',
         messages: [],
         usage: null,
         failure: { code: quota ? 'QUOTA_EXHAUSTED' : 'RUNTIME_ERROR', message: message.slice(0, 500), retryable: quota },
      };
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
   const cacheReadTokens = whole('cache_read_input_tokens');
   const cacheWriteTokens = whole('cache_creation_input_tokens');
   if (inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens === 0) return null;
   return {
      type: 'task.usage',
      usage: {
         eventId: 'grok-response',
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
   return text.replace(/xai-[A-Za-z0-9_-]+/g, '[redacted]');
}
