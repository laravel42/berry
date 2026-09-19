import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import type { RunArtifact, RunArtifactRepository } from '../core/run-artifacts.ts';

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
 * back as files and served sandboxed like any other agent file.
 *
 * The folder lives under the home directory because Docker Desktop and Colima
 * share only that with their VM; a temp dir would mount empty.
 */

export type BuildState = 'idle' | 'building' | 'ready' | 'failed';

export interface BuildStatus {
   state: BuildState;
   /** The end of the build's output, for a person watching or reading a failure. */
   log: string;
   startedAt: string | null;
   finishedAt: string | null;
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
 * Vite is told to write relative asset URLs (`--base ./`) so the site works
 * under the preview's path; anything else runs its own `build` script.
 */
export function buildScript(packageJson: { scripts?: Record<string, string>; dependencies?: Record<string, string>; devDependencies?: Record<string, string> }): string {
   const deps = { ...packageJson.dependencies, ...packageJson.devDependencies };
   const install = 'npm install --no-audit --no-fund --loglevel=error';
   const build = deps.vite
      ? 'npx --no-install vite build --base ./ --outDir .berry-out --emptyOutDir'
      : packageJson.scripts?.build
        ? 'npm run build'
        : 'echo "package.json has no build script" && exit 2';
   return `set -e; echo "$ ${install}"; ${install}; echo "$ ${build}"; ${build}`;
}

export class SiteBuilds {
   readonly #o: SiteBuildOptions;
   readonly #root: string;
   readonly #image: string;
   readonly #timeoutMs: number;
   /** The latest build of each issue. */
   readonly #builds = new Map<string, Build>();
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
      return { state: build.state, log: build.log, startedAt: build.startedAt, finishedAt: build.finishedAt };
   }

   /**
    * Starts a build unless the current files are already built or building.
    * Returns at once; the build goes on in the background.
    */
   async start(issueId: string): Promise<BuildStatus> {
      const key = await this.#key(issueId);
      const current = await this.#current(issueId);
      if (current && current.key === key && current.state !== 'failed') return this.status(issueId);
      if (current?.state === 'building') return this.status(issueId);

      const build: Build = {
         key,
         state: 'building',
         log: '',
         outDir: null,
         startedAt: new Date().toISOString(),
         finishedAt: null,
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
   async #current(issueId: string): Promise<Build | undefined> {
      const held = this.#builds.get(issueId);
      if (held) return held;
      const key = await this.#key(issueId);
      try {
         const marker = JSON.parse(await readFile(join(this.#root, key, READY_MARKER), 'utf8')) as { outDir: string; log?: string };
         const outDir = resolve(marker.outDir);
         if (!outDir.startsWith(join(this.#root, key) + sep) || !existsSync(join(outDir, 'index.html'))) return undefined;
         const build: Build = { key, state: 'ready', log: marker.log ?? '', outDir, startedAt: null, finishedAt: null };
         this.#builds.set(issueId, build);
         return build;
      } catch {
         return undefined;
      }
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
      const folder = join(this.#root, build.key);
      try {
         if (!(await this.available())) {
            throw new Error('Docker is not available on this server, so the site cannot be built.');
         }
         await rm(folder, { recursive: true, force: true });
         const source = join(folder, 'src');
         const files = await this.#o.artifacts.listForIssue(issueId);
         say(`Collecting ${files.length} files…\n`);
         for (const file of files) {
            const target = resolve(source, file.path);
            // Paths come from the agent. One that climbs out is skipped, not written.
            if (!target.startsWith(source + sep)) continue;
            await mkdir(dirname(target), { recursive: true });
            await writeFile(target, await this.#o.read(file));
         }

         const project = await projectRoot(source);
         if (!project) throw new Error('No package.json was found, so there is nothing to build.');
         const packageJson = JSON.parse(await readFile(join(project, 'package.json'), 'utf8')) as Parameters<typeof buildScript>[0];
         const name = `berry-site-build-${build.key.slice(0, 12)}`;
         const workdir = `/work/${relative(source, project).split(sep).join('/')}`.replace(/\/$/, '');
         const code = await (this.#o.run ?? runDocker)(
            [
               'run', '--rm', '--name', name,
               '--memory', '2g', '--cpus', '2', '--pids-limit', '512',
               '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
               '-e', 'CI=true', '-e', 'npm_config_update_notifier=false',
               // Plain text: the log is read in a browser, not a terminal.
               '-e', 'NO_COLOR=1', '-e', 'FORCE_COLOR=0',
               '-v', `${source}:/work`, '-w', workdir,
               this.#image, 'sh', '-c', buildScript(packageJson),
            ],
            { timeoutMs: this.#timeoutMs, onOutput: say }
         );
         if (code !== 0) {
            throw new Error(code === null ? 'The build took too long and was stopped.' : `The build failed (exit ${code}).`);
         }
         const out = OUTPUT_DIRS.map((dir) => join(project, dir)).find((dir) => existsSync(join(dir, 'index.html')));
         if (!out) throw new Error(`The build finished but produced no index.html (looked in ${OUTPUT_DIRS.join(', ')}).`);
         build.outDir = resolve(out);
         build.state = 'ready';
         // Remembered on disk, so a restarted server serves this build rather
         // than installing and building the same files again.
         await writeFile(join(folder, READY_MARKER), JSON.stringify({ outDir: build.outDir, log: build.log.slice(-4000) }));
         say('\nBuilt.\n');
         await this.#forgetOthers(build.key);
      } catch (error) {
         build.state = 'failed';
         say(`\n${error instanceof Error ? error.message : String(error)}\n`);
      } finally {
         build.finishedAt = new Date().toISOString();
         this.#release();
      }
   }

   /** Older builds' folders, once a newer one is ready: node_modules adds up. */
   async #forgetOthers(keep: string): Promise<void> {
      const live = new Set([...this.#builds.values()].map((build) => build.key));
      live.add(keep);
      const entries = await readdir(this.#root).catch(() => [] as string[]);
      for (const entry of entries) {
         if (!live.has(entry)) await rm(join(this.#root, entry), { recursive: true, force: true }).catch(() => undefined);
      }
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
   return { state: 'idle', log: '', startedAt: null, finishedAt: null };
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
