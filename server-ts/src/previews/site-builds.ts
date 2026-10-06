import { spawn } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import type { RunArtifact, RunArtifactRepository } from '../core/run-artifacts.ts';
import { proxyToPort, type PreviewAddressing } from './proxy.ts';
import { atSiteRoot, siteOrigin } from './site-host.ts';

/**
 * Builds an agent's web project so its preview shows the site, not a blank page.
 *
 * A Vite or React project's `index.html` loads `/src/main.tsx`, which no
 * browser runs: it has to be compiled first. This writes the task's files to
 * a folder, installs and builds them in a throwaway container, and keeps the
 * output for the preview route to serve under `__build__/`.
 *
 * The container runs the agent's code — its install scripts and its build —
 * so it is kept small: its own network (npm has to reach the registry), no
 * host access but the one build folder, no Linux capabilities, bounded memory,
 * CPU, processes and time. Nothing it produces is trusted: the output is read
 * back as files. A project whose `start` script is its own server is then run,
 * and the review page loads it on its own host (`site-host.ts`) — a sandbox
 * on Berry's origin cannot route to `/admin` or call the app's API. A project
 * with no server is served from those files on that same host. The file
 * preview under `__build__/` stays sandboxed.
 *
 * The folder lives under the home directory because Docker Desktop and Colima
 * share only that with their VM; a temp dir would mount empty. When this
 * process is itself a container, pass a root mounted at the same path on the
 * host (`BERRY_PREVIEW_ROOT`): the daemon reads `-v` as a host path.
 */

export type BuildState = 'idle' | 'building' | 'ready' | 'failed';

export interface BuildStatus {
   state: BuildState;
   /** The end of the build's output, for a person watching or reading a failure. */
   log: string;
   startedAt: string | null;
   finishedAt: string | null;
   /**
    * Where the built site answers, once it is up: its own host, so its routes
    * and its API are same-origin. Null while it is not ready, and on a server
    * with no preview address.
    */
   url: string | null;
}

interface Build extends BuildStatus {
   key: string;
   outDir: string | null;
}

export interface SiteBuildOptions {
   artifacts: Pick<RunArtifactRepository, 'listForIssue'>;
   read: (artifact: RunArtifact) => Promise<Uint8Array>;
   root?: string;
   image?: string;
   timeoutMs?: number;
   /** Runs a command; injected by tests. Resolves with the exit code and combined output. */
   run?: (args: string[], options: { timeoutMs: number; onOutput: (text: string) => void }) => Promise<number | null>;
   /** Whether Docker answers at all; injected by tests. */
   available?: () => Promise<boolean>;
   /** Where a browser reaches this server. Without it the site stays on the sandboxed file preview. */
   address?: PreviewAddressing;
   /** The host address a published port is bound on. Loopback unless the server is a container. */
   publishAddr?: string;
   /** Where this process reaches a published port. Loopback unless the server is a container. */
   hostAddr?: string;
}

const LOG_LIMIT = 16_000;
const READY_MARKER = 'ready.json';
const MAX_CONCURRENT = 2;
/** Where a build's output is looked for when the project names none (Vite is told where to write). */
const OUTPUT_DIRS = ['.berry-out', 'dist', 'build', 'out'];

/** The file a browser cannot run as it is: TypeScript, JSX or a framework's single-file component. */
export const NEEDS_BUILD = /<script[^>]*\bsrc\s*=\s*["'][^"']+\.(?:tsx?|jsx|vue|svelte)["']/i;

/**
 * The shell script the container runs, from the project's own package.json.
 *
 * `node_modules` is a volume kept per task, and it carries the hash of the
 * dependencies it was installed from (`.berry-deps`). When the hash still
 * matches, the install is skipped: a Rebuild of the same dependencies is the
 * build alone, a second or two. Otherwise npm installs from the shared cache
 * first (`--prefer-offline`) and fetches only what it has never seen.
 *
 * Vite is told to write relative asset URLs (`--base ./`) so the site works
 * under the preview's path; the host that serves it pins those with a base
 * tag. Anything else runs its own `build` script. A project that starts its
 * own server is compiled when that server is launched, not here.
 */
