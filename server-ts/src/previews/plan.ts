import { z } from 'zod';

/**
 * How a repository is run for a preview.
 *
 * The first preview served files: an `index.html`, or a Vite build's output.
 * That has a ceiling a real product passes on its second task — a Next.js app
 * has no `index.html`, a server-rendered page needs its server, a frontend
 * needs the API it calls and the API needs its database. A plan is the answer
 * to "what has to be running for a person to click through this": the apps
 * (each a folder with an install, a build and a start), the services beside
 * them, and how they find each other.
 *
 * It comes from one of two places. The repository can say so itself in
 * `.berry/preview.json`, which agents are told to write and keep true — the
 * only reliable source for anything unusual. Without one the plan is inferred
 * from what is in the tree, conservatively: a wrong guess costs a failed
 * preview with a log that says why, not a wrong product.
 *
 * Pure: it is handed file paths and the few files it needs to read, and
 * returns data. What runs the plan is `environments.ts`.
 */

export const MANIFEST_PATH = '.berry/preview.json';

const NAME = /^[a-z][a-z0-9-]{0,30}$/;
const name = z.string().regex(NAME, 'lowercase letters, digits and dashes, starting with a letter');
const envMap = z.record(z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/), z.string().max(2000));
const command = z.string().min(1).max(500);

export const manifestSchema = z.object({
   apps: z
      .array(
         z.object({
            name,
            /** The folder the app lives in, relative to the repository root. */
            dir: z.string().max(200).default('.'),
            install: command.optional(),
            build: command.optional(),
            /** Runs once the app's services answer and before it starts: migrations, a seed. */
            migrate: command.optional(),
            start: command,
            port: z.number().int().min(1).max(65535),
            env: envMap.default({}),
            /** The app a person sees first. Defaults to the first app. */
            primary: z.boolean().optional(),
         })
      )
      .min(1)
      .max(4),
   services: z
      .array(
         z.object({
            name,
            image: z.string().min(1).max(200),
            port: z.number().int().min(1).max(65535),
            env: envMap.default({}),
         })
      )
      .max(4)
      .default([]),
});

export interface PreviewApp {
   name: string;
   dir: string;
   install: string;
   build: string | null;
   migrate: string | null;
   start: string;
   port: number;
   env: Record<string, string>;
   primary: boolean;
   /** What this app was recognised as, for the person reading the log. */
   kind: string;
}

export interface PreviewService {
   name: string;
   image: string;
   port: number;
   env: Record<string, string>;
}

export interface PreviewPlan {
   source: 'manifest' | 'detected';
   apps: PreviewApp[];
   services: PreviewService[];
}

export class PlanRefused extends Error {
   override readonly name = 'PlanRefused';
}

/**
 * Images a preview may start beside an app.
 *
 * The manifest is written by an agent, and an image is code that runs on this
 * machine. Apps run the repository's own code in a fixed Node image; a service
 * is one of the ordinary backing stores, by its official name, and nothing else.
 */
const SERVICE_IMAGES = /^(?:docker\.io\/(?:library\/)?)?(postgres|redis|valkey\/valkey|mysql|mariadb|mongo|elasticsearch|opensearchproject\/opensearch|minio\/minio|axllent\/mailpit|docker\.elastic\.co\/elasticsearch\/elasticsearch)(?::[A-Za-z0-9._-]{1,60})?$/;

export function allowedServiceImage(image: string): boolean {
   return SERVICE_IMAGES.test(image);
}

export type PackageManager = 'npm' | 'pnpm' | 'yarn' | 'bun';

/**
 * The manager a folder was written for, from the lockfile it committed: the
 * app's own, else the repository's (a workspace keeps one at the root).
 * Installing a pnpm or yarn project with npm ignores its lockfile and resolves
 * a different tree than the one the agent tested.
 */
export function packageManagerFor(paths: readonly string[], dir: string): PackageManager {
   for (const folder of dir === '.' ? ['.'] : [dir, '.']) {
      const has = (file: string) => paths.includes(folder === '.' ? file : `${folder}/${file}`);
      if (has('pnpm-lock.yaml')) return 'pnpm';
      if (has('yarn.lock')) return 'yarn';
      if (has('bun.lock') || has('bun.lockb')) return 'bun';
      if (has('package-lock.json')) return 'npm';
   }
   return 'npm';
}

