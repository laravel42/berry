import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import type { RunArtifact } from '../core/run-artifacts.ts';
import { buildScript, dependencyHash, NEEDS_BUILD, NPM_CACHE_VOLUME, SiteBuilds } from './site-builds.ts';

const ISSUE = '6f1c0c52-2c6e-4d7c-9a47-0f7f3c1c9b10';

function artifact(path: string, id = path): RunArtifact {
   return {
      id, issueId: ISSUE, runId: 'r', workspaceId: 'w', path, name: path.split('/').pop()!, directory: '',
      contentType: 'text/plain', sizeBytes: 1, storageKey: path, agentName: 'Frontend Engineer', createdAt: '',
   };
}

const PROJECT: Record<string, string> = {
   'package.json': JSON.stringify({ scripts: { build: 'vite build' }, devDependencies: { vite: '^7' } }),
   'index.html': '<div id="root"></div><script type="module" src="/src/main.tsx"></script>',
   'src/main.tsx': 'console.log(1)',
   '../escape.txt': 'nope',
};

function builds_(files: Record<string, string>, run: (args: string[], work: string) => Promise<number | null>) {
   const listed = Object.keys(files).map((path) => artifact(path));
   return mkdtemp(join(tmpdir(), 'berry-builds-')).then((root) => ({
      root,
      builds: new SiteBuilds({
         root,
         artifacts: { listForIssue: async () => listed },
         read: async (file) => new TextEncoder().encode(files[file.path] ?? ''),
         available: async () => true,
         run: async (args, options) => {
            options.onOutput('installing\n');
            const mount = args[args.indexOf('-v') + 1]!.split(':')[0]!;
            return run(args, mount);
         },
      }),
   }));
}

async function settled(sites: SiteBuilds) {
   for (let i = 0; i < 100; i += 1) {
      const status = await sites.status(ISSUE);
      if (status.state !== 'building') return status;
      await new Promise((resolve) => setTimeout(resolve, 10));
   }
   throw new Error('build never settled');
}

test('a Vite project is built with relative asset URLs; anything else runs its own build', () => {
   assert.match(buildScript({ devDependencies: { vite: '^7' } }, 'abc'), /vite build --base \.\/ --outDir \.berry-out/);
   assert.match(buildScript({ scripts: { build: 'react-scripts build' } }, 'abc'), /npm run build/);
   assert.match(buildScript({}, 'abc'), /no build script/);
   assert.equal(NEEDS_BUILD.test('<script type="module" src="/src/main.tsx"></script>'), true);
   assert.equal(NEEDS_BUILD.test('<script src="app.js"></script>'), false);
});

test('the project is built in a locked-down container, and its output is served', async () => {
   let seen: string[] = [];
   const { builds: sites, root } = await builds_(PROJECT, async (args, work) => {
      seen = args;
      await mkdir(join(work, '.berry-out', 'assets'), { recursive: true });
      await writeFile(join(work, '.berry-out', 'index.html'), '<script src="./assets/app.js"></script>');
      await writeFile(join(work, '.berry-out', 'assets', 'app.js'), 'built()');
      return 0;
   });
   await sites.start(ISSUE);
   const status = await settled(sites);
   assert.equal(status.state, 'ready', status.log);

   for (const flag of ['--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--memory', '--pids-limit', '--rm']) {
      assert.ok(seen.includes(flag), `missing ${flag}`);
   }
   // One folder of the host is mounted — the task's files. node_modules and
   // npm's cache are Docker volumes, named, never host paths.
   const mounts = seen.flatMap((arg, index) => (seen[index - 1] === '-v' ? [arg.split(':')[0]!] : []));
   assert.equal(mounts.filter((source) => source.startsWith('/')).length, 1);
   assert.ok(mounts.includes(NPM_CACHE_VOLUME));
   assert.ok(mounts.some((source) => /^berry-site-nm-[a-z0-9]+$/.test(source)));

   assert.equal(new TextDecoder().decode((await sites.file(ISSUE, ''))!.bytes), '<script src="./assets/app.js"></script>');
   assert.equal(new TextDecoder().decode((await sites.file(ISSUE, 'assets/app.js'))!.bytes), 'built()');
   assert.equal(await sites.file(ISSUE, '../src/main.tsx'), null);
   assert.equal(await sites.file(ISSUE, '../../../../etc/passwd'), null);

   // The same files are not built twice.
   assert.equal((await sites.start(ISSUE)).state, 'ready');

   // A restarted server finds the finished build on disk instead of rebuilding.
   let rebuilt = false;
   const restarted = new SiteBuilds({
      root,
      artifacts: { listForIssue: async () => Object.keys(PROJECT).map((path) => artifact(path)) },
      read: async () => new Uint8Array(),
      available: async () => true,
      run: async () => {
         rebuilt = true;
         return 0;
      },
   });
   assert.equal((await restarted.status(ISSUE)).state, 'ready');
   assert.equal((await restarted.start(ISSUE)).state, 'ready');
   assert.equal(new TextDecoder().decode((await restarted.file(ISSUE, 'assets/app.js'))!.bytes), 'built()');
   assert.equal(rebuilt, false);
});

