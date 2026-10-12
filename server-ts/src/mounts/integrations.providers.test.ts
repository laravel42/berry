import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';

import { symmetricEncrypt } from 'better-auth/crypto';

import { personalTokenResolver } from '../auth/credentials.ts';
import { SessionService } from '../auth/sessions.ts';
import { issueTestToken } from '../auth/test-credentials.ts';
import { BoardRepository } from '../core/boards.ts';
import { closeDatabase, openDatabase, type Sql } from '../db/pool.ts';
import { createApp, type BerryApp } from '../http/app.ts';
import { Registry } from '../http/registry.ts';
import { ConnectionRepository } from '../integrations/connections.ts';
import { GitHubAppRepository, type StoredApp } from '../integrations/github-app.ts';
import { GitHubUserAccess } from '../integrations/github-user.ts';
import { sealerFromKey } from '../integrations/sealing.ts';
import { APP_SEALING_KEY } from '../test-support/github-app.ts';
import { deleteWorkspaceBoards } from '../test-support/boards.ts';
import { deleteWorkspaceAgents } from '../test-support/protected-agents.ts';
import { integrationMounts, type IntegrationsOptions } from './integrations.ts';

/**
 * `GET /providers`, and whether GitHub reads as connected.
 *
 * An installed App connects it. A person who only signed in stays
 * disconnected, and the route never calls GitHub to decide.
 */

const url = process.env.BERRY_TEST_DATABASE_URL;

const AUTH_SECRET = 'integrations-providers-test-secret-32chars';

interface ProvidersResponse {
   providers: Array<{
      id: string;
      name?: string;
      connected: boolean;
      status: string | null;
      source: 'app' | 'sign-in' | null;
      accountName: string | null;
      scopes: string[];
      tools: Array<{ name: string; allowed?: boolean }>;
   }>;
}

/** Calls that reached "GitHub". `/providers` has to answer from the database alone. */
let githubCalls = 0;

function countingFetch(): typeof globalThis.fetch {
   return (async () => {
      githubCalls += 1;
      return new Response(JSON.stringify({ message: 'Server Error' }), { status: 500 });
   }) as unknown as typeof globalThis.fetch;
}