export function buildScript(
   packageJson: { scripts?: Record<string, string>; dependencies?: Record<string, string>; devDependencies?: Record<string, string> },
   depsHash: string
): string {
   const deps = { ...packageJson.dependencies, ...packageJson.devDependencies };
   // `http` prints each package as it is fetched, so the log streams through
   // an install instead of sitting silent.
   const install = 'npm install --no-audit --no-fund --prefer-offline --loglevel=http';
   const build = deps.vite
      ? 'npx --no-install vite build --base ./ --outDir .berry-out --emptyOutDir'
      : packageJson.scripts?.build
        ? 'npm run build'
        : 'echo "package.json has no build script" && exit 2';
   const hash = depsHash.replace(/[^a-f0-9]/g, '');
   return [
      'set -e',
      `if [ "$(cat node_modules/.berry-deps 2>/dev/null)" = "${hash}" ]; then echo "Dependencies unchanged since the last build: skipping npm install."; else echo "$ ${install}"; ${install}; echo "${hash}" > node_modules/.berry-deps; fi`,
      `echo "$ ${build}"`,
      build,
   ].join('; ');
}

/** What the dependencies are: the manifest and whichever lockfile the project has. */
export async function dependencyHash(project: string): Promise<string> {
   const hash = createHash('sha256');
   for (const name of ['package.json', 'package-lock.json', 'npm-shrinkwrap.json', 'yarn.lock', 'pnpm-lock.yaml']) {
      const content = await readFile(join(project, name)).catch(() => null);
      if (content) hash.update(`\0${name}\0`).update(content);
   }
   return hash.digest('hex').slice(0, 32);
}

/**
 * A project whose `start` script is its own server. Vite's preview and
 * `serve` only host the files the build already wrote, which Berry does.
 */
export function servesItself(packageJson: { scripts?: Record<string, string> }): boolean {
   const start = packageJson.scripts?.start?.trim() ?? '';
   if (start === '') return false;
   if (/\bvite\b/.test(start) && /\bpreview\b/.test(start)) return false;
   if (/(?:^|\s)serve(?:@|\s|$)/.test(start)) return false;
   return true;
}

/**
 * A TypeScript file tsx can run when the compiled server will not build.
 * `tsx watch server/index.ts` in a dev script, or `node dist-server/server/index.js`
 * mapped back to `server/index.ts`.
 */
