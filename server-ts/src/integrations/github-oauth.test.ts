import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ConnectionUnavailable, type Connection } from './connections.ts';
import { githubConnectionToken } from './github-oauth.ts';
import { NangoRequestError } from './nango.ts';

function connection(overrides: Partial<Connection> = {}): Connection {
   return {
      id: 'conn',
      workspaceId: 'ws',
      provider: 'github',
      externalAccountId: 'nango-connection',
      externalAccountName: null,
      scopes: ['repo'],
      status: 'connected',
      statusDetail: null,
      expiresAt: null,
      createdAt: '2026-10-11T00:00:00.000Z',
      updatedAt: '2026-10-11T00:00:00.000Z',
      ...overrides,
   };
}

test('the GitHub token is read from the recorded connection id', async () => {
   let asked: [string, string] | null = null;
   const token = await githubConnectionToken('ws', {
      connections: {
         find: async () => connection(),
      },
      nango: {
         accessToken: async (integrationId, connectionId) => {
            asked = [integrationId, connectionId];
            return 'gho_from_connection';
         },
      },
   });
   assert.equal(token, 'gho_from_connection');
   assert.deepEqual(asked, ['github', 'nango-connection']);
});

test('a missing connection is not a token', async () => {
   await assert.rejects(
      githubConnectionToken('ws', {
         connections: { find: async () => null },
         nango: { accessToken: async () => 'gho_unused' },
      }),
      (error: unknown) => error instanceof ConnectionUnavailable && error.reason === 'missing'
   );
});

test('a Nango failure renews the connection instead of returning a token', async () => {
   await assert.rejects(
      githubConnectionToken('ws', {
         connections: { find: async () => connection() },
         nango: {
            accessToken: async () => {
               throw new NangoRequestError(401, 'no');
            },
         },
      }),
      (error: unknown) => {
         assert.ok(error instanceof ConnectionUnavailable);
         assert.equal(error.reason, 'unusable');
         assert.equal(/nango/i.test(error.message), false);
         return true;
      }
   );
});
