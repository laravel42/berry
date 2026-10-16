import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
   applyEnvFile,
   applyMissingDesktopSecrets,
   bundledFrontendEnv,
   bundledNodeBin,
   ensureDesktopSecrets,
   extraWorkstationBins,
   findRepoRoot,
   frontendChildEnv,
   hasMigrationFiles,
   hostDatabaseUrl,
   layoutAt,
   localStack,
   loginShellArgs,
   mergeSearchPath,
   nextCli,
   parseEnvFile,
   parseLoginPathOutput,
   REPO_DESKTOP_ENV_KEYS,
   readLoginShellPath,
   resolveStack,
   serverChildEnv,
   serverDir,
   serverNodeArgs,
   withLoginSearchPath,
} from '../src/stack.ts';

const here = path.dirname(fileURLToPath(import.meta.url));

function tempDir(): string {
   return mkdtempSync(path.join(tmpdir(), 'berry-desktop-'));
}

function writeBundled(root: string, withMigrations = true): void {
   mkdirSync(path.join(root, 'server', 'src'), { recursive: true });
   mkdirSync(path.join(root, 'web', 'frontend'), { recursive: true });
   writeFileSync(path.join(root, 'server', 'src', 'index.ts'), '');
   writeFileSync(path.join(root, 'web', 'frontend', 'server.js'), '');
   if (withMigrations) {
      mkdirSync(path.join(root, 'server', 'migrations'), { recursive: true });
      writeFileSync(path.join(root, 'server', 'migrations', '000_platform.up.sql'), '');
   }
   mkdirSync(path.join(root, 'web', 'frontend', '.next-desktop-bundle', 'static', 'chunks'), {
      recursive: true,
   });
   writeFileSync(
      path.join(root, 'web', 'frontend', '.next-desktop-bundle', 'static', 'chunks', 'app.css'),
      '',
   );
}