function tsxEntry(packageJson: { scripts?: Record<string, string> }): string | null {
   const scripts = packageJson.scripts ?? {};
   for (const source of [scripts['dev:server'], scripts.dev, scripts.start]) {
      if (!source) continue;
      const file = /\bts[x]?\s+(?:watch\s+)?(\S+\.tsx?)\b/.exec(source)?.[1];
      if (file && !file.startsWith('/') && !file.includes('..')) return file;
   }
   const js = /(?:^|\s)node\s+(\S+\.js)(?:\s|$)/.exec(scripts.start ?? '')?.[1];
   if (!js || js.startsWith('/') || js.includes('..')) return null;
   return js.replace(/^dist-server\//, '').replace(/\.js$/, '.ts');
}

/** npm's download cache, shared by every build on this server. */
export const NPM_CACHE_VOLUME = 'berry-site-npm-cache';

/** The port the site's own server is told to listen on, and the one published. */
const APP_PORT = 3001;

function modulesVolume(issueId: string): string {
   return `berry-site-nm-${issueId.replace(/[^a-z0-9]/gi, '').slice(0, 32).toLowerCase()}`;
}

function siteRunName(issueId: string): string {
   return `berry-site-run-${issueId.replace(/[^a-z0-9]/gi, '').slice(0, 20).toLowerCase()}`;
}

export class SiteBuilds {
   readonly #o: SiteBuildOptions;
   readonly #root: string;
   readonly #image: string;
   readonly #timeoutMs: number;
   /** The latest build of each issue. */
   readonly #builds = new Map<string, Build>();
   /** The host a ready site answers on, and the loopback port of its server when it has one. */
   readonly #runtime = new Map<string, { hostId: string; port: number | null }>();
   readonly #byHost = new Map<string, string>();
   readonly #booting = new Map<string, Promise<void>>();
   #running = 0;
   readonly #waiting: Array<() => void> = [];
   #available: Promise<boolean> | null = null;

   constructor(options: SiteBuildOptions) {
      this.#o = options;
      this.#root = options.root ?? join(homedir(), '.cache', 'berry', 'site-builds');
      this.#image = options.image ?? 'node:22-alpine';
      this.#timeoutMs = options.timeoutMs ?? 5 * 60_000;
   }

   /** Whether this server can build at all: Docker must answer. Asked once. */
   available(): Promise<boolean> {
      this.#available ??= (this.#o.available ?? dockerAnswers)();
      return this.#available;
   }

   /** Where the latest build of an issue stands. A finished build of older files reads as idle. */
   async status(issueId: string): Promise<BuildStatus> {
      const build = await this.#current(issueId);
      if (!build) return idle();
      if (build.state !== 'building' && build.key !== (await this.#key(issueId))) return idle();
      // The host is registered as soon as the files exist. Waiting here for the
      // site's own server would keep the preview blank for the whole startup.
      if (build.state === 'ready' && this.#o.address && !this.#runtime.has(issueId)) {
         void this.#ensureServing(issueId, build, true);
         await this.#untilHost(issueId);
      }
      return {
         state: build.state,
         log: build.log,
         startedAt: build.startedAt,
         finishedAt: build.finishedAt,
         url: build.state === 'ready' ? this.#url(issueId) : null,
      };
   }

   /**
    * Starts a build unless the current files are already built or building.
    * `force` builds again even when they are built — the Rebuild button. A
    * task never has two builds running at once, forced or not.
    * Returns at once; the build goes on in the background.
    */
   async start(issueId: string, options: { force?: boolean } = {}): Promise<BuildStatus> {
      const key = await this.#key(issueId);
      const current = await this.#current(issueId);
      if (current?.state === 'building') return this.status(issueId);
      if (!options.force && current && current.key === key && current.state !== 'failed') return this.status(issueId);

      const build: Build = {
         key,
         state: 'building',
         log: '',
         outDir: null,
         startedAt: new Date().toISOString(),
         finishedAt: null,
         url: null,
      };
      this.#builds.set(issueId, build);
      void this.#build(issueId, build);
      return this.status(issueId);
   }

   /**
    * A file of the issue's finished build, read from disk. Null when there is
    * no ready build or no such file — including any path that would leave the
    * output folder.
    */
   async file(issueId: string, path: string): Promise<{ bytes: Uint8Array; path: string } | null> {
      const build = await this.#current(issueId);
      if (!build || build.state !== 'ready' || !build.outDir) return null;
      const wanted = path === '' || path.endsWith('/') ? `${path}index.html` : path;
      const full = resolve(build.outDir, wanted);
      if (full !== build.outDir && !full.startsWith(build.outDir + sep)) return null;
      try {
         if (!(await stat(full)).isFile()) return null;
         return { bytes: await readFile(full), path: wanted };
      } catch {
         return null;
      }
   }

   /**
    * The issue's build: the one in memory, or — after a restart — a finished
    * build of its current files found on disk.
    */
   async #current(issueId: string, options: { fromDisk?: boolean } = {}): Promise<Build | undefined> {
      const held = options.fromDisk ? undefined : this.#builds.get(issueId);
      // A finished build whose output is gone (the cache folder was cleared
      // under a running server) is forgotten, so the next start rebuilds it
      // instead of serving "Not found" for good.
      if (held?.state === 'ready' && (!held.outDir || !existsSync(join(held.outDir, 'index.html')))) {
         this.#builds.delete(issueId);
      } else if (held) {
         return held;
      }
      const key = await this.#key(issueId);
      try {
         const markerPath = join(this.#taskDir(issueId), READY_MARKER);
         const marker = JSON.parse(await readFile(markerPath, 'utf8')) as { key?: string; outDir: string; log?: string };
         // A marker from other files is a build of something else.
         if (marker.key !== key) return undefined;
         const outDir = resolve(marker.outDir);
         if (!outDir.startsWith(this.#taskDir(issueId) + sep) || !existsSync(join(outDir, 'index.html'))) return undefined;
         // When it finished, from the marker written then: the preview puts it in
         // the page address so each build loads fresh.
         const finishedAt = (await stat(markerPath)).mtime.toISOString();
         const build: Build = { key, state: 'ready', log: marker.log ?? '', outDir, startedAt: null, finishedAt, url: null };
         this.#builds.set(issueId, build);
         return build;
      } catch {
         return undefined;
      }
   }

   /** One folder per task, kept between builds; only its files are brought up to date. */
   #taskDir(issueId: string): string {
      return join(this.#root, 'issues', issueId.replace(/[^a-z0-9-]/gi, ''));
   }

   /** The same files always hash the same: one build per version of the output. */
   async #key(issueId: string): Promise<string> {
      const files = await this.#o.artifacts.listForIssue(issueId);
      const hash = createHash('sha256').update(issueId);
      for (const file of files) hash.update(`\0${file.path}\0${file.id}`);
      return hash.digest('hex').slice(0, 24);
   }

   async #build(issueId: string, build: Build): Promise<void> {
      const say = (text: string) => {
         build.log = (build.log + text).slice(-LOG_LIMIT);
      };
      await this.#slot();
      const folder = this.#taskDir(issueId);
      let locked = false;
      // Released before the result is announced: a Rebuild clicked the moment
      // a build finishes must not find that build's lock and wait on itself.
      const unlock = async () => {
         if (!locked) return;
         locked = false;
         await rm(`${folder}.lock`, { recursive: true, force: true }).catch(() => undefined);
      };
      try {
         if (!(await this.available())) {
            throw new Error('Docker is not available on this server, so the site cannot be built.');
         }
         // One builder per task folder, across every server sharing this disk.
         // A second one waits and takes the first one's result.
         locked = await this.#lock(folder, say);
         if (!locked) {
            const done = await this.#current(issueId, { fromDisk: true });
            // Reading the result from disk put that build in the map; this one,
            // with its own log, is what callers follow.
            this.#builds.set(issueId, build);
            if (done?.state === 'ready' && done.outDir) {
               build.outDir = done.outDir;
               build.state = 'ready';
               say('\nBuilt by another server.\n');
               return;
            }
            throw new Error('Another server was building this site and did not finish it. Try again.');
         }
         const source = join(folder, 'src');
         const files = await this.#o.artifacts.listForIssue(issueId);
         say(`Collecting ${files.length} files…\n`);
         await syncFiles(source, files, (file) => this.#o.read(file));

         const project = await projectRoot(source);
         if (!project) throw new Error('No package.json was found, so there is nothing to build.');
         const packageJson = JSON.parse(await readFile(join(project, 'package.json'), 'utf8')) as Parameters<typeof buildScript>[0];
         // Unique per run: a name shared by two runs makes the second refuse to start.
         const name = `berry-site-build-${build.key.slice(0, 12)}-${randomUUID().slice(0, 8)}`;
         const workdir = `/work/${relative(source, project).split(sep).join('/')}`.replace(/\/$/, '');
         // Kept per task in Docker's own storage: survives between builds, and
         // thousands of small files never cross the host's file sharing.
         const modules = modulesVolume(issueId);
         const code = await (this.#o.run ?? runDocker)(
            [
               'run', '--rm', '--name', name,
               '--memory', '2g', '--cpus', '2', '--pids-limit', '512',
               '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
               '-e', 'CI=true', '-e', 'npm_config_update_notifier=false',
               // Plain text: the log is read in a browser, not a terminal.
               '-e', 'NO_COLOR=1', '-e', 'FORCE_COLOR=0',
               '-v', `${source}:/work`,
               '-v', `${modules}:${workdir}/node_modules`,
               '-v', `${NPM_CACHE_VOLUME}:/root/.npm`,
               '-w', workdir,
               this.#image, 'sh', '-c', buildScript(packageJson, await dependencyHash(project)),
            ],
            { timeoutMs: this.#timeoutMs, onOutput: say }
         );
         if (code !== 0) {
            throw new Error(code === null ? 'The build took too long and was stopped.' : `The build failed (exit ${code}).`);
         }
         const out = OUTPUT_DIRS.map((dir) => join(project, dir)).find((dir) => existsSync(join(dir, 'index.html')));
         if (!out) throw new Error(`The build finished but produced no index.html (looked in ${OUTPUT_DIRS.join(', ')}).`);
         build.outDir = resolve(out);
         // Remembered on disk first — a restarted server serves this build, and
         // a server waiting on the lock reads it the moment the lock goes —
         // then the lock released, then the build announced.
         await writeFile(
            join(folder, READY_MARKER),
            JSON.stringify({ key: build.key, outDir: build.outDir, log: build.log.slice(-4000) })
         );
         await unlock();
         if (this.#o.address) {
            this.#forgetRuntime(issueId);
            // Ready once the pages have a host. The server, when the project
            // has one, takes over that same host when it answers.
            const pending = this.#ensureServing(issueId, build, false);
            await this.#untilHost(issueId);
            build.state = 'ready';
            say('\nBuilt.\n');
            await pending;
         } else {
            build.state = 'ready';
            say('\nBuilt.\n');
         }
         await this.#forgetOthers();
      } catch (error) {
         await unlock();
         build.state = 'failed';
         say(`\n${error instanceof Error ? error.message : String(error)}\n`);
      } finally {
         await unlock();
         build.finishedAt = new Date().toISOString();
         this.#release();
      }
   }

   /**
    * Takes the task's build lock: a directory, because making one is atomic on
    * every filesystem. True when this build holds it. When another builder
    * holds it, waits for it to go and returns false. A lock older than a build
    * can run belongs to a builder that died, and is taken over.
    */
   async #lock(folder: string, say: (text: string) => void): Promise<boolean> {
      const lock = `${folder}.lock`;
      await mkdir(dirname(lock), { recursive: true });
      let waited = false;
      for (;;) {
         try {
            await mkdir(lock);
            return !waited;
         } catch (error) {
            if ((error as { code?: string }).code !== 'EEXIST') throw error;
         }
         const age = Date.now() - (await stat(lock).then((info) => info.mtimeMs).catch(() => Date.now()));
         if (age > this.#timeoutMs + 60_000) {
            await rm(lock, { recursive: true, force: true });
            continue;
         }
         if (!waited) say('Another server is building this site; waiting for it…\n');
         waited = true;
         await new Promise((resolve) => setTimeout(resolve, 1000));
         // Gone: the other build ended. Its result is on disk.
         if (!existsSync(lock)) return false;
      }
   }

   /**
    * Folders from before builds were kept per task (one per file set, each
    * with its own node_modules). Everything here but `issues/` is one of them.
    */
   async #forgetOthers(): Promise<void> {
      const entries = await readdir(this.#root).catch(() => [] as string[]);
      for (const entry of entries) {
         if (entry !== 'issues') await rm(join(this.#root, entry), { recursive: true, force: true }).catch(() => undefined);
      }
   }

   /**
    * Answers a request for a built site's host. A project with its own server
    * is proxied to that server; otherwise the built files are served, and an
    * extensionless path is the app's `index.html` so client routes resolve.
    */
   async serve(hostId: string, request: Request, options: { fetch?: typeof fetch; hostAddr?: string } = {}): Promise<Response> {
      const issueId = this.#byHost.get(hostId);
      if (!issueId) {
         return text('This preview is not running. Open the task\'s Preview tab in Berry to start it.', 404);
      }
      let runtime = this.#runtime.get(issueId);
      if (!runtime?.port && safePath(request)?.startsWith('api/')) {
         // The page is already on screen. Hold its API calls until the server
         // answers instead of failing them while it starts.
         const pending = this.#booting.get(issueId);
         if (pending) {
            await pending;
            runtime = this.#runtime.get(issueId);
         }
      }
      if (runtime?.port) {
         return proxyToPort(request, runtime.port, options.fetch ?? fetch, options.hostAddr ?? '127.0.0.1', atSiteRoot);
      }
      if (request.method !== 'GET' && request.method !== 'HEAD') return text('Not found', 404);
      const path = safePath(request);
      const page = await this.#page(issueId, path);
      if (!page) return text('Not found', 404);
      const html = page.path === 'index.html' || page.path.endsWith('.html');
      const body = html ? new TextEncoder().encode(atSiteRoot(new TextDecoder().decode(page.bytes))) : page.bytes;
      return new Response(request.method === 'HEAD' ? null : body, {
         status: 200,
         headers: {
            'content-type': html ? 'text/html; charset=utf-8' : mediaType(page.path),
            'cache-control': 'no-store',
         },
      });
   }

   async #page(issueId: string, path: string | null): Promise<{ bytes: Uint8Array; path: string } | null> {
      if (path === null || path.startsWith('api/')) return null;
      const asset = await this.file(issueId, path);
      if (asset) return asset;
      const leaf = path.split('/').pop() ?? '';
      if (leaf.includes('.')) return null;
      return this.file(issueId, 'index.html');
   }

   #url(issueId: string): string | null {
      const runtime = this.#runtime.get(issueId);
      if (!runtime || !this.#o.address) return null;
      return siteOrigin(this.#o.address, runtime.hostId);
   }

   #forgetRuntime(issueId: string): void {
      const previous = this.#runtime.get(issueId);
      if (!previous) return;
      this.#byHost.delete(previous.hostId);
      this.#runtime.delete(issueId);
   }

   #register(issueId: string, hostId: string, port: number | null): void {
      this.#forgetRuntime(issueId);
      this.#runtime.set(issueId, { hostId, port });
      this.#byHost.set(hostId, issueId);
   }

   /**
    * Starts the site's server, or registers a static host, once per ready build.
    * `reuse` keeps a container that is already answering — a restarted Berry
    * process would otherwise kill it and wait out a cold start before the
    * preview could show.
    */
   #ensureServing(issueId: string, build: Build, reuse: boolean): Promise<void> {
      if (this.#runtime.has(issueId)) return Promise.resolve();
      const pending = this.#booting.get(issueId);
      if (pending) return pending;
      const say = (text: string) => {
         build.log = (build.log + text).slice(-LOG_LIMIT);
      };
      const work = this.#boot(issueId, build, say, reuse).finally(() => {
         if (this.#booting.get(issueId) === work) this.#booting.delete(issueId);
      });
      this.#booting.set(issueId, work);
      return work;
   }

   /** Resolves once the build has a host the preview can load. The server may still be starting. */
   async #untilHost(issueId: string): Promise<void> {
      for (let attempt = 0; attempt < 50; attempt += 1) {
         if (this.#runtime.has(issueId)) return;
         await new Promise((resolve) => setTimeout(resolve, 20));
      }
   }

   /**
    * Puts a ready build on its host. A project with its own `start` script is
    * run in a container and the host is proxied to it; any other build is the
    * static files, with client routes falling back to `index.html`.
    */
   async #boot(issueId: string, build: Build, say: (text: string) => void, reuse: boolean): Promise<void> {
      if (!this.#o.address || !build.outDir) return;
      const hostId = randomBytes(10).toString('hex');
      // Before any container work: the preview loads this host while a server starts.
      this.#register(issueId, hostId, null);
      const source = join(this.#taskDir(issueId), 'src');
      const project = await projectRoot(source);
      let pkg: { scripts?: Record<string, string> } | null = null;
      if (project) {
         try {
            pkg = JSON.parse(await readFile(join(project, 'package.json'), 'utf8')) as { scripts?: Record<string, string> };
         } catch {
            pkg = null;
         }
      }
      if (!project || !pkg || !servesItself(pkg)) return;
      const workdir = `/work/${relative(source, project).split(sep).join('/')}`.replace(/\/$/, '');
      const modules = modulesVolume(issueId);
      const name = siteRunName(issueId);
      const outName = build.outDir.split(sep).pop() || '.berry-out';
      if (reuse) {
         const port = await this.#reuse(name);
         if (port !== null) {
            say(`\nServing the site on its own host.\n`);
            this.#register(issueId, hostId, port);
            return;
         }
      }
      await this.#docker(['rm', '-f', name], 20_000);
      // Run the TypeScript entry with tsx when the project has one. Compiling
      // first (`tsc`) typechecks the whole server before a single page is
      // shown, and a project whose imports are not valid for `tsc` sits there
      // until the compile fails. `npm start` is for a server that is already
      // JavaScript.
      let command = ['npm', 'start'];
      const sources = tsxEntry(pkg);
      if (sources && existsSync(join(project, sources))) {
         say('\nStarting the site server.\n');
         command = ['npx', '--no-install', 'tsx', sources];
      } else if (existsSync(join(project, 'tsconfig.server.json'))) {
         say('\nCompiling the site server…\n');
         const compiled = await this.#docker(
            [
               ...this.#container(`${name}-tsc`, source, workdir, modules, false),
               this.#image,
               'sh', '-c', 'npx --no-install tsc -p tsconfig.server.json',
            ],
            this.#timeoutMs,
         );
         if (compiled.code !== 0) {
            say(compiled.output);
            say('\nThe site server did not compile, so the preview is serving the built pages only.\n');
            this.#register(issueId, hostId, null);
            return;
         }
      }
      const started = await this.#docker(
         [
            ...this.#container(name, source, workdir, modules, true),
            '-e', 'PORT=' + String(APP_PORT),
            '-e', 'ADMIN_AUTH_MODE=none',
            '-e', 'SERVE_STATIC=true',
            '-e', `DIST_DIR=${workdir}/${outName}`,
            this.#image,
            ...command,
         ],
         60_000,
      );
      if (started.code !== 0) {
         say(`\n${started.output.trim()}\nThe site server did not start, so the preview is serving the built pages only.\n`);
         this.#register(issueId, hostId, null);
         return;
      }
      const port = await this.#published(name, say);
      // Docker publishes the port as the container starts, before the process
      // is listening. Handing the page that address loads a refused connection
      // and the frame stays blank — a browser does not ask again.
      if (port === null || !(await this.#answering(port))) {
         say('\nThe site server did not stay up, so the preview is serving the built pages only.\n');
         this.#register(issueId, hostId, null);
         return;
      }
      say(`\nServing the site on its own host.\n`);
      this.#register(issueId, hostId, port);
   }

   /** Flags shared by the compile container and the long-running server, up to but not including the image. */
   #container(name: string, source: string, workdir: string, modules: string, detached: boolean): string[] {
      return [
         'run',
         ...(detached ? ['-d'] : ['--rm']),
         '--name', name,
         '--memory', '1g', '--cpus', '1', '--pids-limit', '256',
         '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
         '-e', 'CI=true',
         ...(detached ? ['-p', `${this.#o.publishAddr ?? '127.0.0.1'}::${APP_PORT}`] : []),
         '-v', `${source}:/work`,
         '-v', `${modules}:${workdir}/node_modules`,
         '-w', workdir,
      ];
   }

   /**
    * The published port of a site server that is already up, or null when this
    * task has no running container. Used when Berry itself restarted: the
    * container is still serving, and starting another would make the preview wait.
    */
   async #reuse(name: string): Promise<number | null> {
      const state = await this.#docker(['inspect', '-f', '{{.State.Running}}', name], 10_000);
      if (state.code !== 0 || state.output.trim() !== 'true') return null;
      const published = await this.#docker(['port', name, `${APP_PORT}/tcp`], 10_000);
      const found = /:(\d+)\s*$/m.exec(published.output.trim().split('\n')[0] ?? '')?.[1];
      if (published.code !== 0 || !found) return null;
      const port = Number(found);
      return (await this.#answersOnce(port)) ? port : null;
   }

   /** One check, for a container that claims to be running. A cold start uses {@link #answering}. */
   async #answersOnce(port: number): Promise<boolean> {
      if (this.#o.run) return true;
      const host = this.#o.hostAddr ?? '127.0.0.1';
      try {
         const response = await fetch(`http://${host}:${port}/`, { signal: AbortSignal.timeout(1000) });
         await response.body?.cancel();
         return response.status < 500;
      } catch {
         return false;
      }
   }

   /**
    * Whether the server answers. A test's stand-in for Docker does not listen,
    * so the published port is enough there.
    */
   async #answering(port: number): Promise<boolean> {
      if (this.#o.run) return true;
      const host = this.#o.hostAddr ?? '127.0.0.1';
      for (let attempt = 0; attempt < 50; attempt += 1) {
         try {
            const response = await fetch(`http://${host}:${port}/`, { signal: AbortSignal.timeout(1000) });
            await response.body?.cancel();
            if (response.status < 500) return true;
         } catch {
            // Not listening yet.
         }
         await new Promise((resolve) => setTimeout(resolve, 200));
      }
      return false;
   }

   /** The host port Docker published, once the server is actually up. */
   async #published(name: string, say: (text: string) => void): Promise<number | null> {
      for (let attempt = 0; attempt < 25; attempt += 1) {
         const published = await this.#docker(['port', name, `${APP_PORT}/tcp`], 10_000);
         const found = /:(\d+)\s*$/m.exec(published.output.trim().split('\n')[0] ?? '')?.[1];
         if (published.code === 0 && found) {
            const logs = await this.#docker(['logs', name], 10_000);
            if (logs.output.trim() !== '') say(logs.output.endsWith('\n') ? logs.output : `${logs.output}\n`);
            return Number(found);
         }
         const state = await this.#docker(['inspect', '-f', '{{.State.Running}}', name], 10_000);
         if (state.output.trim() !== 'true') {
            const logs = await this.#docker(['logs', name], 10_000);
            if (logs.output.trim() !== '') say(logs.output.endsWith('\n') ? logs.output : `${logs.output}\n`);
            return null;
         }
         await new Promise((resolve) => setTimeout(resolve, 200));
      }
      return null;
   }

   async #docker(args: string[], timeoutMs: number): Promise<{ code: number | null; output: string }> {
      let output = '';
      const code = await (this.#o.run ?? runDocker)(args, {
         timeoutMs,
         onOutput: (text) => {
            output += text;
         },
      });
      return { code, output };
   }

   async #slot(): Promise<void> {
      if (this.#running < MAX_CONCURRENT) {
         this.#running += 1;
         return;
      }
      await new Promise<void>((resolve) => this.#waiting.push(resolve));
      this.#running += 1;
   }

   #release(): void {
      this.#running -= 1;
      this.#waiting.shift()?.();
   }
}

