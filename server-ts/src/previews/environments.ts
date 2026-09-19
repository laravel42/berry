import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { lstat, mkdir, readFile, readdir, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { PlanRefused, planFor, resolveEnv, type PreviewApp, type PreviewPlan, type PreviewService, type RepositoryView } from './plan.ts';
import { NPM_CACHE_VOLUME } from './site-builds.ts';

/**
 * A task's work, running: the apps and services of its preview plan, started
 * from the commit its pull request points at, for a person to click through.
 *
 * One environment per task. Its apps run the repository's own code — install
 * scripts, build, server — so each is a container with no capabilities, no
 * host access but the checked-out source, and a ceiling on memory, CPU and
 * processes; its services are ordinary backing stores from an allowlist. They
 * share a private network where they reach each other by name, and each app
 * is published on a loopback port that only Berry's preview proxy talks to.
 *
 * Environments live in this process's memory. They are cheap to lose: a server
 * that restarts removes whatever an earlier one left (by label) and the next
 * look at a preview starts it again, from warm dependency volumes.
 */

export const PREVIEW_LABEL = 'berry.preview';

export type EnvironmentState = 'idle' | 'fetching' | 'starting' | 'ready' | 'failed' | 'unavailable';

export interface EnvironmentStatus {
   state: EnvironmentState;
   /** The commit the environment runs, when it has got as far as knowing. */
   commit: string | null;
   plan: { source: PreviewPlan['source']; apps: Array<{ name: string; kind: string; primary: boolean; url: string; ready: boolean }>; services: string[] } | null;
   /** Where the primary app answers, once it does. */
   url: string | null;
   log: string;
   /** Why there is no preview, or why it failed, in a sentence. */
   message: string | null;
   startedAt: string | null;
}

/** The commit to preview and the way to fetch its tree (a gzipped tarball with one top-level folder). */
export interface PreviewSource {
   commit: string;
   archive(): Promise<Response>;
}

export interface PreviewEnvironmentsOptions {
   /** The public origin of an app: `http://p-<id>-<app>.preview.localhost:4000`. */
   origin(id: string, app: string): string;
   root?: string;
   image?: string;
   idleMs?: number;
   maxEnvironments?: number;
   startTimeoutMs?: number;
   /** `docker <args>`, resolving with the exit code and output. Injected by tests. */
   docker?: DockerRunner;
   /** Follows a container's output until it ends. Injected by tests. */
   follow?: (container: string, onOutput: (text: string) => void) => () => void;
   /** Whether an app answers on its published port. Injected by tests. */
   answers?: (port: number) => Promise<boolean>;
   clock?: () => number;
}

export type DockerRunner = (args: string[], options?: { timeoutMs?: number }) => Promise<{ code: number | null; output: string }>;

interface RunningApp {
   app: PreviewApp;
   container: string;
   port: number | null;
   ready: boolean;
}

interface Environment {
   id: string;
   issueId: string;
   commit: string | null;
   state: EnvironmentState;
   plan: PreviewPlan | null;
   apps: RunningApp[];
   containers: string[];
   network: string | null;
   log: string;
   message: string | null;
   startedAt: number;
   lastUsed: number;
   stops: Array<() => void>;
   /** Bumped when the environment is stopped, so a start still in flight gives up. */
   generation: number;
}

const LOG_LIMIT = 24_000;
const MAX_TREE_PATHS = 8_000;
const MAX_READ_BYTES = 256 * 1024;

export class PreviewEnvironments {
   readonly #o: PreviewEnvironmentsOptions;
   readonly #root: string;
   readonly #image: string;
   readonly #docker: DockerRunner;
   readonly #clock: () => number;
   readonly #byIssue = new Map<string, Environment>();
   readonly #byId = new Map<string, Environment>();
   #available: Promise<boolean> | null = null;

   constructor(options: PreviewEnvironmentsOptions) {
      this.#o = options;
      // Under the home directory: Docker Desktop and Colima share only that with their VM.
      this.#root = options.root ?? join(homedir(), '.cache', 'berry', 'previews');
      this.#image = options.image ?? 'node:22-alpine';
      this.#docker = options.docker ?? runDocker;
      this.#clock = options.clock ?? Date.now;
   }

   available(): Promise<boolean> {
      this.#available ??= this.#docker(['version', '--format', '{{.Server.Version}}'], { timeoutMs: 10_000 })
         .then((result) => result.code === 0)
         .catch(() => false);
      return this.#available;
   }

   /** Removes what an earlier server process left running. Called once at start-up. */
   async removeOrphans(): Promise<void> {
      if (!(await this.available())) return;
      const containers = await this.#docker(['ps', '-aq', '--filter', `label=${PREVIEW_LABEL}`]);
      const ids = containers.output.split('\n').map((line) => line.trim()).filter(Boolean);
      if (ids.length > 0) await this.#docker(['rm', '--force', ...ids]);
      const networks = await this.#docker(['network', 'ls', '-q', '--filter', `label=${PREVIEW_LABEL}`]);
      for (const network of networks.output.split('\n').map((line) => line.trim()).filter(Boolean)) {
         await this.#docker(['network', 'rm', network]);
      }
   }

   status(issueId: string): EnvironmentStatus {
      const env = this.#byIssue.get(issueId);
      if (!env) return { state: 'idle', commit: null, plan: null, url: null, log: '', message: null, startedAt: null };
      const primary = env.apps.find((running) => running.app.primary);
      return {
         state: env.state,
         commit: env.commit,
         plan: env.plan && {
            source: env.plan.source,
            apps: env.plan.apps.map((app) => ({
               name: app.name,
               kind: app.kind,
               primary: app.primary,
               url: this.#o.origin(env.id, app.name),
               ready: env.apps.find((running) => running.app.name === app.name)?.ready ?? false,
            })),
            services: env.plan.services.map((service) => service.name),
         },
         url: env.state === 'ready' && primary ? this.#o.origin(env.id, primary.app.name) : null,
         log: env.log,
         message: env.message,
         startedAt: new Date(env.startedAt).toISOString(),
      };
   }

   /**
    * Starts the task's environment, or returns the one already running the same
    * commit. A new commit, or `force`, replaces it. Returns at once: the work is
    * followed through `status`.
    */
   start(issueId: string, source: PreviewSource, options: { force?: boolean } = {}): EnvironmentStatus {
      const current = this.#byIssue.get(issueId);
      const reusable = current && current.commit === source.commit && current.state !== 'failed' && current.state !== 'unavailable';
      if (current && reusable && !options.force) {
         current.lastUsed = this.#clock();
         return this.status(issueId);
      }
      const replaced = current ? this.#stop(current) : Promise.resolve();
      const env: Environment = {
         id: randomBytes(10).toString('hex'),
         issueId,
         commit: source.commit,
         state: 'fetching',
         plan: null,
         apps: [],
         containers: [],
         network: null,
         log: '',
         message: null,
         startedAt: this.#clock(),
         lastUsed: this.#clock(),
         stops: [],
         generation: 0,
      };
      this.#byIssue.set(issueId, env);
      this.#byId.set(env.id, env);
      void replaced
         .then(() => this.#makeRoom(env))
         .then(() => this.#run(env, source))
         .catch((error: unknown) => this.#fail(env, error));
      return this.status(issueId);
   }

   /** Someone has the preview open: it is not idle, even if the page in it makes no requests. */
   touch(issueId: string): void {
      const env = this.#byIssue.get(issueId);
      if (env) env.lastUsed = this.#clock();
   }

   /** The loopback port behind a preview host name, and a note that someone is looking. */
   target(id: string, appName: string | null): number | null {
      const env = this.#byId.get(id);
      if (!env) return null;
      env.lastUsed = this.#clock();
      const running = appName === null ? env.apps.find((entry) => entry.app.primary) : env.apps.find((entry) => entry.app.name === appName);
      return running?.port ?? null;
   }

   async stop(issueId: string): Promise<void> {
      const env = this.#byIssue.get(issueId);
      if (env) await this.#stop(env);
   }

   /** Stops environments nobody has looked at for a while. Called on a timer. */
   async reap(): Promise<number> {
      const cutoff = this.#clock() - (this.#o.idleMs ?? 15 * 60_000);
      const idle = [...this.#byIssue.values()].filter((env) => env.lastUsed < cutoff);
      await Promise.all(idle.map((env) => this.#stop(env)));
      return idle.length;
   }

   async stopAll(): Promise<void> {
      await Promise.all([...this.#byIssue.values()].map((env) => this.#stop(env)));
   }

   /** A full stack is two to four containers: only a few fit on one machine, and the least recently seen goes first. */
   async #makeRoom(arriving: Environment): Promise<void> {
      const max = Math.max(1, this.#o.maxEnvironments ?? 3);
      const others = [...this.#byIssue.values()].filter((env) => env !== arriving).sort((a, b) => a.lastUsed - b.lastUsed);
      while (others.length >= max) await this.#stop(others.shift()!);
   }

   async #run(env: Environment, source: PreviewSource): Promise<void> {
      const generation = env.generation;
      const live = () => env.generation === generation && this.#byId.get(env.id) === env;
      const say = (text: string) => {
         env.log = (env.log + text).slice(-LOG_LIMIT);
      };

      if (!(await this.available())) throw new Error('This server cannot run previews: Docker is not available.');
      say(`Fetching commit ${source.commit.slice(0, 7)}…\n`);
      const folder = join(this.#root, env.issueId.replace(/[^A-Za-z0-9-]/g, ''));
      const tree = join(folder, 'src');
      await rm(tree, { recursive: true, force: true });
      await mkdir(tree, { recursive: true });
      const archive = join(folder, 'src.tar.gz');
      const response = await source.archive();
      if (!response.ok || !response.body) throw new Error(`The repository could not be downloaded (${response.status}).`);
      await pipeline(Readable.fromWeb(response.body as never), createWriteStream(archive));
      await extract(archive, tree);
      await rm(archive, { force: true });
      if (!live()) return;

      let plan: PreviewPlan | null;
      try {
         plan = planFor(await viewOf(tree));
      } catch (error) {
         if (!(error instanceof PlanRefused)) throw error;
         env.state = 'unavailable';
         env.message = error.message;
         say(`${error.message}\n`);
         return;
      }
      if (!plan) {
         env.state = 'unavailable';
         env.message = 'Nothing in this repository can be run for a preview yet: no web app, server or page was found, and there is no .berry/preview.json.';
         return;
      }
      env.plan = plan;
      env.state = 'starting';
      say(`Preview plan (${plan.source === 'manifest' ? 'from .berry/preview.json' : 'detected'}): ${plan.apps.map((app) => `${app.name} [${app.kind}] in ${app.dir}`).join(', ')}${plan.services.length ? `; services: ${plan.services.map((service) => service.image).join(', ')}` : ''}\n`);

      const network = `berry-pv-${env.id}`;
      await this.#must(['network', 'create', '--label', `${PREVIEW_LABEL}=${env.id}`, network], 'create the private network');
      env.network = network;
      for (const service of plan.services) {
         const container = `berry-pv-${env.id}-${service.name}`;
         env.containers.push(container);
         say(`Starting ${service.name} (${service.image})…\n`);
         await this.#must(serviceArgs({ id: env.id, network, container, service }), `start ${service.name}`, 5 * 60_000);
      }
      if (!live()) return;

      const addresses = { url: (app: string) => this.#o.origin(env.id, app) };
      const modulesKey = env.issueId.replace(/[^a-z0-9]/gi, '').slice(0, 24).toLowerCase();
      for (const app of plan.apps) {
         const container = `berry-pv-${env.id}-${app.name}`;
         env.containers.push(container);
         await this.#must(
            appArgs({ id: env.id, network, container, app, image: this.#image, tree, modulesVolume: `berry-pv-nm-${modulesKey}-${app.name}`, env: resolveEnv(plan, app, addresses), services: plan.services }),
            `start ${app.name}`
         );
         const running: RunningApp = { app, container, port: null, ready: false };
         env.apps.push(running);
         env.stops.push((this.#o.follow ?? followLogs)(container, (text) => say(prefixLines(app.name, text))));
      }

      const deadline = this.#clock() + (this.#o.startTimeoutMs ?? 12 * 60_000);
      const answers = this.#o.answers ?? answersOn;
      while (live()) {
         for (const running of env.apps) {
            if (running.ready) continue;
            running.port ??= await this.#publishedPort(running.container, running.app.port);
            if (running.port !== null && (await answers(running.port))) {
               running.ready = true;
               say(`${running.app.name} is answering.\n`);
               continue;
            }
            const state = await this.#docker(['inspect', '--format', '{{.State.Running}} {{.State.ExitCode}}', running.container]);
            // `--rm` takes a finished container away, so not finding it is the same answer as finding it stopped.
            const stopped = /^false (\d+)/.exec(state.output.trim());
            if (state.code !== 0 || stopped) {
               throw new Error(`${running.app.name} stopped before it answered${stopped ? ` (exit ${stopped[1]})` : ''}. Its output above says why.`);
            }
         }
         if (env.apps.every((running) => running.ready)) {
            env.state = 'ready';
            say('The preview is ready.\n');
            return;
         }
         if (this.#clock() > deadline) throw new Error('The preview did not start in time. The log above shows how far it got.');
         await new Promise((resolve) => setTimeout(resolve, 1_000));
      }
   }

   async #publishedPort(container: string, port: number): Promise<number | null> {
      const result = await this.#docker(['port', container, `${port}/tcp`]);
      const found = /:(\d+)\s*$/m.exec(result.output.trim().split('\n')[0] ?? '')?.[1];
      return result.code === 0 && found ? Number(found) : null;
   }

   async #must(args: string[], what: string, timeoutMs = 60_000): Promise<void> {
      const result = await this.#docker(args, { timeoutMs });
      if (result.code !== 0) throw new Error(`Could not ${what}: ${result.output.trim().slice(-400) || `docker exited ${result.code}`}`);
   }

   #fail(env: Environment, error: unknown): void {
      if (this.#byId.get(env.id) !== env) return;
      env.state = 'failed';
      env.message = error instanceof Error ? error.message : String(error);
      env.log = (env.log + `\n${env.message}\n`).slice(-LOG_LIMIT);
      // A failed environment holds nothing a person can look at; its log is kept, its containers are not.
      void this.#release(env);
   }

   async #stop(env: Environment): Promise<void> {
      env.generation += 1;
      if (this.#byIssue.get(env.issueId) === env) this.#byIssue.delete(env.issueId);
      this.#byId.delete(env.id);
      await this.#release(env);
   }

   async #release(env: Environment): Promise<void> {
      for (const stop of env.stops.splice(0)) stop();
      const containers = env.containers.splice(0);
      if (containers.length > 0) await this.#docker(['rm', '--force', ...containers]).catch(() => undefined);
      if (env.network) await this.#docker(['network', 'rm', env.network]).catch(() => undefined);
      env.network = null;
      for (const running of env.apps) running.port = null;
   }
}

const LIMITS = ['--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--pids-limit', '512'];

/** A backing store: the image's own entrypoint, the few capabilities an init script needs, nothing published. */
export function serviceArgs(input: { id: string; network: string; container: string; service: PreviewService }): string[] {
   const { service } = input;
   return [
      'run', '--detach', '--rm', '--name', input.container,
      '--label', `${PREVIEW_LABEL}=${input.id}`,
      '--network', input.network, '--network-alias', service.name,
      '--cap-drop', 'ALL',
      // What an official image's entrypoint does before dropping to its own user: own its data directory.
      ...['CHOWN', 'SETUID', 'SETGID', 'FOWNER', 'DAC_OVERRIDE'].flatMap((cap) => ['--cap-add', cap]),
      '--security-opt', 'no-new-privileges',
      '--memory', '1g', '--cpus', '1', '--pids-limit', '512',
      ...Object.entries(service.env).flatMap(([key, value]) => ['--env', `${key}=${value}`]),
      // Elasticsearch and OpenSearch refuse to start as a cluster of one without being told they are one.
      ...(/elasticsearch|opensearch/.test(service.image) ? ['--env', 'discovery.type=single-node', '--env', 'xpack.security.enabled=false', '--env', 'DISABLE_SECURITY_PLUGIN=true', '--env', 'ES_JAVA_OPTS=-Xms512m -Xmx512m'] : []),
      service.image,
   ];
}

export function appArgs(input: {
   id: string;
   network: string;
   container: string;
   app: PreviewApp;
   image: string;
   tree: string;
   modulesVolume: string;
   env: Record<string, string>;
   services: PreviewService[];
}): string[] {
   const { app } = input;
   const workdir = app.dir === '.' ? '/work' : `/work/${app.dir}`;
   return [
      'run', '--detach', '--rm', '--init', '--name', input.container,
      '--label', `${PREVIEW_LABEL}=${input.id}`,
      '--network', input.network, '--network-alias', app.name,
      // Loopback, on a port Docker picks: only the preview proxy reaches it.
      '--publish', `127.0.0.1::${app.port}`,
      ...LIMITS, '--memory', '2g', '--cpus', '2',
      '--env', 'CI=true', '--env', 'NO_COLOR=1', '--env', 'FORCE_COLOR=0', '--env', 'npm_config_update_notifier=false',
      '--env', 'NEXT_TELEMETRY_DISABLED=1', '--env', `PORT=${app.port}`,
      ...Object.entries(input.env).flatMap(([key, value]) => ['--env', `${key}=${value}`]),
      '--volume', `${input.tree}:/work`,
      // Kept per task and app in Docker's own storage: a restart of the same dependencies skips the install.
      '--volume', `${input.modulesVolume}:${workdir}/node_modules`,
      '--volume', `${NPM_CACHE_VOLUME}:/root/.npm`,
      '--workdir', workdir,
      input.image, 'sh', '-c', appScript(app, input.services),
   ];
}

/**
 * What an app's container runs: wait for its services, install, build,
 * migrate, then become the server. Each stage is announced, so a log that
 * stops says where.
 */
export function appScript(app: PreviewApp, services: PreviewService[]): string {
   const lines = ['set -e'];
   for (const service of services) {
      lines.push(
         `echo "Waiting for ${service.name}…"`,
         `i=0; until nc -z ${service.name} ${service.port} 2>/dev/null; do i=$((i+1)); if [ $i -gt 240 ]; then echo "${service.name} never answered on ${service.port}"; exit 1; fi; sleep 0.5; done`
      );
   }
   lines.push('echo "Installing…"', app.install);
   if (app.build) lines.push('echo "Building…"', app.build);
   if (app.migrate) lines.push('echo "Migrating…"', app.migrate);
   lines.push(`echo "Starting: ${app.start.replaceAll('"', '\\"').replaceAll('$', '\\$')}"`, `exec ${app.start}`);
   return lines.join('\n');
}

function prefixLines(name: string, text: string): string {
   return text.split('\n').map((line, index, all) => (line === '' && index === all.length - 1 ? '' : `[${name}] ${line}`)).join('\n');
}

/** The tree as detection sees it: real files only, never through a link, and never the heavy folders. */
async function viewOf(tree: string): Promise<RepositoryView> {
   const paths: string[] = [];
   const walk = async (dir: string, prefix: string): Promise<void> => {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
         if (paths.length >= MAX_TREE_PATHS) return;
         if (entry.name === 'node_modules' || entry.name === '.git') continue;
         const path = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
         if (entry.isDirectory()) await walk(join(dir, entry.name), path);
         else if (entry.isFile()) paths.push(path);
      }
   };
   await walk(tree, '');
   const known = new Set(paths);
   const texts = new Map<string, string | null>();
   // Read ahead of `planFor`, which is synchronous: the few files detection can ask for.
   const wanted = paths.filter((path) => /(^|\/)(package\.json|\.env\.example)$/.test(path) || path === '.berry/preview.json').slice(0, 60);
   for (const path of wanted) {
      const full = join(tree, path);
      const info = await lstat(full);
      texts.set(path, info.isFile() && info.size <= MAX_READ_BYTES ? await readFile(full, 'utf8') : null);
   }
   return { paths, read: (path) => (known.has(path) ? (texts.get(path) ?? null) : null) };
}

/** GitHub's tarball has one top-level folder; its contents become the tree. */
function extract(archive: string, into: string): Promise<void> {
   return new Promise((resolve, reject) => {
      const child = spawn('tar', ['-xzf', archive, '--strip-components=1', '--no-same-owner', '-C', into], { stdio: ['ignore', 'ignore', 'pipe'] });
      let err = '';
      child.stderr.on('data', (chunk: Buffer) => { err += chunk.toString('utf8'); });
      child.on('error', reject);
      child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`The repository archive could not be unpacked: ${err.trim().slice(0, 300)}`))));
   });
}

function runDocker(args: string[], options: { timeoutMs?: number } = {}): Promise<{ code: number | null; output: string }> {
   return new Promise((resolve) => {
      const child = spawn('docker', args, { stdio: ['ignore', 'pipe', 'pipe'] });
      let output = '';
      const take = (chunk: Buffer) => { output = (output + chunk.toString('utf8')).slice(-8_000); };
      child.stdout.on('data', take);
      child.stderr.on('data', take);
      const timer = setTimeout(() => child.kill('SIGKILL'), options.timeoutMs ?? 60_000);
      child.on('error', (error) => { clearTimeout(timer); resolve({ code: null, output: error.message }); });
      child.on('close', (code) => { clearTimeout(timer); resolve({ code, output }); });
   });
}

function followLogs(container: string, onOutput: (text: string) => void): () => void {
   const child = spawn('docker', ['logs', '--follow', container], { stdio: ['ignore', 'pipe', 'pipe'] });
   child.stdout.on('data', (chunk: Buffer) => onOutput(chunk.toString('utf8')));
   child.stderr.on('data', (chunk: Buffer) => onOutput(chunk.toString('utf8')));
   child.on('error', () => undefined);
   return () => child.kill('SIGTERM');
}

/** Any HTTP answer counts — a 404 from a server is a server. */
async function answersOn(port: number): Promise<boolean> {
   return fetch(`http://127.0.0.1:${port}/`, { redirect: 'manual', signal: AbortSignal.timeout(3_000) }).then(() => true).catch(() => false);
}
