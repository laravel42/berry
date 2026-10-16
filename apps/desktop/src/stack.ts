import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { randomBytes } from 'node:crypto';
import path from 'node:path';

/** Ports the desktop stack uses so it does not take 3000 or 4000. */
export const DESKTOP_API_PORT = 4173;
export const DESKTOP_WEB_PORT = 4174;
/** Next `distDir` for the packaged production build. Must not share `.next` with `next dev`. */
export const DESKTOP_NEXT_DIST_DIR = '.next-desktop-bundle';

const MIGRATE_TIMEOUT_MS = 180_000;
const READY_TIMEOUT_MS = 180_000;
/** Packaged apps sit many folders below the checkout when they still live in `release/`. */
const MAX_WALK = 24;
const LOGIN_PATH_TIMEOUT_MS = 8_000;
const LOGIN_PATH_MARK = 'BERRY_LOGIN_PATH';
/** Keys a checkout `.env` may fill for the desktop server. Not the whole file. */
export const REPO_DESKTOP_ENV_KEYS = [
   'DATABASE_URL',
   'BERRY_DESKTOP_DATABASE_URL',
   'DATABASE_IAM_AUTH',
   'DATABASE_IAM_REGION',
   'DATABASE_SSL_REJECT_UNAUTHORIZED',
   'AWS_REGION',
   'AWS_DEFAULT_REGION',
   'AWS_PROFILE',
   'AWS_ACCESS_KEY_ID',
   'AWS_SECRET_ACCESS_KEY',
   'AWS_SESSION_TOKEN',
   'BERRY_AUTH_SECRET',
   'INTEGRATION_ENCRYPTION_KEY',
] as const;

export interface LocalStack {
   dataDir: string;
   apiOrigin: string;
   webOrigin: string;
}

/** Where the API and web app live: a git checkout, or files copied next to Electron. */
export type StackLayout =
   | { kind: 'repo'; root: string }
   | { kind: 'bundled'; root: string };

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

export function isRepoRoot(dir: string): boolean {
   return (
      existsSync(path.join(dir, 'server-ts', 'src', 'index.ts')) &&
      existsSync(path.join(dir, 'frontend', 'package.json'))
   );
}

export function hasMigrationFiles(serverRoot: string): boolean {
   const folder = path.join(serverRoot, 'migrations');
   if (!existsSync(folder)) return false;
   try {
      return readdirSync(folder).some((name) => name.endsWith('.up.sql'));
   } catch {
      return false;
   }
}

export function hasBundledWebAssets(root: string): boolean {
   const chunks = path.join(root, 'web', 'frontend', DESKTOP_NEXT_DIST_DIR, 'static', 'chunks');
   if (!existsSync(chunks)) return false;
   try {
      return readdirSync(chunks).some((name) => name.endsWith('.css'));
   } catch {
      return false;
   }
}

export function isBundledRoot(dir: string): boolean {
   const server = path.join(dir, 'server', 'src', 'index.ts');
   const nestedWeb = path.join(dir, 'web', 'frontend', 'server.js');
   const flatWeb = path.join(dir, 'web', 'server.js');
   const web = existsSync(nestedWeb) || existsSync(flatWeb);
   return (
      existsSync(server) &&
      web &&
      hasMigrationFiles(path.join(dir, 'server')) &&
      hasBundledWebAssets(dir)
   );
}

export function layoutAt(dir: string): StackLayout | null {
   if (isBundledRoot(dir)) return { kind: 'bundled', root: path.resolve(dir) };
   if (isRepoRoot(dir)) return { kind: 'repo', root: path.resolve(dir) };
   return null;
}

function walk(start: string, pred: (dir: string) => boolean): string | null {
   let current = path.resolve(start);
   for (let depth = 0; depth < MAX_WALK; depth += 1) {
      if (pred(current)) return current;
      const parent = path.dirname(current);
      if (parent === current) return null;
      current = parent;
   }
   return null;
}

/** Walks up from a file inside the repo until it finds the server and the frontend. */
export function findRepoRoot(start: string): string | null {
   return walk(start, isRepoRoot);
}

