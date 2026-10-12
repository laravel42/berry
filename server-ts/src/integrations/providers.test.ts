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
      ['berry', 'github', 'gitlab']
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

test('GitLab is a Nango integration with repository scopes and gitlab-prefixed tools', () => {
   const gitlab = findProvider('gitlab');
   assert.equal(gitlab?.include, 'nango');
   assert.equal(gitlab?.name, 'GitLab');
   assert.deepEqual(gitlab?.scopes, ['read_repository', 'write_repository']);
   assert.equal(needsConnection('gitlab'), true);
   assert.ok(gitlab?.tools.every((tool) => tool.name.startsWith('gitlab.')));
   // Only the merge tool asks for approval, and only it is off by default.
   const approval = gitlab?.tools.filter((tool) => tool.requiresApproval).map((tool) => tool.name);
   assert.deepEqual(approval, ['gitlab.merge_merge_request']);
   const offByDefault = gitlab?.tools
      .filter((tool) => !tool.enabledByDefault)
      .map((tool) => tool.name);
   assert.deepEqual(offByDefault, ['gitlab.merge_merge_request']);
   // The description is a plain connect line: no connection broker, and no
   // claim of clone, push or merge-request access, which stay GitHub-only.
   assert.equal(gitlab?.description, 'Connect a GitLab account for this workspace.');
});