function idle(): BuildStatus {
   return { state: 'idle', log: '', startedAt: null, finishedAt: null, url: null };
}

function text(message: string, status: number): Response {
   return new Response(message, { status, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } });
}

/** The request path, or null when it would leave the build. */
function safePath(request: Request): string | null {
   let path: string;
   try {
      path = decodeURIComponent(new URL(request.url).pathname);
   } catch {
      return null;
   }
   if (path.includes('\0') || path.split('/').includes('..')) return null;
   return path.replace(/^\/+/, '');
}

function mediaType(path: string): string {
   switch (path.split('.').pop()?.toLowerCase()) {
      case 'js':
      case 'mjs':
         return 'text/javascript; charset=utf-8';
      case 'css':
         return 'text/css; charset=utf-8';
      case 'json':
      case 'map':
         return 'application/json';
      case 'svg':
         return 'image/svg+xml';
      case 'png':
         return 'image/png';
      case 'jpg':
      case 'jpeg':
         return 'image/jpeg';
      case 'webp':
         return 'image/webp';
      case 'woff2':
         return 'font/woff2';
      default:
         return 'application/octet-stream';
   }
}

/**
 * Brings `source` up to the task's current files: each file written, and any
 * file the task no longer has removed, so a deleted page does not linger in
 * the next build. What a build leaves behind (its output, caches) stays.
 */
