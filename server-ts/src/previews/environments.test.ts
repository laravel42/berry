import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { PREVIEW_LABEL, PreviewEnvironments, appArgs, appScript, serviceArgs, type DockerRunner, type PreviewSource } from './environments.ts';
import type { PreviewApp, PreviewService } from './plan.ts';

const db: PreviewService = { name: 'db', image: 'postgres:16-alpine', port: 5432, env: { POSTGRES_PASSWORD: 'preview' } };
const api: PreviewApp = { name: 'api', dir: 'server', install: 'npm ci', build: 'npm run build', migrate: 'npm run migrate', start: 'npm start', port: 3000, env: {}, primary: false, kind: 'node' };

/** A repository as GitHub's tarball delivers it: one top-level folder. */
function archiveOf(files: Record<string, string>): PreviewSource {
   const dir = mkdtempSync(join(tmpdir(), 'berry-pv-src-'));
   for (const [path, content] of Object.entries(files)) {
      mkdirSync(join(dir, 'repo-abc', path, '..'), { recursive: true });
      writeFileSync(join(dir, 'repo-abc', path), content);
   }
   execFileSync('tar', ['-czf', join(dir, 'repo.tar.gz'), '-C', dir, 'repo-abc']);
   return { commit: 'c0ffee1234567', archive: async () => new Response(readFileSync(join(dir, 'repo.tar.gz'))) };
}

/** Docker that starts everything instantly and publishes each app on a port of its own. */
function fakeDocker(): { docker: DockerRunner; calls: string[][] } {
   const calls: string[][] = [];
   let port = 50_000;
   const ports = new Map<string, number>();
   const docker: DockerRunner = async (args) => {
      calls.push(args);
      if (args[0] === 'port') return { code: 0, output: `127.0.0.1:${ports.get(args[1]!) ?? ports.set(args[1]!, ++port).get(args[1]!)}\n` };
      if (args[0] === 'inspect') return { code: 0, output: 'true 0\n' };
      return { code: 0, output: '' };
   };
   return { docker, calls };
}

function environments(docker: DockerRunner, extra: Partial<ConstructorParameters<typeof PreviewEnvironments>[0]> = {}) {
   return new PreviewEnvironments({
      origin: (id, app) => `http://p-${id}-${app}.preview.localhost:4000`,
      root: mkdtempSync(join(tmpdir(), 'berry-pv-root-')),
      docker,
      follow: () => () => undefined,
      answers: async () => true,
      ...extra,
   });
}

async function settled(envs: PreviewEnvironments, issue: string) {
   for (let i = 0; i < 200; i += 1) {
      const status = envs.status(issue);
      if (status.state !== 'fetching' && status.state !== 'starting') return status;
      await new Promise((resolve) => setTimeout(resolve, 25));
   }
   throw new Error('the environment never settled');
}

test('an app runs the repository’s code with nothing but its source, a network and a ceiling', () => {
   const args = appArgs({ id: 'x1', network: 'net', container: 'c', app: api, image: 'node:22-alpine', tree: '/home/u/src', modulesVolume: 'nm', env: { DATABASE_URL: 'postgres://db/app' }, services: [db] });
   const line = args.join(' ');
   assert.ok(line.includes('--cap-drop ALL') && line.includes('--security-opt no-new-privileges'));
   assert.ok(line.includes('--memory 2g') && line.includes('--cpus 2') && line.includes('--pids-limit 512'));
   assert.ok(line.includes('--publish 127.0.0.1::3000'), 'loopback only, port chosen by Docker');
   assert.ok(line.includes('--volume /home/u/src:/work') && line.includes('--workdir /work/server'));
   assert.ok(line.includes('--volume nm:/work/server/node_modules'));
   assert.ok(line.includes(`--label ${PREVIEW_LABEL}=x1`) && line.includes('--network-alias api'));
   assert.ok(!line.includes('--privileged') && !line.includes('docker.sock') && !line.includes('--network host'));
});

test('a service is a backing store on the private network and is never published', () => {
   const line = serviceArgs({ id: 'x1', network: 'net', container: 'c', service: db }).join(' ');
   assert.ok(line.includes('--network net') && line.includes('--network-alias db') && line.includes('--env POSTGRES_PASSWORD=preview'));
   assert.ok(!line.includes('--publish'));
   assert.ok(serviceArgs({ id: 'x', network: 'n', container: 'c', service: { ...db, name: 'search', image: 'elasticsearch:8.15.0' } }).join(' ').includes('discovery.type=single-node'));
});

test('an app waits for its services, then installs, builds, migrates and becomes the server', () => {
   const script = appScript(api, [db]);
   const order = ['nc -z db 5432', 'npm ci', 'npm run build', 'npm run migrate', 'exec npm start'].map((step) => script.indexOf(step));
   assert.ok(order.every((at, index) => at >= 0 && (index === 0 || at > order[index - 1]!)), script);
   assert.ok(script.startsWith('set -e'));
});

