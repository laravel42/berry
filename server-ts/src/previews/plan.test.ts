import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MANIFEST_PATH, PlanRefused, allowedServiceImage, installCommand, packageManagerFor, planFor, planFromManifest, resolveEnv, safeDir, type RepositoryView } from './plan.ts';

function repo(files: Record<string, string | object>): RepositoryView {
   const text = (value: string | object) => (typeof value === 'string' ? value : JSON.stringify(value));
   return { paths: Object.keys(files), read: (path) => (path in files ? text(files[path]!) : null) };
}

/** The shape of the gallery product the agents built: a Next.js site, its API, and Postgres. */
const gallery = repo({
   'LICENSE': '',
   'web/package.json': { scripts: { build: 'next build', start: 'next start' }, dependencies: { next: '15', react: '19' } },
   'web/.env.example': 'NEXT_PUBLIC_API_URL=http://localhost:3001/api\n',
   'web/app/page.tsx': '',
   'server/package.json': { scripts: { build: 'tsc', start: 'node dist/index.js', migrate: 'node dist/db/migrate.js' }, dependencies: { express: '4', pg: '8', '@elastic/elasticsearch': '8' } },
   'server/.env.example': 'PORT=3001\nDATABASE_URL=postgres://localhost/app\nCORS_ORIGIN=http://localhost:3000\nELASTICSEARCH_NODE=http://localhost:9200\n',
   'server/node_modules/x/package.json': { scripts: { start: 'nope' } },
});

test('a Next.js site with no index.html is an app to run, not a page to find', () => {
   const plan = planFor(repo({ 'package.json': { dependencies: { next: '15' }, scripts: { build: 'next build' } }, 'app/page.tsx': '' }))!;
   assert.equal(plan.source, 'detected');
   assert.deepEqual(plan.apps.map((app) => [app.name, app.kind, app.dir, app.primary]), [['web', 'next', '.', true]]);
   assert.match(plan.apps[0]!.start, /next start .*-p \$PORT/);
   assert.equal(plan.apps[0]!.build, 'npm run build');
});

test('a frontend, its API and the database it needs are found and wired together', () => {
   const plan = planFor(gallery)!;
   assert.deepEqual(plan.apps.map((app) => [app.name, app.kind, app.primary]), [['server', 'node', false], ['web', 'next', true]]);
   assert.deepEqual(plan.services, [
      { name: 'db', image: 'postgres:16-alpine', port: 5432, env: { POSTGRES_PASSWORD: 'preview', POSTGRES_DB: 'app' } },
      { name: 'search', image: 'docker.elastic.co/elasticsearch/elasticsearch:8.15.0', port: 9200, env: {} },
   ]);
   assert.equal(plan.apps[0]!.env.ELASTICSEARCH_NODE, 'http://search:9200');
   const [server, web] = plan.apps;
   assert.equal(server!.env.DATABASE_URL, 'postgres://postgres:preview@db:5432/app');
   assert.equal(server!.migrate, 'npm run migrate');
   assert.notEqual(server!.port, web!.port);
   const addresses = { url: (app: string) => `http://p-abc-${app}.preview.localhost:4000` };
   // The browser reaches the API at its public address; the API allows the page that calls it.
   // …under the path the project's own example calls it at: without `/api` every request is a 404.
   assert.equal(resolveEnv(plan, web!, addresses).NEXT_PUBLIC_API_URL, 'http://p-abc-server.preview.localhost:4000/api');
   assert.equal(resolveEnv(plan, server!, addresses).CORS_ORIGIN, 'http://p-abc-web.preview.localhost:4000');
   assert.equal(resolveEnv(plan, server!, addresses).PORT, String(server!.port));
});

test('the schema is applied under whatever name the project gives its migrations', () => {
   const server = (scripts: Record<string, string>, dependencies: Record<string, string> = { pg: '8' }) =>
      planFor(repo({ 'package.json': { scripts: { start: 'node .', ...scripts }, dependencies }, '.env.example': 'DATABASE_URL=\n' }))!.apps[0]!.migrate;
   assert.equal(server({ 'migrate:up': 'tsx src/db/migrate.ts up', 'migrate:down': 'x' }), 'npm run migrate:up');
   assert.equal(server({ migrate: 'x', 'migrate:up': 'y' }), 'npm run migrate');
   assert.equal(server({}, { '@prisma/client': '6' }), 'npx prisma migrate deploy');
   assert.equal(server({}), null);
});

