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
   assert.equal(github?.include, 'oauth');
   assert.equal(github?.name, 'GitHub');
   assert.deepEqual(github?.scopes, ['repo', 'workflow', 'read:org']);
   assert.equal(needsConnection('berry'), false);
   assert.equal(needsConnection('github'), true);
   assert.equal(
      github?.tools.find((tool) => tool.name === 'github.merge_pull_request')?.requiresApproval,
      true
   );
   assert.deepEqual(INCLUSION_METHODS, ['built-in', 'oauth']);
});

test('GitLab is an OAuth integration with repository scopes and gitlab-prefixed tools', () => {
   const github = findProvider('github');
   const gitlab = findProvider('gitlab');
   assert.equal(gitlab?.include, 'oauth');
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
   // Same length as the GitHub description, without claiming clone, push or merge.
   assert.equal(
      gitlab?.description,
      'The projects a GitLab account can reach for this workspace. Sign in with GitLab to grant that access, so agents can work inside the repositories that account can open.'
   );
   assert.equal(gitlab?.description.length, github?.description.length);
});
