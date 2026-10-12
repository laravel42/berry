import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
   BUILT_IN_PROVIDER,
   findProvider,
   INCLUSION_METHODS,
   needsConnection,
   PROVIDERS,
} from './providers.ts';

test('each integration file is included with the same shape', () => {
   assert.deepEqual(
      PROVIDERS.map((provider) => provider.id),
      ['berry', 'github']
   );
   const berry = findProvider(BUILT_IN_PROVIDER);
   const github = findProvider('github');
   assert.equal(berry?.include, 'built-in');
   assert.equal(github?.include, 'nango');
   assert.equal(github?.name, 'GitHub');
   assert.deepEqual(github?.scopes, ['repo', 'workflow', 'read:org']);
   assert.equal(needsConnection('berry'), false);
   assert.equal(needsConnection('github'), true);
   assert.equal(
      github?.tools.find((tool) => tool.name === 'github.merge_pull_request')?.requiresApproval,
      true
   );
   assert.deepEqual(INCLUSION_METHODS, ['built-in', 'nango']);
});
