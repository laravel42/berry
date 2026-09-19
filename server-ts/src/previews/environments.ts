import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { lstat, mkdir, readFile, readdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
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
/** Which Berry server started it. Two servers on one machine each clear only what is theirs. */
export const PREVIEW_OWNER_LABEL = 'berry.preview.owner';

/** Berry's own preview image (sandbox/preview/Dockerfile): Node with pnpm, yarn, bun and nvm, on Debian. Built on first use. */
export const PREVIEW_IMAGE = 'berry-preview:node22';
/** What a server without that Dockerfile falls back to: the same base, without the extra managers. */
const STOCK_IMAGE = 'node:22-bookworm-slim';
const PREVIEW_IMAGE_SOURCE = fileURLToPath(new URL('../../sandbox/preview', import.meta.url));

export type EnvironmentState = 'idle' | 'fetching' | 'starting' | 'ready' | 'failed' | 'unavailable';

export interface EnvironmentStatus {
   state: EnvironmentState;
   /** The commit the environment runs, when it has got as far as knowing. */
   commit: string | null;
   plan: {
      source: PreviewPlan['source'];
      /** Where the repository is mounted in every app's container: where a shell opens. */
      root: string;
      /** `workdir` is where the app's folder of the repository is mounted in its container: where a shell opens. */
      apps: Array<{ name: string; kind: string; primary: boolean; url: string; ready: boolean; workdir: string }>;
      services: string[];
   } | null;
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
   /**
    * This server, among the ones that may share the machine's Docker: its listen
    * address. What an earlier process of the same server left running is
    * removed at start-up; what another server is running is not.
    */
   owner?: string;
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
   /** Runs `docker exec …`, streaming. Injected by tests. */
   exec?: ExecRunner;
   clock?: () => number;
}

/** One command in one of a preview's containers, its output as it comes. Injected by tests. */
export type ExecRunner = (
   args: string[],
   options: { signal: AbortSignal; onOutput: (text: string) => void }
) => Promise<number | null>;

export interface ExecResult {
   exitCode: number | null;
   /** Where the shell was when the command ended: the next command's starting point. */
   cwd: string | null;
   /** Set when Berry ended it: it ran too long, or wrote too much. */
   stopped: 'timeout' | 'output' | null;
}

export class ExecRefused extends Error {
   override readonly name = 'ExecRefused';
}

const EXEC_TIMEOUT_SECONDS = 300;
const EXEC_OUTPUT_LIMIT = 1024 * 1024;
const EXEC_CONCURRENT = 4;

/**
 * What the container's shell runs. Fixed text: the person's command arrives in
 * `BERRY_CMD`, an environment variable, and is `eval`ed by the shell inside the
 * container — it is never spliced into a string a shell on this machine reads.
 * `eval` rather than a child shell so a `cd` moves this shell, whose directory
 * is reported on the way out and becomes the session's next starting point.
 * Where the image has nvm it is loaded first and pointed at the repository's
 * `.nvmrc`, so a terminal runs the same Node the app does.
 */
const EXEC_SCRIPT = `echo $$ > "$BERRY_PIDFILE" 2>/dev/null; [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" >/dev/null 2>&1 && nvm use >/dev/null 2>&1; eval "$BERRY_CMD"; berry_status=$?; rm -f "$BERRY_PIDFILE" 2>/dev/null; printf '\\036BERRY_CWD %s\\036' "$PWD"; exit $berry_status`;

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
   /** Commands people are running in its containers right now. */
   execs: number;
   /** Bumped when the environment is stopped, so a start still in flight gives up. */
   generation: number;
}

const LOG_LIMIT = 24_000;
const MAX_TREE_PATHS = 8_000;
const MAX_READ_BYTES = 256 * 1024;

export class PreviewEnvironments {
   readonly #o: PreviewEnvironmentsOptions;
   readonly #root: string;
   readonly #image: string | null;
   #imageReady: Promise<string> | null = null;
   /** An image check or build is in flight: whoever arrives now is waiting on it. */
   #imagePending = false;
   readonly #docker: DockerRunner;
   readonly #clock: () => number;
   readonly #owner: string;
   readonly #byIssue = new Map<string, Environment>();
   readonly #byId = new Map<string, Environment>();
   #available: Promise<boolean> | null = null;

