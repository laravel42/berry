import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';

import { personalTokenResolver } from '../auth/credentials.ts';
import { SessionService } from '../auth/sessions.ts';
import { issueTestToken } from '../auth/test-credentials.ts';
import { BoardRepository } from '../core/boards.ts';
import { closeDatabase, openDatabase, type Sql } from '../db/pool.ts';
import { createApp, type BerryApp } from '../http/app.ts';
import { Registry } from '../http/registry.ts';
import { ConnectionRepository } from '../integrations/connections.ts';
import { sealerFromKey } from '../integrations/sealing.ts';
import { APP_SEALING_KEY } from '../test-support/github-app.ts';
import { deleteWorkspaceBoards } from '../test-support/boards.ts';
import { deleteWorkspaceAgents } from '../test-support/protected-agents.ts';
import { integrationMounts } from './integrations.ts';

/**
 * Pasting a host access token into Source control.
 *
 * The token is sealed on the connection row. GitHub is asked who it belongs
 * to before it is stored; other providers are stored as pasted.
 */

const url = process.env.BERRY_TEST_DATABASE_URL;

describe(
   'pasting a host access token',
   { skip: url ? false : 'BERRY_TEST_DATABASE_URL is not set' },
   () => {
      let sql: Sql;
      let app: BerryApp;
      let noSealApp: BerryApp;
      let token: string;
      let workspaceId: string;
      let userId: string;
      let connections: ConnectionRepository;
      const originalFetch = globalThis.fetch;

      before(async () => {
         sql = openDatabase({ url: url! });
         const suffix = randomBytes(4).toString('hex');
         const [user] = await sql`
            INSERT INTO users (id, email, name)
            VALUES (${randomUUID()}, ${`token-${suffix}@berry.test`}, 'Token')
            RETURNING id`;
         userId = user!.id as string;
         const [workspace] = await sql`
            INSERT INTO workspaces (id, name, slug, settings, created_by)
            VALUES (${randomUUID()}, ${`Token ${suffix}`}, ${`token-${suffix}`},
                    ${sql.json({ issuePrefix: 'TOK', defaultRole: 'member', allowMemberInvites: false } as never)},
                    ${userId})
            RETURNING id`;
         workspaceId = workspace!.id as string;
         await sql`
            INSERT INTO workspace_memberships (workspace_id, user_id, role)
            VALUES (${workspaceId}, ${userId}, 'owner')`;
         await sql`UPDATE users SET last_workspace_id = ${workspaceId} WHERE id = ${userId}`;
         token = await issueTestToken(sql, userId);

         const sealer = sealerFromKey(APP_SEALING_KEY);
         connections = new ConnectionRepository({ sql, sealer });
         const sessions = new SessionService({
            sql,
            auth: null,
            bearer: [personalTokenResolver(sql)],
         });
         const boards = new BoardRepository(sql);

         const registry = new Registry();
         registry.registerAll(
            integrationMounts({
               sessions,
               boards,
               connections,
               states: null,
               github: null,
               githubApp: null,
               userAccess: null,
               publicUrl: 'http://localhost:4000',
               appUrl: 'http://localhost:3000',
               completeAgentCoreAuthorization: null,
               firstRunSetup: null,
            })
         );
         app = createApp(registry);

         const bare = new Registry();
         bare.registerAll(
            integrationMounts({
               sessions,
               boards,
               connections: null,
               states: null,
               github: null,
               githubApp: null,
               userAccess: null,
               publicUrl: 'http://localhost:4000',
               appUrl: 'http://localhost:3000',
               completeAgentCoreAuthorization: null,
               firstRunSetup: null,
            })
         );
         noSealApp = createApp(bare);
      });

      after(async () => {
         globalThis.fetch = originalFetch;
         if (!sql) return;
         await sql`DELETE FROM integration_connections WHERE workspace_id = ${workspaceId}`;
         await deleteWorkspaceAgents(sql, [workspaceId]);
         await deleteWorkspaceBoards(sql, [workspaceId]);
         await sql`DELETE FROM workspace_memberships WHERE workspace_id = ${workspaceId}`;
         await sql`DELETE FROM workspaces WHERE id = ${workspaceId}`;
         await sql`DELETE FROM users WHERE id = ${userId}`;
         await closeDatabase(sql);
      });

      test('an empty token is refused', async () => {
         const response = await app.request('/api/v1/integrations/connections/gitlab/token', {
            method: 'POST',
            headers: {
               authorization: `Bearer ${token}`,
               'content-type': 'application/json',
            },
            body: JSON.stringify({ accessToken: '   ' }),
         });
         assert.equal(response.status, 400);
         const body = (await response.json()) as { code: string };
         assert.equal(body.code, 'VALIDATION_ERROR');
      });

      test('without a sealer the deployment cannot hold a credential', async () => {
         const response = await noSealApp.request('/api/v1/integrations/connections/gitlab/token', {
            method: 'POST',
            headers: {
               authorization: `Bearer ${token}`,
               'content-type': 'application/json',
            },
            body: JSON.stringify({ accessToken: 'glpat-test' }),
         });
         assert.equal(response.status, 503);
         const body = (await response.json()) as { code: string };
         assert.equal(body.code, 'INTEGRATIONS_NOT_CONFIGURED');
      });

      test('a pasted GitLab token connects and opens, then disconnect clears it', async () => {
         globalThis.fetch = (async (input) => {
            const url = String(input);
            if (url.includes('/api/v4/user')) {
               return new Response(JSON.stringify({ id: 42, username: 'acme' }), { status: 200 });
            }
            return originalFetch(input as Parameters<typeof fetch>[0]);
         }) as typeof fetch;
         try {
            const response = await app.request('/api/v1/integrations/connections/gitlab/token', {
               method: 'POST',
               headers: {
                  authorization: `Bearer ${token}`,
                  'content-type': 'application/json',
               },
               body: JSON.stringify({ accessToken: 'glpat-workspace-token', accountName: 'acme' }),
            });
            assert.equal(response.status, 200);
            const body = (await response.json()) as {
               connection: { provider: string; status: string; accountName: string | null };
            };
            assert.equal(body.connection.provider, 'gitlab');
            assert.equal(body.connection.status, 'connected');
            assert.equal(body.connection.accountName, 'acme');

            assert.equal(await connections.token(workspaceId, 'gitlab'), 'glpat-workspace-token');

            const providers = await app.request('/api/v1/integrations/providers', {
               headers: { authorization: `Bearer ${token}` },
            });
            assert.equal(providers.status, 200);
            const catalogue = (await providers.json()) as {
               providers: Array<{ id: string; connected: boolean; configured: boolean }>;
            };
            const gitlab = catalogue.providers.find((provider) => provider.id === 'gitlab');
            assert.equal(gitlab?.configured, true);
            assert.equal(gitlab?.connected, true);

            const removed = await app.request('/api/v1/integrations/connections/gitlab', {
               method: 'DELETE',
               headers: { authorization: `Bearer ${token}` },
            });
            assert.equal(removed.status, 204);
            await assert.rejects(() => connections.token(workspaceId, 'gitlab'));
         } finally {
            globalThis.fetch = originalFetch;
         }
      });

      test('a refused GitLab token is not stored', async () => {
         globalThis.fetch = (async () =>
            new Response(JSON.stringify({ message: '401 Unauthorized' }), {
               status: 401,
            })) as typeof fetch;
         try {
            const response = await app.request('/api/v1/integrations/connections/gitlab/token', {
               method: 'POST',
               headers: {
                  authorization: `Bearer ${token}`,
                  'content-type': 'application/json',
               },
               body: JSON.stringify({ accessToken: 'glpat-bad' }),
            });
            assert.equal(response.status, 401);
            const body = (await response.json()) as { code: string };
            assert.equal(body.code, 'TOKEN_REFUSED');
            await assert.rejects(() => connections.token(workspaceId, 'gitlab'));
         } finally {
            globalThis.fetch = originalFetch;
         }
      });

      test('a refused GitHub token is not stored', async () => {
         globalThis.fetch = (async () =>
            new Response(JSON.stringify({ message: 'Bad credentials' }), {
               status: 401,
            })) as typeof fetch;
         try {
            const response = await app.request('/api/v1/integrations/connections/github/token', {
               method: 'POST',
               headers: {
                  authorization: `Bearer ${token}`,
                  'content-type': 'application/json',
               },
               body: JSON.stringify({ accessToken: 'ghp_bad' }),
            });
            assert.equal(response.status, 401);
            const body = (await response.json()) as { code: string };
            assert.equal(body.code, 'TOKEN_REFUSED');
            await assert.rejects(() => connections.token(workspaceId, 'github'));
         } finally {
            globalThis.fetch = originalFetch;
         }
      });

      test('a valid GitHub token is sealed with the account login', async () => {
         globalThis.fetch = (async (input) => {
            assert.match(String(input), /api\.github\.com\/user/);
            return new Response(JSON.stringify({ id: 42, login: 'octocat' }), { status: 200 });
         }) as typeof fetch;
         try {
            const response = await app.request('/api/v1/integrations/connections/github/token', {
               method: 'POST',
               headers: {
                  authorization: `Bearer ${token}`,
                  'content-type': 'application/json',
               },
               body: JSON.stringify({ accessToken: 'ghp_good' }),
            });
            assert.equal(response.status, 200);
            const body = (await response.json()) as {
               connection: { accountName: string | null; accountId: string | null };
            };
            assert.equal(body.connection.accountName, 'octocat');
            assert.equal(body.connection.accountId, '42');
            assert.equal(await connections.token(workspaceId, 'github'), 'ghp_good');

            const [row] = await sql<Array<{ connection_type: string }>>`
               SELECT connection_type FROM integration_connections
                WHERE workspace_id = ${workspaceId} AND provider = 'github'
                  AND status = 'connected'`;
            assert.equal(row?.connection_type, 'access_token');
         } finally {
            globalThis.fetch = originalFetch;
         }
      });
   }
);
