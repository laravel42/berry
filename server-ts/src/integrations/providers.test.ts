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
      [
         'aws-codecommit',
         'azure-devops',
         'berry',
         'bitbucket',
         'codeberg',
         'forgejo',
         'gerrit',
         'gitea',
         'github',
         'gitlab',
         'gogs',
         'perforce',
         'sourcehut',
      ]
   );
   const berry = findProvider(BUILT_IN_PROVIDER);
   const github = findProvider('github');
   assert.equal(berry?.include, 'built-in');
   assert.equal(github?.include, 'access_token');
   assert.equal(github?.name, 'GitHub');
   assert.deepEqual(github?.scopes, ['repo', 'workflow', 'read:org']);
   assert.equal(needsConnection('berry'), false);
   assert.equal(needsConnection('github'), true);
   assert.equal(
      github?.tools.find((tool) => tool.name === 'github.merge_pull_request')?.requiresApproval,
      true
   );
   assert.deepEqual(INCLUSION_METHODS, ['built-in', 'oauth', 'access_token']);
});

test('GitLab is an access-token integration with repository scopes and gitlab-prefixed tools', () => {
   const gitlab = findProvider('gitlab');
   assert.equal(gitlab?.include, 'access_token');
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
   // Same idea as GitHub, without claiming clone, push or merge.
   assert.equal(
      gitlab?.description,
      'The projects a GitLab account can reach. Sign in so agents can work in those repositories.'
   );
});

test('Bitbucket connects by pasting an access token', () => {
   const bitbucket = findProvider('bitbucket');
   assert.equal(bitbucket?.include, 'access_token');
   assert.equal(bitbucket?.name, 'Bitbucket');
   assert.equal(
      bitbucket?.description,
      'Cloud or Data Center. Jira integration and the Atlassian ecosystem. Agents will check repositories out, branch and open pull requests there.'
   );
   assert.ok(bitbucket?.tools.every((tool) => tool.name.startsWith('bitbucket.')));
});

test('source-control providers connect by pasting an access token', () => {
   for (const id of [
      'azure-devops',
      'gitea',
      'forgejo',
      'codeberg',
      'aws-codecommit',
      'gerrit',
      'sourcehut',
      'gogs',
      'perforce',
   ]) {
      const provider = findProvider(id);
      assert.equal(provider?.include, 'access_token', id);
      assert.ok(provider?.tools.every((tool) => tool.name.startsWith(`${id}.`)), id);
      assert.ok((provider?.description.length ?? 0) > 0, id);
   }
   assert.equal(findProvider('perforce')?.name, 'Perforce Helix Core');
   assert.equal(findProvider('aws-codecommit')?.name, 'AWS CodeCommit');
});
