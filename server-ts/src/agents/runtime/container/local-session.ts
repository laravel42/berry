import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';
import type {
   ExecEvent,
   ExecOptions,
   ExecResult,
   ExecutionSession,
} from '../../../execution/driver.ts';

/**
 * The run's workspace, as the container's own shell.
 *
 * The loop now runs beside its tools, so a command is a child process rather
 * than an `InvokeAgentRuntimeCommand` round trip. It implements the same
 * `ExecutionSession` seam, which is why `checkout`, `commitAndPush`, `verify`
 * and `run_command` work here unchanged.
 */
export class LocalSession implements ExecutionSession {
   readonly id: string;
   readonly root: string;
   readonly #env: Record<string, string>;
   readonly #signal: AbortSignal | undefined;
   readonly #groups = new Set<number>();

   constructor(options: { id: string; root: string; env?: Record<string, string>; signal?: AbortSignal }) {
      this.id = options.id;
      this.root = options.root;
      this.#env = options.env ?? {};
      this.#signal = options.signal;
   }

   async exec(command: string, options: ExecOptions = {}): Promise<ExecResult> {
      let stdout = '';
      let stderr = '';
      let exitCode = 0;
      for await (const event of this.stream(command, options)) {
         if (event.type === 'stdout') stdout += event.data;
         else if (event.type === 'stderr') stderr += event.data;
         else if (event.type === 'exit') exitCode = event.exitCode;
         else if (event.type === 'error') {
            stderr += event.message;
            exitCode = exitCode === 0 ? 1 : exitCode;
         }
      }
      return { stdout, stderr, exitCode };
   }

   async *stream(command: string, options: ExecOptions = {}): AsyncIterable<ExecEvent> {
      const signals = [this.#signal, options.signal].filter((value): value is AbortSignal => value !== undefined);
      const signal = AbortSignal.any(signals);
      signal.throwIfAborted();
      let seq = 0;
      yield { type: 'start', seq: seq++, command };
      const cwd = this.#path(options.cwd ?? '.');
      await mkdir(cwd, { recursive: true });

      const queue: ExecEvent[] = [];
      let done = false;
      let wake: (() => void) | null = null;
      const push = (event: ExecEvent) => {
         queue.push(event);
         wake?.();
         wake = null;
      };
      const finish = (exitCode: number) => {
         if (done) return;
         push({ type: 'exit', seq: seq++, exitCode });
         done = true;
      };

      const child = spawn('/bin/bash', ['-c', command], {
         cwd,
         // Platform credentials are not implicit tool inputs. This reduces accidental
         // exposure; shell execution still requires an isolated OS trust boundary.
         env: { PATH: process.env.PATH, LANG: 'C.UTF-8', HOME: this.root, TMPDIR: this.root, ...this.#env, ...(options.env ?? {}) },
         detached: true,
      });
      const pid = child.pid;
      if (pid !== undefined) this.#groups.add(pid);
      const kill = () => {
         if (pid !== undefined) { try { process.kill(-pid, 'SIGKILL'); } catch { /* Already exited. */ } }
      };
      signal.addEventListener('abort', kill, { once: true });
      if (signal.aborted) kill();
      const timeout = setTimeout(kill, options.timeoutMs ?? 600_000);
      timeout.unref();
      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      child.stdout.on('data', (data: string) => push({ type: 'stdout', seq: seq++, data }));
      child.stderr.on('data', (data: string) => push({ type: 'stderr', seq: seq++, data }));
      child.on('error', (error) => {
         push({ type: 'error', seq: seq++, message: error.message });
         // A process that never started emits no `close`.
         if (child.pid === undefined) finish(127);
      });
      child.on('close', (code, signal) => {
         clearTimeout(timeout);
         kill();
         if (pid !== undefined) this.#groups.delete(pid);
         if (code === null && signal) push({ type: 'error', seq: seq++, message: `command ended by ${signal}` });
         finish(code ?? 1);
      });

      while (true) {
         const next = queue.shift();
         if (next) {
            yield next;
            continue;
         }
         if (done) { signal.removeEventListener('abort', kill); return; }
         await new Promise<void>((resolveWake) => {
            wake = resolveWake;
         });
      }
   }

   async writeFile(path: string, content: string): Promise<void> {
      const target = this.#path(path);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, content, 'utf8');
   }

   async readFile(path: string): Promise<string> {
      return readFile(this.#path(path), 'utf8');
   }

   async stop(): Promise<void> {
      for (const pid of this.#groups) {
         try { process.kill(-pid, 'SIGKILL'); } catch { /* Already exited. */ }
      }
      this.#groups.clear();
   }

   /** The workspace outlives a run on purpose: the next run on the session reuses it. */
   async destroy(): Promise<void> {}

   #path(path: string): string {
      return isAbsolute(path) ? path : resolve(this.root, path);
   }
}