test('a repository with a site and its API comes up whole, each app at its own address', async () => {
   const { docker, calls } = fakeDocker();
   const envs = environments(docker);
   const source = archiveOf({
      'web/package.json': JSON.stringify({ dependencies: { next: '15' }, scripts: { build: 'next build' } }),
      'web/.env.example': 'NEXT_PUBLIC_API_URL=\n',
      'server/package.json': JSON.stringify({ scripts: { start: 'node .' }, dependencies: { pg: '8' } }),
      'server/.env.example': 'DATABASE_URL=\n',
   });
   envs.start('issue-1', source);
   const status = await settled(envs, 'issue-1');
   assert.equal(status.state, 'ready', status.log);
   assert.deepEqual(status.plan!.apps.map((app) => [app.name, app.kind, app.primary, app.ready]), [['server', 'node', false, true], ['web', 'next', true, true]]);
   assert.deepEqual(status.plan!.services, ['db']);
   assert.match(status.url!, /^http:\/\/p-[0-9a-f]{20}-web\.preview\.localhost:4000$/);
   const id = /p-([0-9a-f]{20})-/.exec(status.url!)![1]!;
   assert.notEqual(envs.target(id, null), null);
   assert.notEqual(envs.target(id, 'server'), envs.target(id, 'web'));
   // The site was started knowing where a browser reaches the API.
   const web = calls.find((args) => args[0] === 'run' && args.includes('web'))!;
   assert.ok(web.includes(`NEXT_PUBLIC_API_URL=http://p-${id}-server.preview.localhost:4000`));
   // Services before apps, on one network.
   const started = calls.filter((args) => args[0] === 'run').map((args) => args[args.indexOf('--network-alias') + 1]);
   assert.deepEqual(started, ['db', 'server', 'web']);

   // The same commit again is the same environment; stopping takes everything away.
   envs.start('issue-1', source);
   assert.equal(envs.status('issue-1').url, status.url);
   await envs.stop('issue-1');
   assert.equal(envs.status('issue-1').state, 'idle');
   assert.equal(envs.target(id, null), null);
   assert.ok(calls.some((args) => args[0] === 'rm' && args.includes(`berry-pv-${id}-web`) && args.includes(`berry-pv-${id}-db`)));
   assert.ok(calls.some((args) => args[0] === 'network' && args[1] === 'rm'));
});

test('a repository with nothing to run, or a manifest that is refused, says why and starts nothing', async () => {
   const { docker, calls } = fakeDocker();
   const envs = environments(docker);
   envs.start('docs', archiveOf({ 'README.md': '# hi' }));
   const none = await settled(envs, 'docs');
   assert.equal(none.state, 'unavailable');
   assert.match(none.message!, /Nothing in this repository can be run/);
   envs.start('bad', archiveOf({ '.berry/preview.json': JSON.stringify({ apps: [{ name: 'web', start: 'x', port: 1 }], services: [{ name: 's', image: 'evil/miner', port: 1 }] }) }));
   const refused = await settled(envs, 'bad');
   assert.equal(refused.state, 'unavailable');
   assert.match(refused.message!, /previews do not run/);
   assert.equal(calls.filter((args) => args[0] === 'run').length, 0);
});

test('an app that exits before it answers fails the preview and leaves nothing running', async () => {
   const { docker, calls } = fakeDocker();
   const dying: DockerRunner = async (args) => (args[0] === 'inspect' ? { code: 0, output: 'false 1\n' } : docker(args));
   const envs = environments(dying, { answers: async () => false });
   envs.start('issue-2', archiveOf({ 'package.json': JSON.stringify({ dependencies: { next: '15' } }) }));
   const status = await settled(envs, 'issue-2');
   assert.equal(status.state, 'failed');
   assert.match(status.message!, /web stopped before it answered \(exit 1\)/);
   assert.ok(calls.some((args) => args[0] === 'rm'));
});

test('only a few environments run at once, and one nobody looks at is stopped', async () => {
   const { docker } = fakeDocker();
   let now = 0;
   const envs = environments(docker, { maxEnvironments: 2, idleMs: 1000, clock: () => now });
   const page = () => archiveOf({ 'index.html': '<h1>x</h1>' });
   for (const issue of ['a', 'b', 'c']) {
      now += 10;
      envs.start(issue, page());
      await settled(envs, issue);
   }
   assert.deepEqual(['a', 'b', 'c'].map((issue) => envs.status(issue).state), ['idle', 'ready', 'ready']);
   now += 900;
   envs.touch('c');
   now += 500;
   assert.equal(await envs.reap(), 1);
   assert.deepEqual(['b', 'c'].map((issue) => envs.status(issue).state), ['idle', 'ready']);
});

test('what an earlier process left running is removed by label', async () => {
   const calls: string[][] = [];
   const docker: DockerRunner = async (args) => {
      calls.push(args);
      if (args[0] === 'ps') return { code: 0, output: 'c1\nc2\n' };
      if (args[0] === 'network' && args[1] === 'ls') return { code: 0, output: 'n1\n' };
      return { code: 0, output: '' };
   };
   await environments(docker).removeOrphans();
   assert.ok(calls.some((args) => args.join(' ') === `ps -aq --filter label=${PREVIEW_LABEL}`));
   assert.ok(calls.some((args) => args.join(' ') === 'rm --force c1 c2'));
   assert.ok(calls.some((args) => args.join(' ') === 'network rm n1'));
});
