import assert from 'node:assert/strict';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { findRepoRoot, frontendChildEnv, localStack, nextCli, serverChildEnv, serverNodeArgs } from '../src/stack.ts';

const here = path.dirname(fileURLToPath(import.meta.url));

describe('local stack', () => {
   it('finds the repo that contains the server and the frontend', () => {
      const root = findRepoRoot(here);
      assert.equal(root, path.resolve(here, '../../..'));
   });

   it('points the server at a PGlite directory and the desktop ports', () => {
      const stack = localStack('/tmp/berry desktop/pglite');
      const env = serverChildEnv({ DATABASE_URL: 'postgres://postgres@127.0.0.1:5432/berry', PATH: '/usr/bin' }, stack);
      assert.equal(env.DATABASE_URL, 'pglite:/tmp/berry desktop/pglite');
      assert.equal(env.API_ADDR, '127.0.0.1:4173');
      assert.equal(env.BERRY_APP_URL, 'http://127.0.0.1:4174');
      assert.equal(env.BERRY_PUBLIC_URL, 'http://127.0.0.1:4173');
      assert.equal(env.APP_ENV, 'development');
   });

   it('keeps an explicit APP_ENV and drops Electron as Node', () => {
      const stack = localStack('/data');
      const env = serverChildEnv({ APP_ENV: 'test', ELECTRON_RUN_AS_NODE: '1' }, stack);
      assert.equal(env.APP_ENV, 'test');
      assert.equal(env.ELECTRON_RUN_AS_NODE, undefined);
   });

   it('sends the web app at the desktop API and a separate Next directory', () => {
      const env = frontendChildEnv({}, localStack('/data'));
      assert.equal(env.BERRY_API_ORIGIN, 'http://127.0.0.1:4173');
      assert.equal(env.NEXT_DIST_DIR, '.next-desktop');
   });

   it('loads the repo env file without letting it replace DATABASE_URL', () => {
      const root = findRepoRoot(here);
      assert.ok(root);
      const args = serverNodeArgs(root, 'src/migrate/index.ts');
      assert.equal(args[0], `--env-file-if-exists=${path.join(root, '.env')}`);
      assert.deepEqual(args.slice(1), ['--experimental-strip-types', 'src/migrate/index.ts']);
   });

   it('finds the Next CLI installed for this repo', () => {
      const root = findRepoRoot(here);
      assert.ok(root);
      assert.equal(nextCli(root).endsWith(`${path.sep}next`), true);
   });
});