describe(
   'the provider catalogue reading GitHub sign-in as connected',
   { skip: url ? false : 'BERRY_TEST_DATABASE_URL is not set' },
   () => {
      let sql: Sql;
      let signedInApp: BerryApp;
      let installedApp: BerryApp;
      let neitherApp: BerryApp;
      let signedInToken: string;
      let neitherToken: string;
      let installedToken: string;
      let signedInWorkspaceId: string;
      let neitherWorkspaceId: string;
      let installedWorkspaceId: string;
      let signedInUserId: string;
      let neitherUserId: string;
      let installedUserId: string;
      let memberUserId: string;
      let memberToken: string;
      let noAppApp: BerryApp;
      let failingApp: BerryApp;
      let githubApp: GitHubAppRepository;

      const suffix = randomBytes(4).toString('hex');
      const APP_ID = 9_191_000 + Math.floor(Math.random() * 8_000);
      /** Never actually written to `github_apps`: `withStoredApp` below hands
       *  it back for every `.app()` call, so this file never touches the
       *  deployment's singleton App row or races with one another file wrote. */
      const ourApp: StoredApp = {
         appId: APP_ID,
         slug: `berry-providers-${suffix}`,
         name: 'Berry Providers Test',
         clientId: 'Iv1.providers-test',
         htmlUrl: 'https://github.com/apps/berry-providers-test',
         createdAt: new Date().toISOString(),
      };

      /**
       * The same repository, answering `.app()` with the App above rather
       * than the deployment's real (shared) row — see the comment on `ourApp`.
       */
      function withStoredApp(real: GitHubAppRepository): GitHubAppRepository {
         return new Proxy(real, {
            get(target, property, receiver) {
               if (property === 'app') return async () => ourApp;
               const value = Reflect.get(target, property, receiver);
               return typeof value === 'function' ? value.bind(target) : value;
            },
         });
      }

      async function makeUserAndWorkspace(
         label: string
      ): Promise<{ userId: string; workspaceId: string; token: string }> {
         const settings = { issuePrefix: label.toUpperCase(), defaultRole: 'member', allowMemberInvites: false };
         const [user] = await sql`
            INSERT INTO users (id, email, name)
            VALUES (${randomUUID()}, ${`providers-${label}-${suffix}@berry.test`}, ${label})
            RETURNING id`;
         const userId = user!.id as string;
         const [workspace] = await sql`
            INSERT INTO workspaces (id, name, slug, settings, created_by)
            VALUES (${randomUUID()}, ${`Providers ${label} ${suffix}`}, ${`providers-${label}-${suffix}`},
                    ${sql.json(settings as never)}, ${userId})
            RETURNING id`;
         const workspaceId = workspace!.id as string;
         await sql`
            INSERT INTO workspace_memberships (workspace_id, user_id, role)
            VALUES (${workspaceId}, ${userId}, 'owner')`;
         await sql`UPDATE users SET last_workspace_id = ${workspaceId} WHERE id = ${userId}`;
         const token = await issueTestToken(sql, userId);
         return { userId, workspaceId, token };
      }

      before(async () => {
         sql = openDatabase({ url: url! });

         const signedIn = await makeUserAndWorkspace('signedin');
         signedInUserId = signedIn.userId;
         signedInWorkspaceId = signedIn.workspaceId;
         signedInToken = signedIn.token;

         const neither = await makeUserAndWorkspace('neither');
         neitherUserId = neither.userId;
         neitherWorkspaceId = neither.workspaceId;
         neitherToken = neither.token;

         const installed = await makeUserAndWorkspace('installed');
         installedUserId = installed.userId;
         installedWorkspaceId = installed.workspaceId;
         installedToken = installed.token;

         // A member of the signed-in workspace with no GitHub account of their
         // own: the owner's sign-in is what runs use, so it is what they see.
         const [member] = await sql`
            INSERT INTO users (id, email, name)
            VALUES (${randomUUID()}, ${`providers-member-${suffix}@berry.test`}, 'member')
            RETURNING id`;
         memberUserId = member!.id as string;
         await sql`
            INSERT INTO workspace_memberships (workspace_id, user_id, role)
            VALUES (${signedInWorkspaceId}, ${memberUserId}, 'member')`;
         await sql`UPDATE users SET last_workspace_id = ${signedInWorkspaceId} WHERE id = ${memberUserId}`;
         memberToken = await issueTestToken(sql, memberUserId);

         // Only the signed-in user has a linked GitHub account.
         await sql`
            INSERT INTO auth_accounts (id, user_id, account_id, provider_id, access_token, scope)
            VALUES (${randomUUID()}, ${signedInUserId}, ${`gh-${signedInUserId}`}, 'github',
                    ${await symmetricEncrypt({ key: AUTH_SECRET, data: 'ghu_live' })}, 'repo,read:user')`;

         // `/providers` never asks GitHub anything about the App: it only
         // reads `.app()` (stubbed above) and the per-workspace installation
         // row written below, so no fetch stub is needed here.
         const realGithubApp = new GitHubAppRepository({
            sql,
            sealer: sealerFromKey(APP_SEALING_KEY),
            apiBaseUrl: 'https://api.github.test',
         });
         await realGithubApp.saveInstallation(
            {
               workspaceId: installedWorkspaceId,
               installationId: 555_555,
               accountLogin: 'acme',
               accountType: 'Organization',
            },
            installedUserId
         );
         githubApp = withStoredApp(realGithubApp);

         const connectionSealer = sealerFromKey(APP_SEALING_KEY);
         const connections = new ConnectionRepository({ sql, sealer: connectionSealer });
         const userAccess = new GitHubUserAccess({
            sql,
            authSecret: AUTH_SECRET,
            fetch: countingFetch(),
            apiBaseUrl: 'https://api.github.test',
         });

         const mount = (overrides: Partial<IntegrationsOptions> = {}): BerryApp => {
            const registry = new Registry();
            registry.registerAll(
               integrationMounts({
                  sessions: new SessionService({
                     sql,
                     auth: null,
                     bearer: [personalTokenResolver(sql)],
                  }),
                  boards: new BoardRepository(sql),
                  connections,
                  states: null,
                  github: null,
                  // No stored App for the sign-in/neither cases; the App
                  // case is told apart by having an installation recorded.
                  githubApp,
                  appSlug: null,
                  userAccess,
                  publicUrl: 'http://localhost:4000',
                  appUrl: 'http://localhost:3000',
                  completeAgentCoreAuthorization: null,
                  firstRunSetup: null,
                  ...overrides,
               })
            );
            return createApp(registry);
         };

         signedInApp = mount();
         neitherApp = mount();
         installedApp = mount();
         // A deployment that holds no App at all: sign-in is the only path.
         noAppApp = mount({ githubApp: null });
         // The sign-in check itself failing, which must not fail the route.
         failingApp = mount({
            userAccess: new Proxy(userAccess, {
               get(target, property, receiver) {
                  if (property === 'workspaceSignIn') {
                     return async () => {
                        throw new Error('database unavailable');
                     };
                  }
                  const value = Reflect.get(target, property, receiver);
                  return typeof value === 'function' ? value.bind(target) : value;
               },
            }),
         });
      });

      after(async () => {
         try {
            const workspaceIds = [signedInWorkspaceId, neitherWorkspaceId, installedWorkspaceId];
            await sql`DELETE FROM github_installations WHERE workspace_id = ${installedWorkspaceId}`;
            await sql`DELETE FROM auth_accounts WHERE user_id = ${signedInUserId}`;
            await sql`DELETE FROM personal_api_tokens WHERE user_id IN (${signedInUserId}, ${neitherUserId}, ${installedUserId}, ${memberUserId})`;
            for (const workspaceId of workspaceIds) {
               await sql`DELETE FROM outbox_events WHERE workspace_id = ${workspaceId}`;
            }
            await deleteWorkspaceAgents(sql, workspaceIds);
            await deleteWorkspaceBoards(sql, workspaceIds);
            for (const workspaceId of workspaceIds) {
               await sql`DELETE FROM issue_status_definitions WHERE workspace_id = ${workspaceId}`;
            }
            await sql`DELETE FROM workspaces WHERE id = ANY(${workspaceIds})`;
            await sql`DELETE FROM users WHERE id IN (${signedInUserId}, ${neitherUserId}, ${installedUserId}, ${memberUserId})`;
            await sql`DELETE FROM github_apps WHERE app_id = ${ourApp.appId}`;
         } finally {
            await closeDatabase(sql);
         }
      });

      async function providersOf(app: BerryApp, token: string): Promise<ProvidersResponse> {
         const response = await app.request('/api/v1/integrations/providers', {
            headers: { authorization: `Bearer ${token}` },
         });
         assert.equal(response.status, 200);
         return (await response.json()) as ProvidersResponse;
      }

      test('a GitHub sign-in does not connect the integration', async () => {
         githubCalls = 0;
         const body = await providersOf(signedInApp, signedInToken);
         assert.equal(githubCalls, 0, 'no GitHub call on a settings load');
         const github = body.providers.find((provider) => provider.id === 'github');
         assert.ok(github, 'github is in the catalogue');
         assert.equal(github!.connected, false);
         assert.equal(github!.source, null);
         assert.equal(github!.status, null);
         assert.ok(!JSON.stringify(body).includes('ghu_live'), 'the token is never in the response');
         assert.ok(github!.tools.every((tool) => tool.allowed !== true));
      });

      test('an installed App does not connect GitHub', async () => {
         const body = await providersOf(installedApp, installedToken);
         const github = body.providers.find((provider) => provider.id === 'github');
         assert.equal(github!.name, 'GitHub');
         assert.equal(github!.connected, false);
         assert.equal(github!.status, null);
         assert.equal(github!.source, null);
      });

      test('nobody signed in with GitHub and no App installed stays not connected', async () => {
         const body = await providersOf(neitherApp, neitherToken);
         const github = body.providers.find((provider) => provider.id === 'github');
         assert.equal(github!.connected, false);
         assert.equal(github!.source, null);
         assert.ok(github!.tools.every((tool) => tool.allowed !== true));
      });

      test('a member without their own GitHub still does not see the integration connected', async () => {
         const body = await providersOf(signedInApp, memberToken);
         const github = body.providers.find((provider) => provider.id === 'github');
         assert.equal(github!.connected, false);
         assert.equal(github!.source, null);
      });

      test('with no App on the deployment, a sign-in still leaves GitHub disconnected', async () => {
         const signedIn = await providersOf(noAppApp, signedInToken);
         const github = signedIn.providers.find((provider) => provider.id === 'github');
         assert.equal(github!.connected, false);
         assert.equal(github!.source, null);
         assert.equal(github!.status, null);

         const neither = await providersOf(noAppApp, neitherToken);
         const none = neither.providers.find((provider) => provider.id === 'github');
         assert.equal(none!.connected, false);
         assert.equal(none!.source, null);
      });

      test('a sign-in check that throws reads as not connected, not as a failed route', async () => {
         const body = await providersOf(failingApp, signedInToken);
         const github = body.providers.find((provider) => provider.id === 'github');
         assert.equal(github!.connected, false);
         assert.equal(github!.source, null);
         assert.ok(github!.tools.every((tool) => tool.allowed === false));
      });

      test('a refused sign-in token does not mark the integration for reconnect', async () => {
         const accountId = randomUUID();
         await sql`
            INSERT INTO auth_accounts (id, user_id, account_id, provider_id, access_token, scope)
            VALUES (${accountId}, ${neitherUserId}, ${`gh-${neitherUserId}`}, 'github', NULL, 'repo')`;
         try {
            const withApp = await providersOf(neitherApp, neitherToken);
            const installed = withApp.providers.find((provider) => provider.id === 'github');
            assert.equal(installed!.connected, false);
            assert.equal(installed!.status, null);

            const withoutApp = await providersOf(noAppApp, neitherToken);
            const none = withoutApp.providers.find((provider) => provider.id === 'github');
            assert.equal(none!.connected, false);
            assert.equal(none!.status, null);
         } finally {
            await sql`DELETE FROM auth_accounts WHERE id = ${accountId}`;
         }
      });

      test('a token GitHub refused is cleared only when it is the one still stored', async () => {
         const userAccess = new GitHubUserAccess({ sql, authSecret: AUTH_SECRET, fetch: countingFetch() });
         const [before] = await sql`SELECT access_token FROM auth_accounts WHERE user_id = ${signedInUserId}`;
         try {
            await userAccess.refuseWorkspaceToken(signedInWorkspaceId, 'ghu_replaced_since');
            assert.equal(await userAccess.workspaceToken(signedInWorkspaceId), 'ghu_live');

            await userAccess.refuseWorkspaceToken(signedInWorkspaceId, 'ghu_live');
            assert.equal(await userAccess.workspaceSignIn(signedInWorkspaceId), null);
            assert.equal(await userAccess.workspaceSignInRefused(signedInWorkspaceId), true);
         } finally {
            await sql`UPDATE auth_accounts SET access_token = ${before!.access_token as string} WHERE user_id = ${signedInUserId}`;
         }
      });
   }
);
