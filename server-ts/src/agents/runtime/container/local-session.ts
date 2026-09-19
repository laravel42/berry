import { spawn } from 'node:child_process';
import { chmod, lchown, lstat, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';
import type {
   ExecEvent,
   ExecOptions,
   ExecResult,
   ExecutionSession,
} from '../../../execution/driver.ts';
import type { SessionIdentity } from './session-identity.ts';

/** How long output may keep arriving after the shell exits before its group is reaped. */
const EXIT_DRAIN_MS = 500;

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
   /**
    * The Unix user this session's commands and files belong to, when the
    * runtime isolates sessions (see `session-identity.ts`). Without one,
    * everything runs as the runtime's own user, as it does in a microVM.
    */
   readonly #identity: SessionIdentity | undefined;
   #opened: Promise<void> | null = null;

   constructor(options: { id: string; root: string; env?: Record<string, string>; signal?: AbortSignal; identity?: SessionIdentity }) {
      this.id = options.id;
      this.root = options.root;
      this.#env = options.env ?? {};
      this.#signal = options.signal;
      this.#identity = options.identity;
   }

   /**
    * The workspace directory, existing and — for an isolated session — owned by
    * its user and closed to every other one.
    *
    * A directory that predates isolation belongs to the runtime's old user; it
    * is handed over whole, once. `-h` so a symlink is re-owned rather than
    * followed out of the workspace.
    */
   open(): Promise<void> {
      this.#opened ??= (async () => {
         await mkdir(this.root, { recursive: true });
         const identity = this.#identity;
         if (!identity) return;
         if ((await lstat(this.root)).uid !== identity.uid) {
            await runAs(undefined, '/bin/chown', ['-R', '-h', `${identity.uid}:${identity.gid}`, this.root]);
         }
         await chmod(this.root, 0o700);
      })();
      return this.#opened;
   }

   /**
    * Hands something the runtime itself created in the workspace (the checkout
    * directory, the snapshot archive) to the session's user. Not recursive and
    * never through a symlink: it is for what was made a moment ago.
    */
   async adopt(path: string): Promise<void> {
      if (this.#identity) await lchown(this.#path(path), this.#identity.uid, this.#identity.gid);
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
      await this.open();
      // As the session's user, so a directory made here is one it can write in
      // — and so root never creates anything along a path the agent laid out.
      if (this.#identity) await runAs(this.#identity, '/bin/mkdir', ['-p', '--', cwd]);
      else await mkdir(cwd, { recursive: true });

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
         ...(this.#identity ?? {}),
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
      // A backgrounded child (`server &`) inherits stdout and holds it open after the
      // shell exits, so `close` would wait for the timeout. Let trailing output drain,
      // then reap the group; that closes the pipes and `close` reports the shell's code.
      let reap: ReturnType<typeof setTimeout> | undefined;
      child.on('exit', () => {
         reap = setTimeout(kill, EXIT_DRAIN_MS);
         reap.unref();
      });
      child.on('close', (code, signal) => {
         clearTimeout(timeout);
         clearTimeout(reap);
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

   /**
    * For an isolated session the write is done by a process running as the
    * session's user, not by the runtime. The runtime is root there, and the
    * path is the agent's: a `server` that is a symlink to the runtime's own
    * source would otherwise be followed with root's permissions.
    */
   async writeFile(path: string, content: string): Promise<void> {
      const target = this.#path(path);
      await this.open();
      if (this.#identity) {
         await runAs(this.#identity, '/bin/sh', ['-c', 'mkdir -p -- "$(dirname -- "$1")" && cat > "$1"', 'sh', target], content);
         return;
      }
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, content, 'utf8');
   }

   async readFile(path: string): Promise<string> {
      if (this.#identity) return (await runAs(this.#identity, '/bin/cat', ['--', this.#path(path)])).toString('utf8');
      return readFile(this.#path(path), 'utf8');
   }

   async stop(): Promise<void> {
      for (const pid of this.#groups) {
         try { process.kill(-pid, 'SIGKILL'); } catch { /* Already exited. */ }
      }
      this.#groups.clear();
      // A process that left its group (setsid, a daemon) outlived the kill
      // above. With a user of its own, everything the session started can be
      // named: `kill -1` as that user reaches all of it and nothing else.
      if (this.#identity) await runAs(this.#identity, '/bin/sh', ['-c', 'kill -KILL -1']).catch(() => undefined);
   }

   /** The workspace outlives a run on purpose: the next run on the session reuses it. */
   async destroy(): Promise<void> {}

   #path(path: string): string {
      return isAbsolute(path) ? path : resolve(this.root, path);
   }
}

/**
 * One short process, optionally as a session's user; resolves with its stdout.
 * No shell unless the caller asks for one, and nothing of the runtime's
 * environment goes with it.
 */
function runAs(identity: SessionIdentity | undefined, file: string, args: string[], stdin?: string): Promise<Buffer> {
   return new Promise((resolveRun, reject) => {
      const child = spawn(file, args, {
         cwd: '/',
         env: { PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin', LANG: 'C.UTF-8' },
         stdio: ['pipe', 'pipe', 'pipe'],
         ...(identity ?? {}),
      });
      const out: Buffer[] = [];
      let err = '';
      child.stdout.on('data', (chunk: Buffer) => out.push(chunk));
      child.stderr.on('data', (chunk: Buffer) => { err += chunk.toString('utf8'); });
      child.on('error', reject);
      child.on('close', (code, signal) => {
         if (code === 0) resolveRun(Buffer.concat(out));
         else reject(new Error(`${file} ${signal ? `ended by ${signal}` : `exited ${code}`}: ${err.trim().slice(0, 300)}`));
      });
      child.stdin.on('error', () => undefined);
      child.stdin.end(stdin ?? '');
   });
}
