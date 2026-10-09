import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { RuntimeAdapterError } from './types.ts';

/**
 * Newline-delimited JSON-RPC to `kiro-cli acp --agent-engine=v3`.
 *
 * The CLI asks this process for the user's access token. The reply is written
 * to the CLI's stdin and nowhere else.
 */

export interface KiroSpawn {
   command: string;
   args: string[];
   cwd: string;
   env: Record<string, string>;
}

export interface KiroChild {
   write(line: string): void;
   lines(): AsyncIterable<string>;
   errors(): AsyncIterable<string>;
   kill(): void;
   readonly exited: Promise<{ code: number | null; error: Error | null }>;
}

interface Pending {
   resolve: (value: unknown) => void;
   reject: (error: Error) => void;
   timer: ReturnType<typeof setTimeout>;
}

interface JsonRpc {
   jsonrpc?: string;
   id?: number;
   method?: string;
   params?: unknown;
   result?: unknown;
   error?: { code?: number; message?: string };
}

export function spawnKiroProcess(spec: KiroSpawn): KiroChild {
   const child = spawn(spec.command, spec.args, {
      cwd: spec.cwd,
      env: spec.env,
      stdio: ['pipe', 'pipe', 'pipe'],
   });
   let spawnError: Error | null = null;
   const exited = new Promise<{ code: number | null; error: Error | null }>((resolve) => {
      child.once('error', (error) => {
         spawnError = error;
         resolve({ code: null, error });
      });
      child.once('exit', (code) => resolve({ code, error: spawnError }));
   });
   const stdout = createInterface({ input: child.stdout });
   const stderr = createInterface({ input: child.stderr });
   return {
      write(line: string) {
         child.stdin.write(line.endsWith('\n') ? line : `${line}\n`);
      },
      lines: () => stdout,
      errors: () => stderr,
      kill() {
         child.kill('SIGKILL');
      },
      exited,
   };
}

export interface KiroAcpHandlers {
   onUpdate: (params: unknown) => void;
   onPermission: (params: unknown) => unknown;
}

export class KiroAcpClient {
   readonly #child: KiroChild;
   readonly #token: string;
   readonly handlers: KiroAcpHandlers;
   readonly #pending = new Map<number, Pending>();
   #nextId = 0;
   #closed = false;
   #stderr = '';
   #reading: Promise<void> = Promise.resolve();

   constructor(child: KiroChild, token: string, handlers: KiroAcpHandlers) {
      this.#child = child;
      this.#token = token;
      this.handlers = handlers;
   }

   start(): void {
      this.#reading = this.#pump();
      void this.#collectErrors();
   }

   stderr(): string {
      return redactSecret(this.#stderr, this.#token);
   }

   request(method: string, params: unknown, timeoutMs: number): Promise<unknown> {
      const id = ++this.#nextId;
      return new Promise((resolve, reject) => {
         const timer = setTimeout(() => {
            this.#pending.delete(id);
            reject(new RuntimeAdapterError('RUNTIME_TIMEOUT', 'Kiro CLI did not answer before the runtime timeout.', true));
         }, timeoutMs);
         timer.unref?.();
         this.#pending.set(id, { resolve, reject, timer });
         this.#write({ jsonrpc: '2.0', id, method, params });
      });
   }

   notify(method: string, params: unknown): void {
      this.#write({ jsonrpc: '2.0', method, params });
   }

   async close(): Promise<void> {
      if (this.#closed) return;
      this.#closed = true;
      this.#failPending(new RuntimeAdapterError('RUNTIME_CANCELLED', 'The Kiro run was closed.', false));
      this.#child.kill();
      await this.#reading.catch(() => undefined);
      await this.#child.exited.catch(() => undefined);
   }

   #write(message: JsonRpc): void {
      this.#child.write(JSON.stringify(message));
   }

   async #collectErrors(): Promise<void> {
      try {
         for await (const line of this.#child.errors()) {
            this.#stderr = `${this.#stderr}${line}\n`.slice(-2000);
         }
      } catch {
         // The process is gone. The stdout pump reports that.
      }
   }

