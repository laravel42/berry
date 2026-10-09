import { spawn } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { chmod, lchown, lstat, mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
   ExecEvent,
   ExecOptions,
   ExecResult,
   ExecutionSession,
} from '../../../execution/driver.ts';
import { ensureSessionAccount } from './session-account.ts';
import type { SessionIdentity } from './session-identity.ts';

/**
 * What the image says about its tools, handed to commands by name.
 *
 * A command's environment is built from nothing so that no credential of the
 * runtime's reaches it by accident. These are not credentials: they are where
 * the image put bun, nvm, Playwright and its browsers (and the Chromium
 * Lighthouse runs on), and how pip and
 * corepack should behave in a container. Anything else in the runtime's
 * environment stays out. Without the Playwright pair a command found neither
 * Chromium nor `require('playwright')`, and agents spent a dozen calls a task
 * searching the filesystem for them.
 */
const TOOL_ENV = [
   'BASH_ENV',
   'BUN_INSTALL',
   'CHROME_PATH',
   'COREPACK_ENABLE_DOWNLOAD_PROMPT',
   'NODE_PATH',
   'PIP_BREAK_SYSTEM_PACKAGES',
   'PIP_DISABLE_PIP_VERSION_CHECK',
   'PLAYWRIGHT_BROWSERS_PATH',
] as const;

function toolEnv(): Record<string, string> {
   const found: Record<string, string> = {};
   for (const name of TOOL_ENV) {
      const value = process.env[name];
      if (value) found[name] = value;
   }
   // A command's HOME is the checkout, so Playwright would look for Chromium
   // under that tree. The browsers stay in the host user's cache.
   if (!found.PLAYWRIGHT_BROWSERS_PATH) {
      const browsers = hostPlaywrightBrowsers();
      if (browsers) found.PLAYWRIGHT_BROWSERS_PATH = browsers;
   }
   // The checkout is not the repo that installed Playwright, so
   // `require('playwright')` fails there and the agent searches the disk.
   if (!found.NODE_PATH) {
      const modules = hostPlaywrightModules();
      if (modules) found.NODE_PATH = modules;
   }
   return found;
}

/** Playwright's own cache for this operating system, when it is already installed. */
let hostPlaywrightBrowsersCache: string | undefined | null = null;

function hostPlaywrightBrowsers(): string | undefined {
   if (hostPlaywrightBrowsersCache !== null) return hostPlaywrightBrowsersCache;
   const home = homedir();
   const path =
      process.platform === 'darwin'
         ? join(home, 'Library', 'Caches', 'ms-playwright')
         : process.platform === 'linux'
           ? join(process.env.XDG_CACHE_HOME || join(home, '.cache'), 'ms-playwright')
           : process.platform === 'win32'
             ? join(process.env.LOCALAPPDATA || join(home, 'AppData', 'Local'), 'ms-playwright')
             : join(home, '.ms-playwright');
   hostPlaywrightBrowsersCache = existsSync(path) ? path : undefined;
   return hostPlaywrightBrowsersCache;
}

/**
 * The `node_modules` directory that contains `playwright`, when this machine
 * already has a copy whose Chromium revision is installed. Walking up from
 * this file stays inside the repo; nothing searches the disk.
 */
let hostPlaywrightModulesCache: string | undefined | null = null;

function hostPlaywrightModules(): string | undefined {
   if (hostPlaywrightModulesCache !== null) return hostPlaywrightModulesCache;
   const browsers = hostPlaywrightBrowsers();
   let dir = dirname(fileURLToPath(import.meta.url));
   let found: string | undefined;
   for (let i = 0; i < 8 && !found; i++) {
      found = playwrightModulesIn(join(dir, 'node_modules', '.pnpm'), browsers);
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
   }
   hostPlaywrightModulesCache = found;
   return hostPlaywrightModulesCache;
}

function playwrightModulesIn(pnpm: string, browsers: string | undefined): string | undefined {
   let names: string[];
   try {
      names = readdirSync(pnpm);
   } catch {
      return undefined;
   }
   const candidates = names.filter((name) => name.startsWith('playwright@')).sort().reverse();
   for (const name of candidates) {
      const modules = join(pnpm, name, 'node_modules');
      if (!existsSync(join(modules, 'playwright', 'package.json'))) continue;
      if (!browsers || playwrightRevisionInstalled(modules, browsers)) return modules;
   }
   return undefined;
}

function playwrightRevisionInstalled(modules: string, browsers: string): boolean {
   const file = [
      join(modules, 'playwright-core', 'browsers.json'),
      join(modules, 'playwright', 'node_modules', 'playwright-core', 'browsers.json'),
   ].find((path) => existsSync(path));
   if (!file) return false;
   let revision = '';
   try {
      const parsed = JSON.parse(readFileSync(file, 'utf8')) as { browsers?: Array<{ name?: string; revision?: string }> };
      revision = parsed.browsers?.find((browser) => browser.name === 'chromium')?.revision ?? '';
   } catch {
      return false;
   }
   if (!/^\d+$/.test(revision)) return false;
   return existsSync(join(browsers, `chromium-${revision}`)) || existsSync(join(browsers, `chromium_headless_shell-${revision}`));
}

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
         // Before any command: `whoami` and `os.userInfo` need a passwd name
         // for this uid, and the image does not ship one above 200000.
         await ensureSessionAccount(identity, this.root);
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
         env: { PATH: process.env.PATH, LANG: 'C.UTF-8', HOME: this.root, TMPDIR: this.root, ...toolEnv(), ...this.#env, ...(options.env ?? {}) },
         detached: true,
         // Nobody is at the keyboard. A command that stops to ask (a password,
         // "Proceed? [y/N]") reads end-of-file and fails at once, instead of
         // waiting on a pipe nobody writes until the time limit stops it — the
         // field saw a run held for twenty minutes by an install asking for
         // sudo. Detached, it has no terminal either, so sudo itself refuses
         // rather than prompts.
         stdio: ['ignore', 'pipe', 'pipe'],
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