async function syncFiles(
   source: string,
   files: RunArtifact[],
   read: (file: RunArtifact) => Promise<Uint8Array>
): Promise<void> {
   await mkdir(source, { recursive: true });
   const wanted = new Set<string>();
   const queue = files.flatMap((file) => {
      const target = resolve(source, file.path);
      // Paths come from the agent. One that climbs out is skipped, not written.
      if (!target.startsWith(source + sep)) return [];
      wanted.add(target);
      return [{ file, target }];
   });
   // Fetched from storage several at a time: one by one, a project's few dozen
   // files took longer than its build.
   const worker = async (): Promise<void> => {
      for (let next = queue.shift(); next; next = queue.shift()) {
         await mkdir(dirname(next.target), { recursive: true });
         await writeFile(next.target, await read(next.file));
      }
   };
   await Promise.all(Array.from({ length: 8 }, worker));
   const kept = new Set(['node_modules', ...OUTPUT_DIRS]);
   const prune = async (dir: string): Promise<void> => {
      for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
         const full = join(dir, entry.name);
         if (entry.isDirectory()) {
            if (kept.has(entry.name)) continue;
            await prune(full);
         } else if (!wanted.has(full)) {
            await rm(full, { force: true });
         }
      }
   };
   await prune(source);
}

/** The folder of the shallowest package.json under `source`, or null. */
async function projectRoot(source: string): Promise<string | null> {
   const queue = [source];
   while (queue.length > 0) {
      const dir = queue.shift()!;
      const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
      if (entries.some((entry) => entry.isFile() && entry.name === 'package.json')) return dir;
      for (const entry of entries) {
         if (entry.isDirectory() && entry.name !== 'node_modules' && !entry.name.startsWith('.')) queue.push(join(dir, entry.name));
      }
   }
   return null;
}

