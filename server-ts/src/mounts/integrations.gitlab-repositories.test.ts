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

const url = process.env.BERRY_TEST_DATABASE_URL;

describe(
   'GitLab repository listing',
   { skip: url ? false : 'BERRY_TEST_DATABASE_URL is not set' },
   () => {
      let sql: Sql;
      let app: BerryApp;
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
            VALUES (${randomUUID()}, ${`gl-repos-${suffix}@berry.test`}, 'GitLab Repos')
            RETURNING id`;
         userId = user!.id as string;
         const [workspace] = await sql`
            INSERT INTO workspaces (id, name, slug, settings, created_by)
            VALUES (${randomUUID()}, ${`GL Repos ${suffix}`}, ${`gl-repos-${suffix}`},
                    ${sql.json({ issuePrefix: 'GLR', defaultRole: 'member', allowMemberInvites: false } as never)},
                    ${userId})
            RETURNING id`;
         workspaceId = workspace!.id as string;
         await sql`
            INSERT INTO workspace_memberships (workspace_id, user_id, role)
            VALUES (${workspaceId}, ${userId}, 'owner')`;
         await sql`UPDATE users SET last_workspace_id = ${workspaceId} WHERE id = ${userId}`;
         token = await issueTestToken(sql, userId);

         connections = new ConnectionRepository({ sql, sealer: sealerFromKey(APP_SEALING_KEY) });
         const sessions = new SessionService({
            sql,
            auth: null,
            bearer: [personalTokenResolver(sql)],
         });
         const registry = new Registry();
         registry.registerAll(
            integrationMounts({
               sessions,
               boards: new BoardRepository(sql),
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

      test('without a connection the list is NOT_CONNECTED', async () => {
         const response = await app.request('/api/v1/integrations/gitlab/repositories', {
            headers: { authorization: `Bearer ${token}` },
         });
         assert.equal(response.status, 409);
         const body = (await response.json()) as { code: string };
         assert.equal(body.code, 'NOT_CONNECTED');
      });

      test('a connected token lists membership projects', async () => {
         globalThis.fetch = (async (input) => {
            const requestUrl = String(input);
            if (requestUrl.includes('/api/v4/user')) {
               return new Response(JSON.stringify({ id: 1, username: 'gl' }), { status: 200 });
            }
            if (requestUrl.includes('/api/v4/projects')) {
               return new Response(
                  JSON.stringify([
                     {
                        id: 55,
                        path_with_namespace: 'group/sub/repo',
                        name: 'repo',
                        visibility: 'private',
                        default_branch: 'main',
                     },
                  ]),
                  { status: 200 }
               );
            }
            return new Response('unexpected', { status: 500 });
         }) as typeof fetch;

         try {
            const connect = await app.request('/api/v1/integrations/connections/gitlab/token', {
               method: 'POST',
               headers: {
                  authorization: `Bearer ${token}`,
                  'content-type': 'application/json',
               },
               body: JSON.stringify({ accessToken: 'glpat-list' }),
            });
            assert.equal(connect.status, 200);

            const response = await app.request('/api/v1/integrations/gitlab/repositories', {
               headers: { authorization: `Bearer ${token}` },
            });
            assert.equal(response.status, 200);
            const body = (await response.json()) as {
               repositories: Array<{ fullName: string; id: number }>;
               access: { source: string };
            };
            assert.equal(body.access.source, 'connection');
            assert.deepEqual(body.repositories, [
               {
                  id: 55,
                  fullName: 'group/sub/repo',
                  name: 'repo',
                  private: true,
                  defaultBranch: 'main',
                  htmlUrl: 'https://gitlab.com/group/sub/repo',
               },
            ]);
         } finally {
            globalThis.fetch = originalFetch;
         }
      });
   }
);
