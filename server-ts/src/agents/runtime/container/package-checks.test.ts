import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkCommands, packageChecks } from './package-checks.ts';

const manifest = (scripts: Record<string, string>) => JSON.stringify({ name: 'app', scripts });

test('a package with a type check and tests is checked with both, through its lockfile’s manager', () => {
   const found = packageChecks(manifest({ dev: 'next dev', typecheck: 'tsc --noEmit', test: 'vitest run' }), ['pnpm-lock.yaml']);
   assert.deepEqual(found, {
      manager: 'pnpm',
      checks: [
         { name: 'typecheck', body: 'tsc --noEmit' },
         { name: 'test', body: 'vitest run' },
      ],
   });
   assert.deepEqual(checkCommands(found!, manifest({ typecheck: 'tsc --noEmit', test: 'vitest run' })), ['pnpm run typecheck', 'pnpm run test']);
});

test('npm init’s placeholder test and a package with no checks are not a suite', () => {
   assert.equal(packageChecks(manifest({ test: 'echo "Error: no test specified" && exit 1' }), []), null);
   assert.equal(packageChecks(manifest({ dev: 'vite' }), []), null);
   assert.equal(packageChecks('not json', []), null);
   assert.equal(packageChecks(manifest({ check: 'svelte-check' }), [])?.manager, 'npm');
});

test('a script the run changed or removed is checked as the default branch wrote it', () => {
   const found = packageChecks(manifest({ test: 'vitest run' }), ['yarn.lock'])!;
   assert.deepEqual(checkCommands(found, manifest({ test: 'true' })), [`PATH="$PWD/node_modules/.bin:$PATH" sh -c 'vitest run'`]);
   assert.deepEqual(checkCommands(found, null), [`PATH="$PWD/node_modules/.bin:$PATH" sh -c 'vitest run'`]);
});
