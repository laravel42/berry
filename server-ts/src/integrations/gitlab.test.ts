import assert from 'node:assert/strict';
import { test } from 'node:test';

import { GitLabClient, GITLAB_PROJECT_PATH } from './gitlab.ts';

test('GITLAB_PROJECT_PATH accepts nested groups and refuses bare names', () => {
   assert.equal(GITLAB_PROJECT_PATH.test('acme/app'), true);
   assert.equal(GITLAB_PROJECT_PATH.test('acme/team/app'), true);
   assert.equal(GITLAB_PROJECT_PATH.test('solo'), false);
   assert.equal(GITLAB_PROJECT_PATH.test('acme/has space'), false);
});

test('listRepositories maps path_with_namespace and pages until short', async () => {
   const seen: string[] = [];
   const client = new GitLabClient({
      token: 'glpat-test',
      fetch: (async (input) => {
         const url = String(input);
         seen.push(url);
         assert.match(url, /membership=true/);
         if (url.includes('page=1')) {
            return new Response(
               JSON.stringify([
                  {
                     id: 7,
                     path_with_namespace: 'acme/team/app',
                     name: 'app',
                     visibility: 'private',
                     default_branch: 'main',
                     description: 'Ship it',
                     web_url: 'https://gitlab.com/acme/team/app',
                  },
               ]),
               { status: 200 }
            );
         }
         return new Response(JSON.stringify([]), { status: 200 });
      }) as typeof fetch,
   });

   // Intercept headers by wrapping again — GitLabClient passes private-token.
   const repositories = await client.listRepositories({ maxPages: 1 });
   assert.deepEqual(repositories, [
      {
         id: 7,
         fullName: 'acme/team/app',
         name: 'app',
         private: true,
         defaultBranch: 'main',
         description: 'Ship it',
         htmlUrl: 'https://gitlab.com/acme/team/app',
      },
   ]);
   assert.equal(seen.length, 1);
});

test('resolveRepository URL-encodes the path', async () => {
   let requested = '';
   const client = new GitLabClient({
      token: 'glpat-test',
      fetch: (async (input) => {
         requested = String(input);
         return new Response(
            JSON.stringify({
               id: 9,
               path_with_namespace: 'acme/team/app',
               name: 'app',
               visibility: 'public',
               default_branch: 'develop',
            }),
            { status: 200 }
         );
      }) as typeof fetch,
   });
   const repository = await client.resolveRepository('acme/team/app');
   assert.match(requested, /\/projects\/acme%2Fteam%2Fapp$/);
   assert.equal(repository.id, 9);
   assert.equal(repository.fullName, 'acme/team/app');
   assert.equal(repository.private, false);
   assert.equal(repository.defaultBranch, 'develop');
});