function dockerAnswers(): Promise<boolean> {
   return runDocker(['version', '--format', '{{.Server.Version}}'], { timeoutMs: 10_000, onOutput: () => undefined })
      .then((code) => code === 0)
      .catch(() => false);
}

/** `docker` with an argument list (no shell), its output streamed, killed on timeout. */
function runDocker(args: string[], options: { timeoutMs: number; onOutput: (text: string) => void }): Promise<number | null> {
   return new Promise((done) => {
      const child = spawn('docker', args, { stdio: ['ignore', 'pipe', 'pipe'] });
      let timedOut = false;
      const name = args[0] === 'run' ? args[args.indexOf('--name') + 1] : undefined;
      const timer = setTimeout(() => {
         timedOut = true;
         if (name) spawn('docker', ['kill', name], { stdio: 'ignore' });
         child.kill('SIGKILL');
      }, options.timeoutMs);
      child.stdout.on('data', (chunk: Buffer) => options.onOutput(chunk.toString('utf8')));
      child.stderr.on('data', (chunk: Buffer) => options.onOutput(chunk.toString('utf8')));
      child.on('error', (error) => {
         clearTimeout(timer);
         options.onOutput(`${error.message}\n`);
         done(-1);
      });
      child.on('close', (code) => {
         clearTimeout(timer);
         done(timedOut ? null : code);
      });
   });
}