   constructor(options: PreviewEnvironmentsOptions) {
      this.#o = options;
      // Under the home directory: Docker Desktop and Colima share only that with their VM.
      this.#root = options.root ?? join(homedir(), '.cache', 'berry', 'previews');
      // Null means Berry's own image, built when first needed; a caller that names one gets exactly that.
      this.#image = options.image ?? null;
      this.#docker = options.docker ?? runDocker;
      this.#clock = options.clock ?? Date.now;
      this.#owner = (options.owner ?? 'berry').replace(/[^A-Za-z0-9_.:-]/g, '_');
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
      const mine = `label=${PREVIEW_OWNER_LABEL}=${this.#owner}`;
      const containers = await this.#docker(['ps', '-aq', '--filter', mine]);
      const ids = containers.output.split('\n').map((line) => line.trim()).filter(Boolean);
      if (ids.length > 0) await this.#docker(['rm', '--force', ...ids]);
      const networks = await this.#docker(['network', 'ls', '-q', '--filter', mine]);
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
            root: REPOSITORY_ROOT,
            apps: env.plan.apps.map((app) => ({
               name: app.name,
               kind: app.kind,
               primary: app.primary,
               url: this.#o.origin(env.id, app.name),
               ready: env.apps.find((running) => running.app.name === app.name)?.ready ?? false,
               workdir: workdirOf(app),
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
         execs: 0,
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

   /**
    * Runs a person's command in one of the environment's containers: an app's,
    * where the repository is mounted, or a service's (`psql` in the database).
    *
    * The container is named from the plan — `target` only selects among the
    * processes the plan has — and it is the same locked-down container the app
    * runs in: no capabilities, bounded memory, CPU and processes, a private
    * network. A command cannot outlive its limit (`timeout` inside the
    * container, since killing the Docker client leaves the process running),
    * and one that is abandoned is killed by the pid it recorded.
    */
   async exec(
      issueId: string,
      input: { target: string; command: string; cwd?: string | null },
      options: { signal: AbortSignal; onOutput: (text: string) => void }
   ): Promise<ExecResult> {
      const env = this.#byIssue.get(issueId);
      if (!env?.plan || (env.state !== 'ready' && env.state !== 'starting')) throw new ExecRefused('The preview is not running, so there is no container to run a command in.');
      const app = env.plan.apps.find((candidate) => candidate.name === input.target);
      const service = env.plan.services.find((candidate) => candidate.name === input.target);
      if (!app && !service) throw new ExecRefused(`This preview has no process called ${input.target}.`);
      const command = input.command.trim();
      if (command === '' || command.length > 4000 || command.includes('\u0000')) throw new ExecRefused('That is not a command this terminal can run.');
      // A shell starts at the top of the checkout, like a terminal opened on a repository; the app's own folder is one `cd` away.
      const cwd = input.cwd ?? (app ? REPOSITORY_ROOT : null);
      if (cwd !== null && (!cwd.startsWith('/') || cwd.length > 1000 || /[\u0000\n]/.test(cwd))) throw new ExecRefused('That is not a directory.');
      if (env.execs >= EXEC_CONCURRENT) throw new ExecRefused('Too many commands are already running in this preview. Wait for one to finish, or stop it.');

      env.execs += 1;
      env.lastUsed = this.#clock();
      const container = `berry-pv-${env.id}-${input.target}`;
      const pidfile = `/tmp/.berry-exec-${randomBytes(6).toString('hex')}`;
      let written = 0;
      let tail = '';
      let stopped: ExecResult['stopped'] = null;
      const limit = new AbortController();
      const signal = AbortSignal.any([options.signal, limit.signal]);
      try {
         const exitCode = await (this.#o.exec ?? execDocker)(
            [
               'exec', '--interactive=false',
               ...(cwd === null ? [] : ['--workdir', cwd]),
               '--env', `BERRY_CMD=${command}`, '--env', `BERRY_PIDFILE=${pidfile}`, '--env', 'TERM=dumb', '--env', 'NO_COLOR=1',
               container, 'sh', '-c',
               // `timeout` is in busybox and in coreutils, which covers every image a preview runs.
               `if command -v timeout >/dev/null 2>&1; then exec timeout -s KILL ${EXEC_TIMEOUT_SECONDS} sh -c '${EXEC_SCRIPT.replaceAll("'", `'\\''`)}'; else exec sh -c '${EXEC_SCRIPT.replaceAll("'", `'\\''`)}'; fi`,
            ],
            {
               signal,
               onOutput: (text) => {
                  written += text.length;
                  if (written > EXEC_OUTPUT_LIMIT) {
                     stopped = 'output';
                     limit.abort();
                     return;
                  }
                  // The trailer may arrive split across chunks: hold back what could be its start.
                  const joined = tail + text;
                  const mark = joined.indexOf('\u001e');
                  if (mark === -1) {
                     tail = '';
                     options.onOutput(joined);
                  } else {
                     tail = joined.slice(mark);
                     if (mark > 0) options.onOutput(joined.slice(0, mark));
                  }
               },
            }
         );
         const reported = /^\u001eBERRY_CWD ([^\u001e]*)\u001e?$/.exec(tail)?.[1] ?? null;
         if (reported === null && tail !== '') options.onOutput(tail);
         if (exitCode === 137 && stopped === null && !options.signal.aborted) stopped = 'timeout';
         return { exitCode, cwd: reported && reported.startsWith('/') ? reported : null, stopped };
      } finally {
         env.execs -= 1;
         if (signal.aborted) {
            // The Docker client is gone; the process it started is not. Its children first, then it.
            void this.#docker(['exec', container, 'sh', '-c', `p=$(cat ${pidfile} 2>/dev/null) && { pkill -KILL -P "$p" 2>/dev/null; kill -KILL "$p" 2>/dev/null; rm -f ${pidfile}; }`], { timeoutMs: 10_000 }).catch(() => undefined);
         }
      }
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
      await this.#must(['network', 'create', '--label', `${PREVIEW_LABEL}=${env.id}`, '--label', `${PREVIEW_OWNER_LABEL}=${this.#owner}`, network], 'create the private network');
      env.network = network;
      for (const service of plan.services) {
         const container = `berry-pv-${env.id}-${service.name}`;
         env.containers.push(container);
         say(`Starting ${service.name} (${service.image})…\n`);
         await this.#must(serviceArgs({ id: env.id, owner: this.#owner, network, container, service }), `start ${service.name}`, 5 * 60_000);
         // A service's own output, under its name like an app's: a database that
         // refuses connections or a search node that runs out of memory says so there.
         env.stops.push((this.#o.follow ?? followLogs)(container, (text) => say(prefixLines(service.name, text))));
      }
      if (!live()) return;

      const image = await this.#appImage(say);
      if (!live()) return;
      const addresses = { url: (app: string) => this.#o.origin(env.id, app) };
      const modulesKey = env.issueId.replace(/[^a-z0-9]/gi, '').slice(0, 24).toLowerCase();
      for (const app of plan.apps) {
         const container = `berry-pv-${env.id}-${app.name}`;
         env.containers.push(container);
         await this.#must(
            appArgs({ id: env.id, owner: this.#owner, network, container, app, image, tree, modulesVolume: `berry-pv-nm-${modulesKey}-${app.name}`, env: resolveEnv(plan, app, addresses), services: plan.services }),
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

   /**
    * The image apps run in. Berry's own is built the first time a preview
    * needs it — a few minutes, once per machine — and said so in the log, so
    * the wait is not a mystery. One build at a time, shared by every preview
    * that arrives meanwhile; a build that fails is tried again by the next.
    */
   #appImage(say: (text: string) => void): Promise<string> {
      if (this.#image !== null) return Promise.resolve(this.#image);
      // Another preview got here first and may be building it: this one's log should not just stop.
      if (this.#imagePending) say('Waiting for the preview image, which another preview is getting ready…\n');
      this.#imagePending = true;
      this.#imageReady ??= (async () => {
         const present = await this.#docker(['image', 'inspect', '--format', '{{.Id}}', PREVIEW_IMAGE], { timeoutMs: 20_000 });
         if (present.code === 0) return PREVIEW_IMAGE;
         if (!existsSync(join(PREVIEW_IMAGE_SOURCE, 'Dockerfile'))) {
            say(`Berry's preview image is not on this server; using ${STOCK_IMAGE}, which has npm only.\n`);
            return STOCK_IMAGE;
         }
         say('Building the preview image (Node with pnpm, yarn, bun, nvm and Python). This happens once per machine and takes a few minutes…\n');
         const built = await this.#docker(['build', '--tag', PREVIEW_IMAGE, PREVIEW_IMAGE_SOURCE], { timeoutMs: 20 * 60_000 });
         if (built.code !== 0) throw new Error(`The preview image could not be built: ${built.output.trim().slice(-400)}`);
         say('The preview image is built.\n');
         return PREVIEW_IMAGE;
      })();
      const pending = this.#imageReady;
      pending
         .catch(() => {
            if (this.#imageReady === pending) this.#imageReady = null;
         })
         .finally(() => {
            this.#imagePending = false;
         });
      return pending;
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

/** Where the repository is mounted in an app's container. */
export const REPOSITORY_ROOT = '/work';

/** The app's folder of the repository, inside its container: where it installs, builds and starts. */
export function workdirOf(app: Pick<PreviewApp, 'dir'>): string {
   return app.dir === '.' ? REPOSITORY_ROOT : `${REPOSITORY_ROOT}/${app.dir}`;
}

const LIMITS = ['--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--pids-limit', '512'];

/** A backing store: the image's own entrypoint, the few capabilities an init script needs, nothing published. */
export function serviceArgs(input: { id: string; owner?: string; network: string; container: string; service: PreviewService }): string[] {
   const { service } = input;
   return [
      'run', '--detach', '--rm', '--name', input.container,
      '--label', `${PREVIEW_LABEL}=${input.id}`,
      ...(input.owner ? ['--label', `${PREVIEW_OWNER_LABEL}=${input.owner}`] : []),
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
   owner?: string;
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
   const workdir = workdirOf(app);
   return [
      'run', '--detach', '--rm', '--init', '--name', input.container,
      '--label', `${PREVIEW_LABEL}=${input.id}`,
      ...(input.owner ? ['--label', `${PREVIEW_OWNER_LABEL}=${input.owner}`] : []),
      '--network', input.network, '--network-alias', app.name,
      // Loopback, on a port Docker picks: only the preview proxy reaches it.
      '--publish', `127.0.0.1::${app.port}`,
      ...LIMITS, '--memory', '2g', '--cpus', '2',
      '--env', 'CI=true', '--env', 'NO_COLOR=1', '--env', 'FORCE_COLOR=0', '--env', 'npm_config_update_notifier=false',
      '--env', 'NEXT_TELEMETRY_DISABLED=1', '--env', `PORT=${app.port}`,
      // Every manager's download cache in the one volume that outlives the container.
      '--env', 'npm_config_store_dir=/root/.npm/_pnpm-store', '--env', 'YARN_CACHE_FOLDER=/root/.npm/_yarn', '--env', 'BUN_INSTALL_CACHE_DIR=/root/.npm/_bun',
      '--env', 'COREPACK_ENABLE_DOWNLOAD_PROMPT=0',
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
      lines.push(`echo "Waiting for ${service.name}…"`, waitFor(service.name, service.port));
   }
   // The Node the repository pins, when the image has nvm to fetch it with.
   lines.push('if [ -f .nvmrc ] && [ -s "${NVM_DIR:-/nonexistent}/nvm.sh" ]; then echo "Using the Node version in .nvmrc…"; . "$NVM_DIR/nvm.sh"; nvm install; fi');
   lines.push('echo "Installing…"', app.install);
   if (app.build) lines.push('echo "Building…"', app.build);
   if (app.migrate) lines.push('echo "Migrating…"', app.migrate);
   lines.push(`echo "Starting: ${app.start.replaceAll('"', '\\"').replaceAll('$', '\\$')}"`, `exec ${app.start}`);
   return lines.join('\n');
}

/** Waits for a port with Node, which every image an app runs in has; `nc` is not in all of them. */
function waitFor(host: string, port: number): string {
   return `node -e 'const net=require("net");let n=0;(function go(){const s=net.connect(${port},"${host}");s.on("connect",()=>process.exit(0));s.on("error",()=>{s.destroy();if(++n>240){console.error("${host} never answered on ${port}");process.exit(1)}setTimeout(go,500)})})()'`;
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

/** `docker exec`, its output streamed, ended with the signal. Resolves with the exit code. */
function execDocker(args: string[], options: { signal: AbortSignal; onOutput: (text: string) => void }): Promise<number | null> {
   return new Promise((resolve) => {
      const child = spawn('docker', args, { stdio: ['ignore', 'pipe', 'pipe'] });
      child.stdout.on('data', (chunk: Buffer) => options.onOutput(chunk.toString('utf8')));
      child.stderr.on('data', (chunk: Buffer) => options.onOutput(chunk.toString('utf8')));
      const end = () => child.kill('SIGKILL');
      options.signal.addEventListener('abort', end, { once: true });
      if (options.signal.aborted) end();
      child.on('error', () => resolve(null));
      child.on('close', (code) => {
         options.signal.removeEventListener('abort', end);
         resolve(code);
      });
   });
}