test('a failed build says why, and nothing is served', async () => {
   const { builds: sites } = await builds_(PROJECT, async () => 1);
   await sites.start(ISSUE);
   const status = await settled(sites);
   assert.equal(status.state, 'failed');
   assert.match(status.log, /installing[\s\S]*The build failed \(exit 1\)/);
   assert.equal(await sites.file(ISSUE, ''), null);
});

test('a task with no package.json has nothing to build', async () => {
   const { builds: sites } = await builds_({ 'index.html': '<h1>plain</h1>' }, async () => 0);
   await sites.start(ISSUE);
   const status = await settled(sites);
   assert.equal(status.state, 'failed');
   assert.match(status.log, /No package\.json/);
});

test('a ready build whose output was deleted is rebuilt, not served as missing', async () => {
   let builds = 0;
   const { builds: sites, root } = await builds_(PROJECT, async (_args, work) => {
      builds += 1;
      await mkdir(join(work, '.berry-out'), { recursive: true });
      await writeFile(join(work, '.berry-out', 'index.html'), `build ${builds}`);
      return 0;
   });
   await sites.start(ISSUE);
   assert.equal((await settled(sites)).state, 'ready');

   // The cache folder is cleared under the running server.
   await rm(root, { recursive: true, force: true });
   assert.equal((await sites.status(ISSUE)).state, 'idle');
   assert.equal(await sites.file(ISSUE, ''), null);

   await sites.start(ISSUE);
   assert.equal((await settled(sites)).state, 'ready');
   assert.equal(new TextDecoder().decode((await sites.file(ISSUE, ''))!.bytes), 'build 2');
});

test('a forced build runs again on unchanged files, but never beside a running one', async () => {
   let runs = 0;
   let release: (() => void) | undefined;
   const { builds: sites } = await builds_(PROJECT, async (_args, work) => {
      runs += 1;
      if (runs === 2) await new Promise<void>((resolve) => (release = resolve));
      await mkdir(join(work, '.berry-out'), { recursive: true });
      await writeFile(join(work, '.berry-out', 'index.html'), `build ${runs}`);
      return 0;
   });
   await sites.start(ISSUE);
   assert.equal((await settled(sites)).state, 'ready');
   assert.equal((await sites.start(ISSUE)).state, 'ready', 'unforced: the same files are not rebuilt');
   assert.equal(runs, 1);

   assert.equal((await sites.start(ISSUE, { force: true })).state, 'building');
   // A second Rebuild while one runs joins it.
   assert.equal((await sites.start(ISSUE, { force: true })).state, 'building');
   // Released once the forced build is really running, however long the lock
   // and the file sync take on a busy machine.
   for (let i = 0; i < 1000 && typeof release !== 'function'; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
   }
   release!();
   assert.equal((await settled(sites)).state, 'ready');
   assert.equal(runs, 2);
   assert.equal(new TextDecoder().decode((await sites.file(ISSUE, ''))!.bytes), 'build 2');
});