describe('local stack', () => {
   it('finds the repo that contains the server and the frontend', () => {
      const root = findRepoRoot(here);
      assert.equal(root, path.resolve(here, '../../..'));
   });

   it('defaults the window server to PGlite in the data directory', () => {
      const stack = localStack('/tmp/berry desktop');
      const env = serverChildEnv({ PATH: '/usr/bin' }, stack);
      assert.equal(env.DATABASE_URL, 'pglite:/tmp/berry desktop');
   });

   it('points the server at host Postgres and the desktop ports', () => {
      const stack = localStack('/tmp/berry desktop');
      const url = 'postgres://postgres@127.0.0.1:5432/berry?sslmode=disable';
      const env = serverChildEnv({ DATABASE_URL: url, PATH: '/usr/bin' }, stack);
      assert.equal(env.DATABASE_URL, url);
      assert.equal(env.BERRY_STORAGE_DIR, '/tmp/berry desktop/artifacts');
      assert.equal(env.API_ADDR, '127.0.0.1:4173');
      assert.equal(env.BERRY_APP_URL, 'http://127.0.0.1:4174');
      assert.equal(env.BERRY_PUBLIC_URL, 'http://127.0.0.1:4173');
      assert.equal(env.APP_ENV, 'development');
      assert.equal(hostDatabaseUrl({ DATABASE_URL: url }), url);
      assert.equal(hostDatabaseUrl({ DATABASE_URL: 'pglite:./.berry' }), null);
      assert.equal(
         hostDatabaseUrl({
            BERRY_DESKTOP_DATABASE_URL: 'postgres://berry@127.0.0.1:5432/other',
            DATABASE_URL: url,
         }),
         'postgres://berry@127.0.0.1:5432/other',
      );
   });

   it('loads allow-listed keys from an env file without replacing ones already set', () => {
      const dir = tempDir();
      try {
         const file = path.join(dir, '.env');
         writeFileSync(
            file,
            '# comment\nDATABASE_URL=postgres://from-file/berry\nGITHUB_CLIENT_SECRET=nope\nBERRY_AUTH_SECRET=from-file-secret-value-32chars\n',
         );
         const env: NodeJS.ProcessEnv = { DATABASE_URL: 'postgres://already/set' };
         applyEnvFile(file, env, ['DATABASE_URL', 'BERRY_AUTH_SECRET']);
         assert.equal(env.DATABASE_URL, 'postgres://already/set');
         assert.equal(env.BERRY_AUTH_SECRET, 'from-file-secret-value-32chars');
         assert.equal(env.GITHUB_CLIENT_SECRET, undefined);
         assert.equal(parseEnvFile('FOO=bar\n# x\nBAZ="qux"\n').FOO, 'bar');
      } finally {
         rmSync(dir, { recursive: true, force: true });
      }
   });

   it('keeps an explicit APP_ENV and drops Electron as Node', () => {
      const stack = localStack('/data');
      const env = serverChildEnv(
         { APP_ENV: 'test', ELECTRON_RUN_AS_NODE: '1', DATABASE_URL: 'postgres://berry@127.0.0.1/berry' },
         stack,
      );
      assert.equal(env.APP_ENV, 'test');
      assert.equal(env.ELECTRON_RUN_AS_NODE, undefined);
   });

   it('sends the web app at the desktop API and a separate Next directory', () => {
      const env = frontendChildEnv({}, localStack('/data'));
      assert.equal(env.BERRY_API_ORIGIN, 'http://127.0.0.1:4173');
      assert.equal(env.NEXT_DIST_DIR, '.next-desktop');
   });

   it('runs the packaged web app as Next standalone, not next dev', () => {
      const env = bundledFrontendEnv({ NEXT_DIST_DIR: '.next-desktop' }, localStack('/data'));
      assert.equal(env.BERRY_API_ORIGIN, 'http://127.0.0.1:4173');
      assert.equal(env.NEXT_DIST_DIR, undefined);
      assert.equal(env.NODE_ENV, 'production');
      assert.equal(env.HOSTNAME, '127.0.0.1');
      assert.equal(env.PORT, '4174');
   });

   it('allow-lists IAM database keys from the checkout env', () => {
      assert.ok(REPO_DESKTOP_ENV_KEYS.includes('DATABASE_IAM_AUTH'));
      assert.ok(REPO_DESKTOP_ENV_KEYS.includes('AWS_REGION'));
      assert.ok(REPO_DESKTOP_ENV_KEYS.includes('AWS_PROFILE'));
   });

   it('loads the repo env file without letting it replace DATABASE_URL', () => {
      const root = findRepoRoot(here);
      assert.ok(root);
      const args = serverNodeArgs({ kind: 'repo', root }, 'src/migrate/index.ts');
      assert.equal(args[0], `--env-file-if-exists=${path.join(root, '.env')}`);
      assert.deepEqual(args.slice(1), ['--experimental-strip-types', 'src/migrate/index.ts']);
   });

   it('does not load a repo .env from a packaged bundle', () => {
      const args = serverNodeArgs({ kind: 'bundled', root: '/app/Resources/berry' }, 'src/index.ts');
      assert.deepEqual(args, ['--experimental-strip-types', 'src/index.ts']);
   });

   it('finds the Next CLI installed for this repo', () => {
      const root = findRepoRoot(here);
      assert.ok(root);
      assert.equal(nextCli(root).endsWith(`${path.sep}next`), true);
   });

   it('resolves a packaged extraResources tree before walking for a checkout', () => {
      const resources = tempDir();
      const empty = tempDir();
      try {
         writeBundled(path.join(resources, 'berry'));
         const layout = resolveStack({
            start: empty,
            cwd: empty,
            resourcesPath: resources,
            env: {},
         });
         assert.deepEqual(layout, { kind: 'bundled', root: path.join(resources, 'berry') });
         assert.equal(serverDir(layout!), path.join(resources, 'berry', 'server'));
      } finally {
         rmSync(resources, { recursive: true, force: true });
         rmSync(empty, { recursive: true, force: true });
      }
   });

   it('honours BERRY_DESKTOP_ROOT over extraResources', () => {
      const resources = tempDir();
      const named = tempDir();
      try {
         writeBundled(path.join(resources, 'berry'));
         writeBundled(named);
         const layout = resolveStack({
            start: named,
            resourcesPath: resources,
            env: { BERRY_DESKTOP_ROOT: named },
         });
         assert.equal(layout?.root, path.resolve(named));
         assert.equal(layout?.kind, 'bundled');
      } finally {
         rmSync(resources, { recursive: true, force: true });
         rmSync(named, { recursive: true, force: true });
      }
   });

   it('returns null when BERRY_DESKTOP_ROOT is set but is not a stack', () => {
      const empty = tempDir();
      try {
         const layout = resolveStack({
            start: here,
            env: { BERRY_DESKTOP_ROOT: empty },
         });
         assert.equal(layout, null);
      } finally {
         rmSync(empty, { recursive: true, force: true });
      }
   });

   it('does not treat a bundle without .up.sql migrations as packaged', () => {
      const bundled = tempDir();
      try {
         writeBundled(bundled, false);
         assert.equal(layoutAt(bundled), null);
         assert.equal(hasMigrationFiles(path.join(bundled, 'server')), false);
      } finally {
         rmSync(bundled, { recursive: true, force: true });
      }
   });

   it('treats extraResources/berry as bundled and a checkout as repo', () => {
      const bundled = tempDir();
      try {
         writeBundled(bundled);
         assert.deepEqual(layoutAt(bundled), { kind: 'bundled', root: path.resolve(bundled) });
         const repo = findRepoRoot(here);
         assert.ok(repo);
         assert.deepEqual(layoutAt(repo), { kind: 'repo', root: repo });
      } finally {
         rmSync(bundled, { recursive: true, force: true });
      }
   });

   it('prefers a Node binary shipped next to the bundle', () => {
      const bundled = tempDir();
      try {
         writeBundled(bundled);
         const layout = { kind: 'bundled' as const, root: bundled };
         assert.equal(bundledNodeBin(layout, 'node'), 'node');
         writeFileSync(path.join(bundled, process.platform === 'win32' ? 'node.exe' : 'node'), '');
         assert.equal(bundledNodeBin(layout, 'node'), path.join(bundled, process.platform === 'win32' ? 'node.exe' : 'node'));
      } finally {
         rmSync(bundled, { recursive: true, force: true });
      }
   });

   it('persists desktop secrets across calls', () => {
      const dir = tempDir();
      try {
         const first = ensureDesktopSecrets(dir);
         assert.ok(first.BERRY_AUTH_SECRET.length >= 32);
         assert.ok(first.INTEGRATION_ENCRYPTION_KEY.length >= 32);
         const second = ensureDesktopSecrets(dir);
         assert.deepEqual(second, first);
      } finally {
         rmSync(dir, { recursive: true, force: true });
      }
   });

   it('fills missing desktop secrets and leaves ones already set', () => {
      const dir = tempDir();
      try {
         const env: NodeJS.ProcessEnv = {
            BERRY_AUTH_SECRET: 'already-set-auth-secret-value-32chars',
         };
         applyMissingDesktopSecrets(env, dir);
         assert.equal(env.BERRY_AUTH_SECRET, 'already-set-auth-secret-value-32chars');
         assert.ok((env.INTEGRATION_ENCRYPTION_KEY ?? '').length >= 32);
      } finally {
         rmSync(dir, { recursive: true, force: true });
      }
   });

   it('puts login-shell directories ahead of the GUI PATH and drops duplicates', () => {
      assert.equal(
         mergeSearchPath('/opt/homebrew/bin:/usr/bin', '/usr/bin:/bin:/usr/sbin:/sbin', ':'),
         '/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin',
      );
   });

   it('reads the marked PATH and ignores login motd', () => {
      assert.equal(
         parseLoginPathOutput('Last login: today\nBERRY_LOGIN_PATH/opt/homebrew/bin:/usr/binBERRY_LOGIN_PATH\n'),
         '/opt/homebrew/bin:/usr/bin',
      );
      assert.equal(parseLoginPathOutput('/usr/bin:/bin'), null);
   });

   it('asks a login shell, not an interactive one', () => {
      assert.deepEqual(loginShellArgs('zsh')[0], '-l');
      assert.equal(loginShellArgs('zsh').includes('-i'), false);
      assert.equal(loginShellArgs('fish')[2]?.includes('string join'), true);
   });

   it('returns null when the login shell fails or the platform is Windows', () => {
      assert.equal(readLoginShellPath({ SHELL: '/bin/sh' }, () => ({ status: 1, stdout: '' })), null);
      let spawned = false;
      assert.equal(
         readLoginShellPath({ SHELL: '/bin/sh' }, () => {
            spawned = true;
            return { status: 0, stdout: '' };
         }, 'win32'),
         null,
      );
      assert.equal(spawned, false);
   });

   it('gives the server the login PATH so Finder launches can see Homebrew CLIs', () => {
      const home = tempDir();
      try {
         mkdirSync(path.join(home, '.local', 'bin'), { recursive: true });
         const env = withLoginSearchPath(
            { PATH: '/usr/bin:/bin', HOME: home },
            {
               platform: 'darwin',
               home,
               readLogin: () => '/opt/homebrew/bin:/usr/bin',
            },
         );
         const dirs = (env.PATH ?? '').split(':');
         assert.equal(dirs[0], '/opt/homebrew/bin');
         assert.equal(dirs.includes(path.join(home, '.local', 'bin')), true);
         assert.equal(dirs.filter((dir) => dir === '/usr/bin').length, 1);
         assert.equal(dirs.includes('/bin'), true);
      } finally {
         rmSync(home, { recursive: true, force: true });
      }
   });

   it('leaves Windows PATH alone', () => {
      const env = withLoginSearchPath(
         { PATH: 'C:\\Windows\\System32' },
         { platform: 'win32', readLogin: () => '/opt/homebrew/bin' },
      );
      assert.equal(env.PATH, 'C:\\Windows\\System32');
      assert.deepEqual(extraWorkstationBins('/home', 'win32'), []);
   });
});