/**
 * Packaged Electron looks in `resources/berry` first. `pnpm dev:desktop` still
 * walks to the git checkout. `BERRY_DESKTOP_ROOT` wins when it names either.
 */
export function resolveStack(opts: {
   start: string;
   resourcesPath?: string;
   cwd?: string;
   env?: NodeJS.ProcessEnv;
}): StackLayout | null {
   const env = opts.env ?? {};
   const explicit = (env.BERRY_DESKTOP_ROOT ?? '').trim();
   if (explicit !== '') return layoutAt(path.resolve(explicit));

   if (opts.resourcesPath !== undefined && opts.resourcesPath !== '') {
      const bundled = layoutAt(path.join(opts.resourcesPath, 'berry'));
      if (bundled?.kind === 'bundled') return bundled;
   }

   const fromStart = walkLayout(opts.start);
   if (fromStart !== null) return fromStart;
   if (opts.cwd !== undefined && opts.cwd !== '') return walkLayout(opts.cwd);
   return null;
}

function walkLayout(start: string): StackLayout | null {
   let current = path.resolve(start);
   for (let depth = 0; depth < MAX_WALK; depth += 1) {
      const layout = layoutAt(current);
      if (layout !== null) return layout;
      const parent = path.dirname(current);
      if (parent === current) return null;
      current = parent;
   }
   return null;
}

export function serverDir(layout: StackLayout): string {
   return layout.kind === 'repo' ? path.join(layout.root, 'server-ts') : path.join(layout.root, 'server');
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

export function bundledNodeBin(layout: StackLayout, fallback: string): string {
   if (layout.kind !== 'bundled') return fallback;
   const name = process.platform === 'win32' ? 'node.exe' : 'node';
   const candidate = path.join(layout.root, name);
   return existsSync(candidate) ? candidate : fallback;
}

export function webServerJs(layout: StackLayout): { cwd: string; script: string } | null {
   if (layout.kind !== 'bundled') return null;
   const web = path.join(layout.root, 'web');
   if (existsSync(path.join(web, 'frontend', 'server.js'))) {
      return { cwd: web, script: 'frontend/server.js' };
   }
   if (existsSync(path.join(web, 'server.js'))) {
      return { cwd: web, script: 'server.js' };
   }
   return null;
}

/**
 * Finder-launched macOS apps get `/usr/bin:/bin:/usr/sbin:/sbin`, so Homebrew
 * CLIs used by Settings → AI runtimes are invisible. A login shell's PATH is
 * the list Terminal has. Markers strip motd noise from stdout.
 */
export function parseLoginPathOutput(stdout: string): string | null {
   const start = stdout.indexOf(LOGIN_PATH_MARK);
   if (start === -1) return null;
   const from = start + LOGIN_PATH_MARK.length;
   const end = stdout.indexOf(LOGIN_PATH_MARK, from);
   if (end === -1) return null;
   const value = stdout.slice(from, end).trim();
   return value === '' ? null : value;
}

export function mergeSearchPath(primary: string, secondary: string, delimiter = path.delimiter): string {
   const seen = new Set<string>();
   const out: string[] = [];
   for (const part of [primary, secondary]) {
      for (const dir of part.split(delimiter)) {
         const trimmed = dir.trim();
         if (trimmed === '' || seen.has(trimmed)) continue;
         seen.add(trimmed);
         out.push(trimmed);
      }
   }
   return out.join(delimiter);
}

/** Directories GUI apps often miss. Only paths that exist on disk are added. */
export function extraWorkstationBins(home: string, platform: NodeJS.Platform): string[] {
   if (platform === 'win32') return [];
   return [
      '/opt/homebrew/bin',
      '/opt/homebrew/sbin',
      '/usr/local/bin',
      '/usr/local/sbin',
      path.join(home, '.local', 'bin'),
   ].filter((dir) => existsSync(dir));
}

export function loginShellArgs(shellName: string): string[] {
   const command =
      shellName === 'fish'
         ? `printf '${LOGIN_PATH_MARK}%s${LOGIN_PATH_MARK}' (string join : $PATH)`
         : `printf '${LOGIN_PATH_MARK}%s${LOGIN_PATH_MARK}' "$PATH"`;
   return ['-l', '-c', command];
}

export interface LoginPathSpawnResult {
   status: number | null;
   stdout: string;
   error?: Error;
}

export type LoginPathSpawn = (
   command: string,
   args: readonly string[],
   options: { encoding: 'utf8'; timeout: number; env: NodeJS.ProcessEnv; stdio: ['ignore', 'pipe', 'pipe'] },
) => LoginPathSpawnResult;

function defaultLoginSpawn(
   command: string,
   args: readonly string[],
   options: { encoding: 'utf8'; timeout: number; env: NodeJS.ProcessEnv; stdio: ['ignore', 'pipe', 'pipe'] },
): LoginPathSpawnResult {
   const result = spawnSync(command, [...args], options);
   return {
      status: result.status,
      stdout: typeof result.stdout === 'string' ? result.stdout : '',
      ...(result.error !== undefined ? { error: result.error } : {}),
   };
}

function loginShellEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
   const next: NodeJS.ProcessEnv = { ...env, TERM: 'dumb' };
   delete next.ELECTRON_RUN_AS_NODE;
   return next;
}

