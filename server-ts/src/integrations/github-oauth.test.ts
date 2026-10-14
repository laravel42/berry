import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ConnectionUnavailable, type Connection } from './connections.ts';
import { githubConnectionToken } from './github-oauth.ts';
import { GitHubUserUnavailable } from './github-user.ts';

function connection(overrides: Partial<Connection> = {}): Connection {
   return {
      id: 'conn',
      workspaceId: 'ws',
      provider: 'github',
      externalAccountId: '42',
      externalAccountName: 'ada',
      scopes: ['repo'],
      status: 'connected',
      statusDetail: null,
      expiresAt: null,
      createdAt: '2026-10-11T00:00:00.000Z',
      updatedAt: '2026-10-11T00:00:00.000Z',
      ...overrides,
   };
}

test('the GitHub token is read from a sealed workspace connection', async () => {
   const token = await githubConnectionToken('ws', {
      connections: {
         find: async () => connection(),
         token: async () => 'gho_from_connection',
      },
      userAccess: {
         workspaceToken: async () => 'ghu_unused',
      },
   });
   assert.equal(token, 'gho_from_connection');
});

test('a connection with no sealed credential falls through to sign-in', async () => {
   const token = await githubConnectionToken('ws', {
      connections: {
         find: async () => connection(),
         token: async () => {
            throw new ConnectionUnavailable('the github connection holds no credential', 'unusable');
         },
      },
      userAccess: {
         workspaceToken: async () => 'ghu_from_login',
      },
   });
   assert.equal(token, 'ghu_from_login');
});

test('a missing connection uses a member sign-in token', async () => {
   const token = await githubConnectionToken('ws', {
      connections: {
         find: async () => null,
         token: async () => {
            throw new Error('token should not be asked');
         },
      },
      userAccess: {
         workspaceToken: async () => 'ghu_from_login',
      },
   });
   assert.equal(token, 'ghu_from_login');
});

test('a missing connection and no sign-in is not a token', async () => {
   await assert.rejects(
      githubConnectionToken('ws', {
         connections: {
            find: async () => null,
            token: async () => {
               throw new Error('token should not be asked');
            },
         },
         userAccess: {
            workspaceToken: async () => {
               throw new GitHubUserUnavailable(
                  'no member of this workspace has a usable GitHub sign-in',
                  'not_linked'
               );
            },
         },
      }),
      (error: unknown) => error instanceof ConnectionUnavailable && error.reason === 'missing'
   );
});

test('a refused sign-in token renews the connection instead of returning it', async () => {
   await assert.rejects(
      githubConnectionToken('ws', {
         connections: { find: async () => null, token: async () => 'gho_unused' },
         userAccess: {
            workspaceToken: async () => {
               throw new GitHubUserUnavailable(
                  'the stored GitHub token is gone; sign in again',
                  'sign_in_again'
               );
            },
         },
      }),
      (error: unknown) => {
         assert.ok(error instanceof ConnectionUnavailable);
         assert.equal(error.reason, 'unusable');
         return true;
      }
   );
});