/** Where the repository sits in an app's container (`environments.ts` REPOSITORY_ROOT). */
const REPOSITORY_ROOT_DIR = '/work';

const PNPM_BUILDS = '--config.dangerously-allow-all-builds=true';

/**
 * With dev dependencies, whatever NODE_ENV says: the build tool (vite, tsc,
 * next's own compiler plugins) is one, and a production install leaves it out.
 * The lockfile is honoured first and relaxed only if it cannot be.
 */
export function installCommand(manager: PackageManager): string {
   switch (manager) {
      case 'pnpm':
         // pnpm 11 and later refuse an install whose dependencies have build
         // scripts the repository never approved (ERR_PNPM_IGNORED_BUILDS):
         // esbuild and sharp, in most sites. A preview already runs the
         // repository's own build, so its dependencies' builds add no trust.
         return `pnpm install --frozen-lockfile --prod=false ${PNPM_BUILDS} || pnpm install --prod=false ${PNPM_BUILDS}`;
      case 'yarn':
         // Berry's flag first, then classic's: the repository decides which yarn this is.
         return 'NODE_ENV=development yarn install --immutable 2>/dev/null || NODE_ENV=development yarn install --frozen-lockfile || NODE_ENV=development yarn install';
      case 'bun':
         return 'bun install --frozen-lockfile || bun install';
      default:
         return 'if [ -f package-lock.json ]; then npm ci --include=dev || npm install --include=dev; else npm install --include=dev; fi';
   }
}

/** `npm run build`, in the repository's manager. */
export function runScript(manager: PackageManager, script: string): string {
   return manager === 'yarn' ? `yarn run ${script}` : `${manager} run ${script}`;
}

/**
 * What a manifest app installs with when it names nothing: the manager its
 * lockfile names (the app's folder's, else the repository root's, as
 * `packageManagerFor` reads them), and only where there is a package.json.
 * A static site's manifest names a start command and no install, and an
 * unconditional `npm install` failed its preview at "Installing…" for want of
 * a package.json it never needed. And npm on a pnpm project ignored its
 * lockfile and resolved the whole tree again, minutes spent at "Installing…".
 */
const DEFAULT_INSTALL = [
   'if [ ! -f package.json ]; then echo "No package.json: nothing to install."',
   `elif [ -f pnpm-lock.yaml ] || [ -f ${REPOSITORY_ROOT_DIR}/pnpm-lock.yaml ]; then ${installCommand('pnpm')}`,
   `elif [ -f yarn.lock ] || [ -f ${REPOSITORY_ROOT_DIR}/yarn.lock ]; then ${installCommand('yarn')}`,
   `elif [ -f bun.lock ] || [ -f bun.lockb ] || [ -f ${REPOSITORY_ROOT_DIR}/bun.lock ] || [ -f ${REPOSITORY_ROOT_DIR}/bun.lockb ]; then ${installCommand('bun')}`,
   `else ${installCommand('npm')}`,
   'fi',
].join('; ');