   async #pump(): Promise<void> {
      try {
         for await (const line of this.#child.lines()) {
            const trimmed = line.trim();
            if (trimmed === '') continue;
            let message: JsonRpc;
            try {
               message = JSON.parse(trimmed) as JsonRpc;
            } catch {
               continue;
            }
            this.#dispatch(message);
         }
      } finally {
         if (!this.#closed) {
            const exit = await Promise.race([
               this.#child.exited,
               new Promise<null>((resolve) => setTimeout(() => resolve(null), 20)),
            ]);
            const missing = exit?.error && (exit.error as NodeJS.ErrnoException).code === 'ENOENT';
            const detail = this.stderr().trim();
            this.#failPending(
               missing
                  ? new RuntimeAdapterError('RUNTIME_NOT_INSTALLED', 'kiro-cli is not installed on this workstation.', false)
                  : new RuntimeAdapterError(
                       'RUNTIME_ERROR',
                       detail !== '' ? detail.slice(0, 300) : 'Kiro CLI closed the ACP connection.',
                       true
                    )
            );
         }
      }
   }

   #dispatch(message: JsonRpc): void {
      if (message.method && message.id !== undefined) {
         const answer = this.#answer(message.method, message.params);
         this.#write({ jsonrpc: '2.0', id: message.id, ...answer });
         return;
      }
      if (message.id !== undefined && (message.result !== undefined || message.error !== undefined)) {
         const pending = this.#pending.get(message.id);
         if (!pending) return;
         this.#pending.delete(message.id);
         clearTimeout(pending.timer);
         if (message.error) pending.reject(failureFromRpc(message.error, this.stderr()));
         else pending.resolve(message.result);
         return;
      }
      if (message.method === 'session/update') this.handlers.onUpdate(message.params);
   }

   #answer(method: string, params: unknown): { result: unknown } | { error: { code: number; message: string } } {
      if (method === '_kiro/auth/getAccessToken') return { result: { accessToken: this.#token } };
      if (method === 'session/request_permission') return { result: this.handlers.onPermission(params) };
      return { error: { code: -32601, message: 'Method not supported' } };
   }

   #failPending(error: Error): void {
      for (const [id, pending] of this.#pending) {
         clearTimeout(pending.timer);
         pending.reject(error);
         this.#pending.delete(id);
      }
   }
}

export function redactSecret(text: string, secret: string): string {
   if (secret === '') return text;
   return text.split(secret).join('[redacted]');
}

function failureFromRpc(error: { code?: number; message?: string }, stderr: string): RuntimeAdapterError {
   if (error.code === -32601) {
      return new RuntimeAdapterError('RUNTIME_PROTOCOL', 'Kiro CLI does not support that ACP method.', false);
   }
   return classifyKiroText(redactSecret(`${error.message ?? ''} ${stderr}`, ''));
}

export function classifyKiroText(text: string): RuntimeAdapterError {
   const lower = text.toLowerCase();
   if (lower.includes('quota') || lower.includes('rate limit') || lower.includes('rate_limit')) {
      return new RuntimeAdapterError(
         'QUOTA_EXHAUSTED',
         'This Kiro subscription has reached its current usage limit. Check the account limit and reset time before retrying.',
         false
      );
   }
   if (
      lower.includes('unauthorized') ||
      lower.includes('unauthenticated') ||
      lower.includes('authentication') ||
      lower.includes('invalid token') ||
      lower.includes('token expired')
   ) {
      return new RuntimeAdapterError(
         'AUTH_EXPIRED',
         'Kiro could not authenticate this API key. Reconnect it in AI Runtimes settings.',
         false
      );
   }
   if (lower.includes('model') && (lower.includes('unavailable') || lower.includes('not found') || lower.includes('unknown'))) {
      return new RuntimeAdapterError(
         'MODEL_UNAVAILABLE',
         'The selected Kiro model is unavailable for this account. Choose another model from the live list.',
         false
      );
   }
   if (lower.includes('enoent') || (lower.includes('kiro-cli') && lower.includes('not found'))) {
      return new RuntimeAdapterError('RUNTIME_NOT_INSTALLED', 'kiro-cli is not installed on this workstation.', false);
   }
   if (lower.includes('timeout') || lower.includes('timed out')) {
      return new RuntimeAdapterError('RUNTIME_TIMEOUT', 'Kiro CLI did not finish before the runtime timeout.', true);
   }
   if (lower.includes('network') || lower.includes('econn') || lower.includes('socket')) {
      return new RuntimeAdapterError('NETWORK_ERROR', 'Kiro CLI could not be reached. Check runtime egress and retry.', true);
   }
   return new RuntimeAdapterError(
      'RUNTIME_ERROR',
      'Kiro CLI could not complete the task. Check the runtime logs for a credential-redacted diagnostic.',
      true
   );
}