export function readLoginShellPath(
   env: NodeJS.ProcessEnv,
   spawn: LoginPathSpawn = defaultLoginSpawn,
   platform: NodeJS.Platform = process.platform,
): string | null {
   if (platform === 'win32') return null;
   const shell = (env.SHELL ?? '').trim() || (platform === 'darwin' ? '/bin/zsh' : '/bin/sh');
   if (!shell.startsWith('/') || shell.includes('\0') || !existsSync(shell)) return null;
   try {
      const result = spawn(shell, loginShellArgs(path.basename(shell)), {
         encoding: 'utf8',
         timeout: LOGIN_PATH_TIMEOUT_MS,
         env: loginShellEnv(env),
         stdio: ['ignore', 'pipe', 'pipe'],
      });
      if (result.error !== undefined || result.status !== 0) return null;
      return parseLoginPathOutput(result.stdout);
   } catch {
      return null;
   }
}

export function withLoginSearchPath(
   env: NodeJS.ProcessEnv,
   options: {
      platform?: NodeJS.Platform;
      home?: string;
      readLogin?: (env: NodeJS.ProcessEnv) => string | null;
   } = {},
): NodeJS.ProcessEnv {
   const platform = options.platform ?? process.platform;
   if (platform === 'win32') return { ...env };
   const home = options.home ?? env.HOME ?? homedir();
   const readLogin = options.readLogin ?? ((current) => readLoginShellPath(current));
   const login = readLogin(env) ?? '';
   const extra = extraWorkstationBins(home, platform).join(path.delimiter);
   const merged = mergeSearchPath(mergeSearchPath(login, extra), env.PATH ?? '');
   if (merged === '') return { ...env };
   return { ...env, PATH: merged };
}

export function parseEnvFile(text: string): Record<string, string> {
   const out: Record<string, string> = {};
   for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (trimmed === '' || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq <= 0) continue;
      const key = trimmed.slice(0, eq).trim();
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
      let value = trimmed.slice(eq + 1).trim();
      if (
         value.length >= 2 &&
         ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))
      ) {
         value = value.slice(1, -1);
      }
      out[key] = value;
   }
   return out;
}

/** Fills empty keys on `env`. An allow list keeps a checkout `.env` from leaking into Electron. */
export function applyEnvFile(file: string, env: NodeJS.ProcessEnv, keys?: readonly string[]): void {
   if (!existsSync(file)) return;
   const parsed = parseEnvFile(readFileSync(file, 'utf8'));
   const allow = keys === undefined ? null : new Set(keys);
   for (const [key, value] of Object.entries(parsed)) {
      if (allow !== null && !allow.has(key)) continue;
      const current = env[key];
      if (current !== undefined && current.trim() !== '') continue;
      env[key] = value;
   }
}

export function isPostgresUrl(raw: string): boolean {
   try {
      const parsed = new URL(raw);
      return parsed.protocol === 'postgres:' || parsed.protocol === 'postgresql:';
   } catch {
      return false;
   }
}