/** A manifest, checked and completed. Throws `PlanRefused` with a sentence a person can act on. */
export function planFromManifest(text: string): PreviewPlan {
   let raw: unknown;
   try {
      raw = JSON.parse(text);
   } catch {
      throw new PlanRefused(`${MANIFEST_PATH} is not valid JSON.`);
   }
   const parsed = manifestSchema.safeParse(raw);
   if (!parsed.success) {
      const issue = parsed.error.issues[0]!;
      throw new PlanRefused(`${MANIFEST_PATH}: ${issue.path.join('.') || 'manifest'}: ${issue.message}`);
   }
   const { apps, services } = parsed.data;
   const names = [...apps.map((app) => app.name), ...services.map((service) => service.name)];
   const repeated = names.find((value, index) => names.indexOf(value) !== index);
   if (repeated) throw new PlanRefused(`${MANIFEST_PATH}: "${repeated}" is used twice; every app and service needs its own name.`);
   for (const app of apps) {
      if (safeDir(app.dir) === null) throw new PlanRefused(`${MANIFEST_PATH}: app "${app.name}" has a dir outside the repository.`);
   }
   for (const service of services) {
      if (!allowedServiceImage(service.image)) {
         throw new PlanRefused(`${MANIFEST_PATH}: service "${service.name}" uses image "${service.image}", which previews do not run. Use an official postgres, redis, valkey, mysql, mariadb, mongo, elasticsearch, opensearch, minio or mailpit image.`);
      }
   }
   const primary = apps.findIndex((app) => app.primary === true);
   const front = apps[primary === -1 ? 0 : primary]!;
   return {
      source: 'manifest',
      apps: apps.map((app, index) => ({
         name: app.name,
         dir: safeDir(app.dir)!,
         install: app.install ?? DEFAULT_INSTALL,
         build: app.build ?? null,
         migrate: app.migrate ?? null,
         start: app.start,
         port: app.port,
         // Every app of a preview has an origin of its own, so the page people
         // open calls the others across origins. A detected plan tells each API
         // which page to allow; a manifest is written by someone who does not
         // know the preview's address, and almost never says. One that does is
         // left as written.
         env: app === front || 'CORS_ORIGIN' in app.env ? app.env : { ...app.env, CORS_ORIGIN: `\${apps.${front.name}.url}` },
         primary: index === (primary === -1 ? 0 : primary),
         kind: 'declared',
      })),
      services: services.map((service) => ({ ...service })),
   };
}

/** The folder, normalised and inside the repository; null when it would leave it. */
export function safeDir(dir: string): string | null {
   const parts: string[] = [];
   for (const segment of dir.replaceAll('\\', '/').split('/')) {
      if (segment === '' || segment === '.') continue;
      if (segment === '..') return null;
      parts.push(segment);
   }
   if (dir.trim().startsWith('/')) return null;
   return parts.join('/') || '.';
}

/** What detection reads: every path in the tree, and the text of the few files it asks for. */
export interface RepositoryView {
   paths: readonly string[];
   read(path: string): string | null;
}

interface PackageJson {
   scripts?: Record<string, string>;
   dependencies?: Record<string, string>;
   devDependencies?: Record<string, string>;
}

/**
 * The plan for a repository: its manifest when it has one, else what the tree
 * shows. Null when nothing in it can be run for a person to look at.
 */
export function planFor(view: RepositoryView): PreviewPlan | null {
   const manifest = view.read(MANIFEST_PATH);
   const plan = manifest !== null ? planFromManifest(manifest) : detect(view);
   if (!plan) return null;
   // A manifest is the source for how to start, not for every public value the
   // build inlines. Those live in `.env.example`, and a detected plan already
   // set the ones it rewrites (an API's address). Fill only what is still absent.
   fillPublicExample(plan, view);
   for (const app of plan.apps) detachServerFromBuild(app, view);
   return plan;
}

/** Inlined into the bundle. A secret does not use one of these prefixes. */
const PUBLIC_ENV = /^(?:EXPO_PUBLIC_|NEXT_PUBLIC_|VITE_|PUBLIC_)/;