test('the install is skipped while the dependencies are the ones node_modules was installed from', async () => {
   const script = buildScript({ devDependencies: { vite: '^7' } }, 'deadbeef');
   // Compared with the hash stored inside the node_modules volume…
   assert.match(script, /cat node_modules\/\.berry-deps 2>\/dev\/null\)" = "deadbeef"/);
   assert.match(script, /skipping npm install/);
   // …and written there after an install, from npm's shared cache first.
   assert.match(script, /npm install [^;]*--prefer-offline[^;]*; echo "deadbeef" > node_modules\/\.berry-deps/);

   const dir = await mkdtemp(join(tmpdir(), 'berry-deps-'));
   await writeFile(join(dir, 'package.json'), '{"dependencies":{"react":"19"}}');
   const first = await dependencyHash(dir);
   await writeFile(join(dir, 'src.ts'), 'source changes do not count');
   assert.equal(await dependencyHash(dir), first);
   await writeFile(join(dir, 'package-lock.json'), '{"lockfileVersion":3}');
   assert.notEqual(await dependencyHash(dir), first, 'a lockfile change reinstalls');
});

test('a rebuild keeps the task folder and removes files the task no longer has', async () => {
   const files: Record<string, string> = { ...PROJECT, 'src/old-page.tsx': 'old' };
   let listed = Object.keys(files).map((path) => artifact(path));
   const root = await mkdtemp(join(tmpdir(), 'berry-builds-'));
   let work = '';
   const sites = new SiteBuilds({
      root,
      artifacts: { listForIssue: async () => listed },
      read: async (file) => new TextEncoder().encode(files[file.path] ?? ''),
      available: async () => true,
      run: async (args) => {
         work = args[args.indexOf('-v') + 1]!.split(':')[0]!;
         await mkdir(join(work, '.berry-out'), { recursive: true });
         await writeFile(join(work, '.berry-out', 'index.html'), 'built');
         return 0;
      },
   });
   await sites.start(ISSUE);
   await settled(sites);
   const firstWork = work;
   await writeFile(join(work, 'left-by-the-build.txt'), 'x');
   await mkdir(join(work, 'node_modules'), { recursive: true });
   await writeFile(join(work, 'node_modules', 'kept.js'), 'kept');

   // The agent removed a page.
   listed = listed.filter((file) => file.path !== 'src/old-page.tsx');
   await sites.start(ISSUE, { force: true });
   assert.equal((await settled(sites)).state, 'ready');
   assert.equal(work, firstWork, 'the same folder, not a fresh one');
   const { existsSync } = await import('node:fs');
   assert.equal(existsSync(join(work, 'src', 'old-page.tsx')), false);
   assert.equal(existsSync(join(work, 'src', 'main.tsx')), true);
   assert.equal(existsSync(join(work, 'node_modules', 'kept.js')), true);
});

test('two servers building one task run one build; the second takes its result', async () => {
   const root = await mkdtemp(join(tmpdir(), 'berry-builds-'));
   const listed = Object.keys(PROJECT).map((path) => artifact(path));
   let runs = 0;
   const names: string[] = [];
   const server = () =>
      new SiteBuilds({
         root,
         artifacts: { listForIssue: async () => listed },
         read: async (file) => new TextEncoder().encode(PROJECT[file.path] ?? ''),
         available: async () => true,
         run: async (args) => {
            runs += 1;
            names.push(args[args.indexOf('--name') + 1]!);
            const work = args[args.indexOf('-v') + 1]!.split(':')[0]!;
            await new Promise((resolve) => setTimeout(resolve, 300));
            await mkdir(join(work, '.berry-out'), { recursive: true });
            await writeFile(join(work, '.berry-out', 'index.html'), 'built once');
            return 0;
         },
      });
   const a = server();
   const b = server();
   await a.start(ISSUE);
   await new Promise((resolve) => setTimeout(resolve, 50));
   await b.start(ISSUE);
   const [left, right] = await Promise.all([settled(a), settled(b)]);
   assert.equal(left.state, 'ready', left.log);
   assert.equal(right.state, 'ready', right.log);
   assert.match(right.log, /Another server is building this site/);
   assert.equal(runs, 1);
   assert.equal(new TextDecoder().decode((await b.file(ISSUE, ''))!.bytes), 'built once');
   // A later build gets a container name of its own.
   await a.start(ISSUE, { force: true });
   await settled(a);
   assert.equal(new Set(names).size, names.length);
});
