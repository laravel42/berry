import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

/** Ports the desktop stack uses so it does not take 3000 or 4000. */
export const DESKTOP_API_PORT = 4173;
export const DESKTOP_WEB_PORT = 4174;

const MIGRATE_TIMEOUT_MS = 180_000;
const READY_TIMEOUT_MS = 180_000;

export interface LocalStack {
   dataDir: string;
   apiOrigin: string;
   webOrigin: string;
}

export function localStack(
   dataDir: string,
   apiPort = DESKTOP_API_PORT,
   webPort = DESKTOP_WEB_PORT,
): LocalStack {
   return {
      dataDir: path.resolve(dataDir),
      apiOrigin: `http://127.0.0.1:${apiPort}`,
      webOrigin: `http://127.0.0.1:${webPort}`,
   };
}

/** Walks up from a file inside the repo until it finds the server and the frontend. */
export function findRepoRoot(start: string): string | null {
   let current = path.resolve(start);
   for (let depth = 0; depth < 8; depth += 1) {
      const server = path.join(current, 'server-ts', 'src', 'index.ts');
      const frontend = path.join(current, 'frontend', 'package.json');
      if (existsSync(server) && existsSync(frontend)) return current;
      const parent = path.dirname(current);
      if (parent === current) return null;
      current = parent;
   }
   return null;
}

export function nextCli(repoRoot: string): string {
   const candidates = [
      path.join(repoRoot, 'frontend', 'node_modules', 'next', 'dist', 'bin', 'next'),
      path.join(repoRoot, 'node_modules', 'next', 'dist', 'bin', 'next'),
   ];
   for (const candidate of candidates) {
      if (existsSync(candidate)) return candidate;
   }
   throw new Error('Next.js is not installed. Run pnpm install from the repo root.');
}

/**
 * Env for the server child. `DATABASE_URL` is set here so a repo `.env` that
 * names host Postgres cannot override it: Node's `--env-file` leaves variables
 * that are already set.
 */
export function serverChildEnv(base: NodeJS.ProcessEnv, stack: LocalStack): NodeJS.ProcessEnv {
   const env: NodeJS.ProcessEnv = { ...base };
   delete env.ELECTRON_RUN_AS_NODE;
   const apiPort = new URL(stack.apiOrigin).port;
   env.DATABASE_URL = `pglite:${stack.dataDir}`;
   env.API_ADDR = `127.0.0.1:${apiPort}`;
   env.BERRY_APP_URL = stack.webOrigin;
   env.BERRY_PUBLIC_URL = stack.apiOrigin;
   if ((env.APP_ENV ?? '').trim() === '') env.APP_ENV = 'development';
   return env;
}

export function frontendChildEnv(base: NodeJS.ProcessEnv, stack: LocalStack): NodeJS.ProcessEnv {
   const env: NodeJS.ProcessEnv = { ...base };
   delete env.ELECTRON_RUN_AS_NODE;
   env.BERRY_API_ORIGIN = stack.apiOrigin;
   env.NEXT_DIST_DIR = '.next-desktop';
   return env;
}

export function serverNodeArgs(repoRoot: string, script: string): string[] {
   return [
      `--env-file-if-exists=${path.join(repoRoot, '.env')}`,
      '--experimental-strip-types',
      script,
   ];
}

export interface RunningStack {
   webOrigin: string;
   stop(): Promise<void>;
}

/**
 * Migrates a PGlite directory, starts the API on it, then starts Next pointed
 * at that API. The returned origin is what the window should load.
 */
export async function startLocalStack(repoRoot: string, stack: LocalStack, nodeBin = 'node'): Promise<RunningStack> {
   const serverCwd = path.join(repoRoot, 'server-ts');
   const serverEnv = serverChildEnv(process.env, stack);
   const migrate = spawn(nodeBin, serverNodeArgs(repoRoot, 'src/migrate/index.ts'), {
      cwd: serverCwd,
      env: serverEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
   });
   const migrateLog = pipe(migrate, 'migrate');
   const migrateCode = await exitCode(migrate, MIGRATE_TIMEOUT_MS);
   if (migrateCode !== 0) {
      throw new Error(`database migration failed (${migrateCode})\n${migrateLog.text()}`);
   }

   const api = spawn(nodeBin, serverNodeArgs(repoRoot, 'src/index.ts'), {
      cwd: serverCwd,
      env: serverEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
   });
   const apiLog = pipe(api, 'api');
   const webPort = new URL(stack.webOrigin).port;
   const web = spawn(nodeBin, [nextCli(repoRoot), 'dev', '--turbopack', '--hostname', '127.0.0.1', '--port', webPort], {
      cwd: path.join(repoRoot, 'frontend'),
      env: frontendChildEnv(process.env, stack),
      stdio: ['ignore', 'pipe', 'pipe'],
   });
   const webLog = pipe(web, 'web');

   let stopped = false;
   const stop = async (): Promise<void> => {
      if (stopped) return;
      stopped = true;
      await Promise.all([signal(api), signal(web)]);
   };

   try {
      await Promise.all([
         waitForHttp(`${stack.apiOrigin}/health`, api, apiLog),
         waitForHttp(stack.webOrigin, web, webLog),
      ]);
   } catch (error) {
      await stop();
      throw error;
   }

   return { webOrigin: stack.webOrigin, stop };
}

function pipe(child: ChildProcess, label: string): { text(): string } {
   let buf = '';
   const push = (chunk: Buffer): void => {
      const line = chunk.toString('utf8');
      buf = (buf + line).slice(-4_000);
      process.stderr.write(`[berry-${label}] ${line}`);
   };
   child.stdout?.on('data', push);
   child.stderr?.on('data', push);
   return { text: () => buf.trim() };
}

function exitCode(child: ChildProcess, timeoutMs: number): Promise<number> {
   return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
         child.kill('SIGKILL');
         reject(new Error('timed out'));
      }, timeoutMs);
      child.once('error', (error) => {
         clearTimeout(timer);
         reject(error);
      });
      child.once('exit', (code) => {
         clearTimeout(timer);
         resolve(code ?? 1);
      });
   });
}

async function waitForHttp(url: string, child: ChildProcess, log: { text(): string }): Promise<void> {
   const deadline = Date.now() + READY_TIMEOUT_MS;
   let exited: number | null = null;
   child.once('exit', (code) => {
      exited = code ?? 1;
   });
   while (Date.now() < deadline) {
      if (exited !== null) {
         throw new Error(`${url} process exited (${exited})\n${log.text()}`);
      }
      try {
         const response = await fetch(url, { signal: AbortSignal.timeout(2_000) });
         if (response.ok) return;
      } catch {
         // The process is still starting.
      }
      await new Promise((resolve) => setTimeout(resolve, 300));
   }
   throw new Error(`timed out waiting for ${url}\n${log.text()}`);
}

function signal(child: ChildProcess): Promise<void> {
   if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
   return new Promise((resolve) => {
      const timer = setTimeout(() => {
         child.kill('SIGKILL');
      }, 5_000);
      child.once('exit', () => {
         clearTimeout(timer);
         resolve();
      });
      child.kill('SIGTERM');
   });
}