/** `KEY=value` lines from an env example, quotes removed, comments skipped. */
function exampleEntries(text: string): Array<[string, string]> {
   return [...text.matchAll(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=[ \t]*(.*)$/gm)].map((match) => [
      match[1]!,
      match[2]!.trim().replace(/^["']|["']$/g, ''),
   ]);
}

function exampleFor(app: PreviewApp, view: RepositoryView): Array<[string, string]> {
   const path = app.dir === '.' ? '.env.example' : `${app.dir}/.env.example`;
   const text = view.read(path);
   return text === null ? [] : exampleEntries(text);
}

/** Copies a non-empty public example value onto an app that has not set that name. */
function fillPublicExample(plan: PreviewPlan, view: RepositoryView): void {
   for (const app of plan.apps) {
      for (const [key, value] of exampleFor(app, view)) {
         if (!PUBLIC_ENV.test(key) || value === '' || key in app.env) continue;
         app.env[key] = value;
      }
   }
}

/**
 * Public names the example leaves blank and nobody has filled in.
 *
 * Expo and the others inline these at build time, so a blank one becomes a
 * crash after install, inside Metro. The project's preview environment is
 * where the value belongs; naming it here is the stop before that install.
 */
export function blankPublicExample(plan: PreviewPlan, view: RepositoryView, provided: Record<string, string>): string[] {
   const missing: string[] = [];
   for (const app of plan.apps) {
      for (const [key, value] of exampleFor(app, view)) {
         if (!PUBLIC_ENV.test(key)) continue;
         const chosen = provided[key] ?? app.env[key] ?? value;
         if (chosen === '' && !missing.includes(key)) missing.push(key);
      }
   }
   return missing;
}

/** The program a command runs, past a leading assignment and `npx`. */
function commandName(command: string): string {
   const words = command.trim().split(/\s+/);
   let index = 0;
   while (index < words.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[index] ?? '')) index += 1;
   let name = words[index] ?? '';
   if (name === 'npx' || name === 'bunx') {
      name = words.slice(index + 1).find((word) => !word.startsWith('-')) ?? name;
   }
   const slash = name.lastIndexOf('/');
   if (slash >= 0) name = name.slice(slash + 1);
   const version = name.indexOf('@');
   if (version > 0) name = name.slice(0, version);
   return name;
}

/**
 * A build has to finish. `preview:web` that is `expo export && serve` never
 * does: serve is the start command, and under `set -e` a failed export exits
 * before start runs. The serving half is dropped, and the rest stays the build.
 */
function detachServerFromBuild(app: PreviewApp, view: RepositoryView): void {
   if (!app.build) return;
   const start = commandName(app.start);
   if (!start) return;
   let body = app.build;
   const invoked = /^(?:npm|pnpm|yarn|bun)(?:\s+run)?\s+(\S+)$/.exec(app.build.trim());
   if (invoked) {
      const text = view.read(app.dir === '.' ? 'package.json' : `${app.dir}/package.json`);
      if (text === null) return;
      let scripts: Record<string, string> = {};
      try {
         scripts = (JSON.parse(text) as PackageJson).scripts ?? {};
      } catch {
         return;
      }
      const script = scripts[invoked[1]!];
      if (!script) return;
      body = script;
   }
   const segments = body.split(/\s&&\s/).map((part) => part.trim()).filter(Boolean);
   const server = segments.findIndex((segment) => commandName(segment) === start);
   if (server <= 0) return;
   app.build = segments.slice(0, server).join(' && ');
}

/** Folders worth looking in: the root and one level down, where monorepo apps live (`web/`, `server/`). */
function candidateDirs(paths: readonly string[]): string[] {
   const dirs = new Set<string>();
   for (const path of paths) {
      const parts = path.split('/');
      if (parts.includes('node_modules') || parts[0]?.startsWith('.')) continue;
      const file = parts.at(-1)!;
      if (file !== 'package.json' && file !== 'index.html') continue;
      if (parts.length === 1) dirs.add('.');
      else if (parts.length === 2) dirs.add(parts[0]!);
      else if (parts.length === 3 && (parts[0] === 'apps' || parts[0] === 'packages')) dirs.add(`${parts[0]}/${parts[1]}`);
   }
   return [...dirs].sort((a, b) => (a === '.' ? -1 : b === '.' ? 1 : a.localeCompare(b)));
}

function detect(view: RepositoryView): PreviewPlan | null {
   const found: Array<PreviewApp & { frontend: boolean; pkg: PackageJson | null }> = [];
   const used = new Set<string>();
   for (const dir of candidateDirs(view.paths)) {
      const at = (file: string) => (dir === '.' ? file : `${dir}/${file}`);
      const text = view.read(at('package.json'));
      let pkg: PackageJson | null = null;
      if (text !== null) {
         try { pkg = JSON.parse(text) as PackageJson; } catch { pkg = null; }
      }
      const app = pkg ? appFromPackage(pkg, packageManagerFor(view.paths, dir)) : view.paths.includes(at('index.html')) ? STATIC_SITE : null;
      if (!app) continue;
      let appName = (dir === '.' ? (app.frontend ? 'web' : 'app') : dir.split('/').at(-1)!).toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/^[^a-z]+/, '') || 'app';
      appName = appName.slice(0, 24);
      while (used.has(appName)) appName = `${appName}-2`;
      used.add(appName);
      found.push({ ...app, name: appName, dir, env: {}, primary: false, pkg });
   }
   if (found.length === 0) return null;
   // A workspace root that only orchestrates its packages is not an app of its own.
   const apps = (found.length > 1 ? found.filter((app) => !(app.dir === '.' && app.kind === 'node')) : found).slice(0, 4);
   if (apps.length === 0) return null;

   const frontends = apps.filter((app) => app.frontend);
   const backends = apps.filter((app) => !app.frontend);
   (frontends[0] ?? apps[0]!).primary = true;
   // Distinct ports, so two apps that both default to 3000 can share a network
   // without surprising anyone reading the log.
   apps.forEach((app, index) => { app.port = 3000 + index; });

   const services: PreviewService[] = [];
   for (const app of apps) {
      const deps = { ...(app.pkg?.dependencies ?? {}), ...(app.pkg?.devDependencies ?? {}) };
      const example = view.read(app.dir === '.' ? '.env.example' : `${app.dir}/.env.example`) ?? '';
      const examples = new Map([...example.matchAll(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=[ \t]*(.*)$/gm)].map((match) => [match[1]!, match[2]!.trim().replace(/^["']|["']$/g, '')]));
      const keys = new Set(examples.keys());
      app.env.PORT = String(app.port);
      app.env.NODE_ENV = 'production';
      app.env.HOST = '0.0.0.0';
      if (keys.has('DATABASE_URL') && ['pg', 'postgres', 'prisma', '@prisma/client', 'drizzle-orm', 'knex', 'typeorm', 'sequelize'].some((dep) => dep in deps)) {
         if (!services.some((service) => service.name === 'db')) {
            services.push({ name: 'db', image: 'postgres:16-alpine', port: 5432, env: { POSTGRES_PASSWORD: 'preview', POSTGRES_DB: 'app' } });
         }
         app.env.DATABASE_URL = 'postgres://postgres:preview@db:5432/app';
         app.migrate = migrateCommand(app.pkg?.scripts ?? {}, deps, packageManagerFor(view.paths, app.dir));
      }
      const searchKey = ['ELASTICSEARCH_NODE', 'ELASTICSEARCH_URL', 'ELASTIC_URL'].find((key) => keys.has(key));
      if (searchKey && '@elastic/elasticsearch' in deps) {
         if (!services.some((service) => service.name === 'search')) {
            services.push({ name: 'search', image: 'docker.elastic.co/elasticsearch/elasticsearch:8.15.0', port: 9200, env: {} });
         }
         app.env[searchKey] = 'http://search:9200';
      }
      if (keys.has('REDIS_URL') && ['redis', 'ioredis', 'bullmq'].some((dep) => dep in deps)) {
         if (!services.some((service) => service.name === 'redis')) services.push({ name: 'redis', image: 'redis:7-alpine', port: 6379, env: {} });
         app.env.REDIS_URL = 'redis://redis:6379';
      }
      // The frontend's pointer at its API, when there is exactly one API to point at.
      if (app.frontend && backends.length === 1) {
         for (const key of keys) {
            if (/(^|_)API_(URL|BASE|BASE_URL|ORIGIN|HOST)$/.test(key)) {
               const address = key.startsWith('NEXT_PUBLIC_') || key.startsWith('VITE_') || key.startsWith('PUBLIC_')
                  ? `\${apps.${backends[0]!.name}.url}`
                  : `\${apps.${backends[0]!.name}.internal}`;
               // The example says where under the API the app expects to call:
               // `http://localhost:3001/api` is the API's address and `/api`.
               // Without the path every request the page makes is a 404.
               app.env[key] = `${address}${pathOf(examples.get(key) ?? '')}`;
            }
         }
      }
   }
   // The API has to allow the page that calls it.
   for (const backend of backends) {
      if (frontends[0]) backend.env.CORS_ORIGIN ??= `\${apps.${frontends[0].name}.url}`;
   }
   return {
      source: 'detected',
      apps: apps.map(({ frontend: _frontend, pkg: _pkg, ...app }) => app),
      services,
   };
}

/**
 * How the project applies its schema, by the names projects give it. A
 * database that starts empty and is never migrated answers every real request
 * with "relation does not exist", which reads as a broken server.
 */
const MIGRATE_SCRIPTS = ['migrate', 'db:migrate', 'migrate:up', 'migrate:latest', 'migrate:deploy', 'db:migrate:up', 'migration:run', 'db:push', 'prisma:migrate'];

function migrateCommand(scripts: Record<string, string>, deps: Record<string, string>, manager: PackageManager): string | null {
   const script = MIGRATE_SCRIPTS.find((name) => name in scripts);
   if (script) return runScript(manager, script);
   if ('prisma' in deps || '@prisma/client' in deps) return 'npx prisma migrate deploy';
   return null;
}

/** The path of an example URL, without a trailing slash; empty when it has none or is not a URL. */
function pathOf(value: string): string {
   try {
      const path = new URL(value).pathname.replace(/\/+$/, '');
      return /^[A-Za-z0-9/_.~-]*$/.test(path) ? path : '';
   } catch {
      return '';
   }
}

const STATIC_SITE = {
   kind: 'static',
   frontend: true,
   install: 'true',
   build: null,
   migrate: null,
   start: 'npx --yes serve@14 -l tcp://0.0.0.0:$PORT .',
   port: 3000,
};

function appFromPackage(pkg: PackageJson, manager: PackageManager): Omit<PreviewApp, 'name' | 'dir' | 'env' | 'primary'> & { frontend: boolean } | null {
   const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
   const scripts = pkg.scripts ?? {};
   const build = scripts.build ? runScript(manager, 'build') : null;
   const base = { install: installCommand(manager), migrate: null, port: 3000 };
   if ('next' in deps) return { ...base, kind: 'next', frontend: true, build: build ?? 'npx next build', start: 'npx next start -H 0.0.0.0 -p $PORT' };
   if ('astro' in deps) return { ...base, kind: 'astro', frontend: true, build: build ?? 'npx astro build', start: 'npx astro preview --host 0.0.0.0 --port $PORT' };
   if ('@sveltejs/kit' in deps || 'vite' in deps) {
      return { ...base, kind: 'vite', frontend: true, build: build ?? 'npx vite build', start: 'npx vite preview --host 0.0.0.0 --port $PORT --strictPort' };
   }
   if ('react-scripts' in deps) return { ...base, kind: 'cra', frontend: true, build: build ?? 'npx react-scripts build', start: 'npx --yes serve@14 -s build -l tcp://0.0.0.0:$PORT' };
   if (scripts.start) return { ...base, kind: 'node', frontend: false, build, start: runScript(manager, 'start') };
   return null;
}

/** Where each app and service can be reached, for `${...}` references in env values. */
export interface Addresses {
   /** Public origin of an app, as the person's browser reaches it. */
   url(app: string): string;
}

/**
 * Env values with their references filled in: `${apps.api.url}` is where a
 * browser reaches the app, `${apps.api.internal}` where another container
 * does, `${services.db.host}` a service's name on the private network.
 * An unknown reference is left as written, and shows up in the log as itself.
 */
export function resolveEnv(plan: PreviewPlan, app: PreviewApp, addresses: Addresses): Record<string, string> {
   const resolved: Record<string, string> = {};
   for (const [key, value] of Object.entries(app.env)) {
      resolved[key] = value.replace(/\$\{(apps|services)\.([a-z][a-z0-9-]*)\.(url|internal|host|port)\}/g, (whole, group: string, target: string, field: string) => {
         if (group === 'apps') {
            const other = plan.apps.find((candidate) => candidate.name === target);
            if (!other) return whole;
            if (field === 'url') return addresses.url(other.name);
            if (field === 'internal') return `http://${other.name}:${other.port}`;
            return field === 'host' ? other.name : String(other.port);
         }
         const service = plan.services.find((candidate) => candidate.name === target);
         if (!service || field === 'url' || field === 'internal') return whole;
         return field === 'host' ? service.name : String(service.port);
      });
   }
   return resolved;
}