test('a repository is installed, built and started with the package manager it committed a lockfile for', () => {
   const paths = ['pnpm-lock.yaml', 'apps/site/package.json', 'server/package.json', 'server/yarn.lock', 'tool/package.json', 'tool/bun.lock'];
   assert.deepEqual(['apps/site', 'server', 'tool', '.'].map((dir) => packageManagerFor(paths, dir)), ['pnpm', 'yarn', 'bun', 'pnpm']);
   assert.equal(packageManagerFor(['package.json'], '.'), 'npm');
   const plan = planFor(repo({ 'pnpm-lock.yaml': '', 'package.json': { scripts: { build: 'tsc', start: 'node .', 'migrate:up': 'x' }, dependencies: { pg: '8' } }, '.env.example': 'DATABASE_URL=\n' }))!;
   const app = plan.apps[0]!;
   assert.match(app.install, /^pnpm install --frozen-lockfile --prod=false/);
   assert.deepEqual([app.build, app.start, app.migrate], ['pnpm run build', 'pnpm run start', 'pnpm run migrate:up']);
   // Dev dependencies are installed under every manager: the build tool is one.
   for (const manager of ['npm', 'pnpm', 'yarn', 'bun'] as const) assert.doesNotMatch(installCommand(manager), /--production(?!=false)|--prod(?!=false)/);
});

test('a Vite project, a static page and a repository with nothing to run', () => {
   assert.equal(planFor(repo({ 'package.json': { devDependencies: { vite: '6' }, scripts: { build: 'vite build' } }, 'index.html': '' }))!.apps[0]!.kind, 'vite');
   assert.equal(planFor(repo({ 'index.html': '<h1>hi</h1>', 'style.css': '' }))!.apps[0]!.kind, 'static');
   assert.equal(planFor(repo({ 'README.md': '', 'infra/main.tf': '' })), null);
   assert.equal(planFor(repo({ 'package.json': { scripts: { test: 'vitest' } } })), null);
});

test('a workspace root that only orchestrates is not an app beside its packages', () => {
   const plan = planFor(repo({
      'package.json': { scripts: { start: 'turbo run start' } },
      'apps/site/package.json': { dependencies: { astro: '5' } },
   }))!;
   assert.deepEqual(plan.apps.map((app) => [app.name, app.dir, app.kind]), [['site', 'apps/site', 'astro']]);
});

test('the repository’s own manifest wins, completed with defaults', () => {
   const plan = planFor(repo({
      ...Object.fromEntries(gallery.paths.map((path) => [path, gallery.read(path)!])),
      [MANIFEST_PATH]: {
         apps: [
            { name: 'api', dir: 'server', build: 'npm run build', migrate: 'npm run migrate', start: 'node dist/index.js', port: 3001, env: { DATABASE_URL: 'postgres://postgres:pw@${services.db.host}:${services.db.port}/gifs' } },
            { name: 'site', dir: './web/', start: 'npx next start -p 3000', port: 3000, primary: true, env: { NEXT_PUBLIC_API_URL: '${apps.api.url}' } },
         ],
         services: [{ name: 'db', image: 'postgres:16-alpine', port: 5432, env: { POSTGRES_PASSWORD: 'pw', POSTGRES_DB: 'gifs' } }],
      },
   }))!;
   assert.equal(plan.source, 'manifest');
   assert.deepEqual(plan.apps.map((app) => [app.name, app.dir, app.primary]), [['api', 'server', false], ['site', 'web', true]]);
   assert.match(plan.apps[1]!.install, /npm ci/);
   assert.equal(resolveEnv(plan, plan.apps[0]!, { url: () => '' }).DATABASE_URL, 'postgres://postgres:pw@db:5432/gifs');
});

test('a manifest that cannot be trusted or understood is refused in words a person can act on', () => {
   const refuse = (manifest: unknown, pattern: RegExp) =>
      assert.throws(() => planFromManifest(typeof manifest === 'string' ? manifest : JSON.stringify(manifest)), (error: unknown) => error instanceof PlanRefused && pattern.test(error.message));
   const app = { name: 'web', start: 'npm start', port: 3000 };
   refuse('{not json', /not valid JSON/);
   refuse({ apps: [] }, /apps/);
   refuse({ apps: [{ ...app, dir: '../../etc' }] }, /outside the repository/);
   refuse({ apps: [app, app] }, /used twice/);
   refuse({ apps: [{ ...app, name: 'Web App' }] }, /lowercase/);
   refuse({ apps: [app], services: [{ name: 'x', image: 'evil/miner:latest', port: 1 }] }, /previews do not run/);
});

test('only ordinary backing stores may run beside an app', () => {
   for (const image of ['postgres:16-alpine', 'redis', 'valkey/valkey:8', 'docker.io/library/postgres:16', 'opensearchproject/opensearch:2', 'docker.elastic.co/elasticsearch/elasticsearch:8.15.0']) {
      assert.equal(allowedServiceImage(image), true, image);
   }
   for (const image of ['evil/postgres', 'postgres:16 --privileged', 'ghcr.io/x/postgres', 'postgres@sha256:abc', '']) {
      assert.equal(allowedServiceImage(image), false, image);
   }
});

test('a folder is normalised and never leaves the repository', () => {
   assert.deepEqual(['.', './web/', 'apps//site', '../x', '/abs', 'a/../../b'].map(safeDir), ['.', 'web', 'apps/site', null, null, null]);
});