/**
 * Optional host Postgres for the window's own server. `BERRY_DESKTOP_DATABASE_URL`
 * wins; otherwise a `postgres://` `DATABASE_URL` from `.env` is used. A
 * `pglite:` URL is ignored here so the window keeps its own data directory.
 */
export function hostDatabaseUrl(env: NodeJS.ProcessEnv): string | null {
   const explicit = (env.BERRY_DESKTOP_DATABASE_URL ?? '').trim();
   if (explicit !== '') {
      if (!isPostgresUrl(explicit)) {
         throw new Error('BERRY_DESKTOP_DATABASE_URL must be a postgres:// URL.');
      }
      return explicit;
   }
   const databaseUrl = (env.DATABASE_URL ?? '').trim();
   if (databaseUrl === '' || databaseUrl.startsWith('pglite:')) return null;
   if (!isPostgresUrl(databaseUrl)) {
      throw new Error('DATABASE_URL must be a postgres:// URL or pglite:<directory>.');
   }
   return databaseUrl;
}

/**
 * Env for the server child. Node's `--env-file` leaves `DATABASE_URL` once set.
 */
export function serverChildEnv(
   base: NodeJS.ProcessEnv,
   stack: LocalStack,
   databaseUrl?: string | null,
): NodeJS.ProcessEnv {
   const env: NodeJS.ProcessEnv = { ...base };
   delete env.ELECTRON_RUN_AS_NODE;
   const apiPort = new URL(stack.apiOrigin).port;
   const host = databaseUrl === undefined ? hostDatabaseUrl(base) : databaseUrl;
   env.DATABASE_URL = host === null || host === '' ? `pglite:${stack.dataDir}` : host;
   // Beside the database, not in the repo's S3 bucket: a desktop process has
   // no bucket of its own, and a key in the repo env is that deployment's.
   env.BERRY_STORAGE_DIR = path.join(stack.dataDir, 'artifacts');
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

export function bundledFrontendEnv(base: NodeJS.ProcessEnv, stack: LocalStack): NodeJS.ProcessEnv {
   const env = frontendChildEnv(base, stack);
   delete env.NEXT_DIST_DIR;
   env.NODE_ENV = 'production';
   env.HOSTNAME = '127.0.0.1';
   env.PORT = new URL(stack.webOrigin).port;
   return env;
}

export function serverNodeArgs(layout: StackLayout, script: string): string[] {
   const args = ['--experimental-strip-types', script];
   if (layout.kind === 'repo') {
      args.unshift(`--env-file-if-exists=${path.join(layout.root, '.env')}`);
   }
   return args;
}

/** Fills empty auth/integration keys from files under userData. */
export function applyMissingDesktopSecrets(env: NodeJS.ProcessEnv, userDataDir: string): void {
   const auth = (env.BERRY_AUTH_SECRET ?? '').trim();
   const key = (env.INTEGRATION_ENCRYPTION_KEY ?? '').trim();
   if (auth.length >= 32 && key.length >= 32) return;
   const persisted = ensureDesktopSecrets(userDataDir);
   if (auth.length < 32) env.BERRY_AUTH_SECRET = persisted.BERRY_AUTH_SECRET;
   if (key.length < 32) env.INTEGRATION_ENCRYPTION_KEY = persisted.INTEGRATION_ENCRYPTION_KEY;
}

/** Stable secrets under userData so a packaged app does not mint a new key every launch. */
export function ensureDesktopSecrets(userDataDir: string): {
   BERRY_AUTH_SECRET: string;
   INTEGRATION_ENCRYPTION_KEY: string;
} {
   const dir = path.join(userDataDir, 'secrets');
   mkdirSync(dir, { recursive: true });
   return {
      BERRY_AUTH_SECRET: readOrCreateSecret(path.join(dir, 'auth'), () => randomBytes(32).toString('hex')),
      INTEGRATION_ENCRYPTION_KEY: readOrCreateSecret(path.join(dir, 'integrations'), () =>
         randomBytes(32).toString('base64'),
      ),
   };
}

function readOrCreateSecret(file: string, create: () => string): string {
   if (existsSync(file)) {
      const existing = readFileSync(file, 'utf8').trim();
      if (existing.length >= 32) return existing;
   }
   const value = create();
   writeFileSync(file, `${value}\n`, { encoding: 'utf8', mode: 0o600 });
   return value;
}

export interface RunningStack {
   webOrigin: string;
   stop(): Promise<void>;
}

export interface StartStackOptions {
   nodeBin?: string;
   electronAsNode?: boolean;
   secrets?: Readonly<Record<string, string>>;
   databaseUrl?: string | null;
}

function applySpawnEnv(
   env: NodeJS.ProcessEnv,
   options: StartStackOptions | undefined,
): NodeJS.ProcessEnv {
   const next: NodeJS.ProcessEnv = { ...env };
   if (options?.secrets !== undefined) {
      for (const [key, value] of Object.entries(options.secrets)) next[key] = value;
   }
   if (options?.electronAsNode === true) next.ELECTRON_RUN_AS_NODE = '1';
   else delete next.ELECTRON_RUN_AS_NODE;
   return next;
}

/**
 * Migrates, starts the API, then starts Next pointed at that API. With no
 * host Postgres the API uses PGlite under `stack.dataDir` (the packaged
 * default). The returned origin is what the window should load.
 */
export async function startLocalStack(
   layout: StackLayout,
   stack: LocalStack,
   options: StartStackOptions = {},
): Promise<RunningStack> {
   const nodeBin = options.nodeBin ?? 'node';
   const cwd = serverDir(layout);
   if (!hasMigrationFiles(cwd)) {
      throw new Error(`database migrations are missing at ${path.join(cwd, 'migrations')}`);
   }
   const processEnv = withLoginSearchPath(process.env);
   const databaseUrl = options.databaseUrl !== undefined ? options.databaseUrl : hostDatabaseUrl(processEnv);
   const serverEnv = applySpawnEnv(serverChildEnv(processEnv, stack, databaseUrl), options);
   if (options.secrets === undefined) applyMissingDesktopSecrets(serverEnv, stack.dataDir);
   const migrate = spawn(nodeBin, serverNodeArgs(layout, 'src/migrate/index.ts'), {
      cwd,
      env: serverEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
   });
   const migrateLog = pipe(migrate, 'migrate');
   const migrateCode = await exitCode(migrate, MIGRATE_TIMEOUT_MS);
   if (migrateCode !== 0) {
      throw new Error(`database migration failed (${migrateCode})\n${migrateLog.text()}`);
   }

   const api = spawn(nodeBin, serverNodeArgs(layout, 'src/index.ts'), {
      cwd,
      env: serverEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
   });
   const apiLog = pipe(api, 'api');
   const webPort = new URL(stack.webOrigin).port;
   const web = spawnWeb(layout, stack, nodeBin, webPort, options, processEnv);
   const webLog = pipe(web, 'web');

   const onProcessExit = (): void => {
      for (const child of [api, web]) {
         if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      }
   };
   process.once('exit', onProcessExit);

   let stopped = false;
   const stop = async (): Promise<void> => {
      if (stopped) return;
      stopped = true;
      process.removeListener('exit', onProcessExit);
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

function spawnWeb(
   layout: StackLayout,
   stack: LocalStack,
   nodeBin: string,
   webPort: string,
   options: StartStackOptions,
   processEnv: NodeJS.ProcessEnv,
): ChildProcess {
   if (layout.kind === 'repo') {
      return spawn(
         nodeBin,
         [nextCli(layout.root), 'dev', '--turbopack', '--hostname', '127.0.0.1', '--port', webPort],
         {
            cwd: path.join(layout.root, 'frontend'),
            env: applySpawnEnv(frontendChildEnv(processEnv, stack), options),
            stdio: ['ignore', 'pipe', 'pipe'],
         },
      );
   }
   const entry = webServerJs(layout);
   if (entry === null) {
      throw new Error('The packaged web app is missing frontend/server.js.');
   }
   return spawn(nodeBin, [entry.script], {
      cwd: entry.cwd,
      env: applySpawnEnv(bundledFrontendEnv(processEnv, stack), options),
      stdio: ['ignore', 'pipe', 'pipe'],
   });
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
