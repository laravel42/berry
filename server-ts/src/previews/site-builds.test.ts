import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import type { RunArtifact } from '../core/run-artifacts.ts';
import { buildScript, NEEDS_BUILD, SiteBuilds } from './site-builds.ts';

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
   assert.match(buildScript({ devDependencies: { vite: '^7' } }), /vite build --base \.\/ --outDir \.berry-out/);
   assert.match(buildScript({ scripts: { build: 'react-scripts build' } }), /npm run build/);
   assert.match(buildScript({}), /no build script/);
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
   // Only the build folder is mounted.
   assert.equal(seen.filter((arg) => arg === '-v').length, 1);

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
