import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { personalTokenResolver } from '../auth/credentials.ts';
import { SessionService } from '../auth/sessions.ts';
import { issueTestToken } from '../auth/test-credentials.ts';
import { closeDatabase, openDatabase, type Sql } from '../db/pool.ts';
import { createApp, type BerryApp } from '../http/app.ts';
import { IdempotencyStore } from '../http/idempotency.ts';
import { Registry } from '../http/registry.ts';
import { catalogRole } from '../organization/catalog.ts';
import { ensureOrganizationAgents } from '../organization/provision.ts';
import { cleanupFixture, seedFixture, type Fixture } from '../runtime/test-fixture.ts';
import { agentMounts } from './agents.ts';
import { AgentRepository } from '../agents/repository.ts';
import { organizationMounts } from './organization.ts';

const url = process.env.BERRY_TEST_DATABASE_URL;

describe('/api/v1/organization', { skip: url ? false : 'BERRY_TEST_DATABASE_URL is not set' }, () => {
   let sql: Sql;
   let app: BerryApp;
   let mine: Fixture | null = null;
   let token = '';
   let memberId = '';
   let memberToken = '';

   before(async () => {
      sql = openDatabase({ url: url as string });
      mine = await seedFixture(sql, 'org-a');
      await ensureOrganizationAgents(sql, mine.workspaceId);
      const sessions = new SessionService({ sql, auth: null, bearer: [personalTokenResolver(sql)] });
      await sql`UPDATE users SET last_workspace_id = ${mine.workspaceId} WHERE id = ${mine.userId}`;
      token = await issueTestToken(sql, mine.userId);

      const [member] = await sql`
         INSERT INTO users (id, email, name)
         VALUES (${randomUUID()}, ${`org-member-${randomUUID().slice(0, 8)}@berry.test`}, 'Member')
         RETURNING id`;
      memberId = member!.id as string;
      await sql`
         INSERT INTO workspace_memberships (workspace_id, user_id, role)
         VALUES (${mine.workspaceId}, ${memberId}, 'member')`;
      await sql`UPDATE users SET last_workspace_id = ${mine.workspaceId} WHERE id = ${memberId}`;
      memberToken = await issueTestToken(sql, memberId);

      const registry = new Registry();
      registry.registerAll(organizationMounts({ sessions, sql }));
      registry.registerAll(
         agentMounts({
            sessions,
            agents: new AgentRepository(sql),
            idempotency: new IdempotencyStore(sql),
            catalog: null,
         })
      );
      app = createApp(registry);
   });

   after(async () => {
      if (!sql) return;
      await sql`DELETE FROM personal_api_tokens WHERE user_id = ${memberId}`;
      await sql`DELETE FROM workspace_memberships WHERE user_id = ${memberId}`;
      await sql`DELETE FROM users WHERE id = ${memberId}`;
      await cleanupFixture(sql, mine);
      await closeDatabase(sql);
   });

   const call = (path: string, init: RequestInit = {}, asToken = token) =>
      app.request(path, {
         ...init,
         headers: { authorization: `Bearer ${asToken}`, 'content-type': 'application/json' },
      });

   const agentIdFor = async (roleKey: string): Promise<string> => {
      const [row] = await sql`
         SELECT id FROM agents WHERE workspace_id = ${mine!.workspaceId} AND role_key = ${roleKey}`;
      return row!.id as string;
   };

   test('the organization lists every department and role with discovery state', async () => {
      const response = await call('/api/v1/organization');
      assert.equal(response.status, 200);
      const body = (await response.json()) as {
         departments: Array<{ key: string; roles: Array<{ roleKey: string }> }>;
         discoveryEnabled: boolean;
      };
      assert.equal(body.departments.flatMap((d) => d.roles).length, 19);
      assert.equal(body.discoveryEnabled, true);
   });

   test('a contract with tools above its level is refused', async () => {
      const contract = { ...catalogRole('business-analyst')!, allowed_tools: ['read_task', 'run_command'] };
      const response = await call(`/api/v1/agents/${await agentIdFor('business-analyst')}/contract`, {
         method: 'PUT',
         body: JSON.stringify(contract),
      });
      assert.equal(response.status, 400);
      assert.equal(((await response.json()) as { error: { code: string } }).error.code, 'TOOLS_ABOVE_LEVEL');
   });

   test('an edited contract is customised until reset', async () => {
      const contract = {
         ...catalogRole('technical-writer')!,
         mission: 'Keep the docs honest.',
         run_limits: { max_turns: 7, max_output_tokens: 1024 },
      };
      const agentId = await agentIdFor('technical-writer');
      assert.equal(
         (await call(`/api/v1/agents/${agentId}/contract`, { method: 'PUT', body: JSON.stringify(contract) })).status,
         200
      );
      const edited = (await (await call(`/api/v1/agents/${agentId}`)).json()) as {
         customized: boolean;
         limits: { maxTurns: number; maxTokens: number } | null;
      };
      assert.equal(edited.customized, true);
      assert.deepEqual(edited.limits, { maxTurns: 7, maxTokens: 1024 }, 'runs read the edited run limits');
      assert.equal(
         (await call('/api/v1/organization/roles/technical-writer/reset', { method: 'POST', body: '{}' })).status,
         200
      );
      const reset = (await (await call(`/api/v1/agents/${agentId}`)).json()) as { customized: boolean };
      assert.equal(reset.customized, false);
   });

   test('a role whose stored contract fails validation stays visible, flagged invalid, until reset', async () => {
      await sql`
         UPDATE agents SET role_contract = ${sql.json({ id: 'technical-writer' } as never)}
          WHERE workspace_id = ${mine!.workspaceId} AND role_key = 'technical-writer'`;
      try {
         const body = (await (await call('/api/v1/organization')).json()) as {
            departments: Array<{
               key: string;
               roles: Array<{ roleKey: string; contractValid: boolean; customized: boolean }>;
            }>;
            delegation: Array<{ from: string; to: string }>;
         };
         const growth = body.departments.find((d) => d.key === 'growth-insight');
         assert.ok(growth);
         const broken = growth!.roles.find((r) => r.roleKey === 'technical-writer');
         assert.ok(broken, 'the broken role is still listed');
         assert.equal(broken!.contractValid, false);
         assert.equal(broken!.customized, true);
         assert.equal(
            body.delegation.some((edge) => edge.from === 'technical-writer'),
            false
         );
         for (const department of body.departments) {
            for (const role of department.roles) {
               if (role.roleKey !== 'technical-writer') assert.equal(role.contractValid, true);
            }
         }
      } finally {
         assert.equal(
            (await call('/api/v1/organization/roles/technical-writer/reset', { method: 'POST', body: '{}' })).status,
            200
         );
      }
      const restored = (await (await call('/api/v1/organization')).json()) as {
         departments: Array<{ roles: Array<{ roleKey: string; contractValid: boolean; customized: boolean }> }>;
      };
      const fixed = restored.departments.flatMap((d) => d.roles).find((r) => r.roleKey === 'technical-writer');
      assert.equal(fixed?.contractValid, true);
      assert.equal(fixed?.customized, false);
   });

   test('a non-admin member is refused the contract write and the role reset', async () => {
      const agentId = await agentIdFor('ux-researcher');
      const contract = { ...catalogRole('ux-researcher')!, mission: 'Different mission entirely.' };
      const contractResponse = await call(
         `/api/v1/agents/${agentId}/contract`,
         { method: 'PUT', body: JSON.stringify(contract) },
         memberToken
      );
      assert.equal(contractResponse.status, 403);
      const resetResponse = await call(
         '/api/v1/organization/roles/ux-researcher/reset',
         { method: 'POST', body: '{}' },
         memberToken
      );
      assert.equal(resetResponse.status, 403);
   });

   test('an unsupported severity filter is refused', async () => {
      const response = await call('/api/v1/work-proposals?severity=bogus');
      assert.equal(response.status, 400);
   });

   test('discovery can be turned off for the workspace', async () => {
      const response = await call('/api/v1/organization/discovery', {
         method: 'PUT',
         body: JSON.stringify({ enabled: false }),
      });
      assert.equal(response.status, 200);
      assert.equal(((await response.json()) as { discoveryEnabled: boolean }).discoveryEnabled, false);
      const after = (await (await call('/api/v1/organization')).json()) as { discoveryEnabled: boolean };
      assert.equal(after.discoveryEnabled, false);
      // Restore, so this test does not leak state into any test that runs after it.
      await call('/api/v1/organization/discovery', { method: 'PUT', body: JSON.stringify({ enabled: true }) });
   });

   test('a role agent is never granted repository permissions above its level', async () => {
      const productLead = await agentIdFor('product-lead');
      const refused = await call(`/api/v1/agents/${productLead}/permissions`, {
         method: 'PUT',
         body: JSON.stringify({ permissions: ['read_repository', 'create_branches'] }),
      });
      assert.equal(refused.status, 422);
      assert.equal(((await refused.json()) as { error: { code: string } }).error.code, 'PERMISSIONS_ABOVE_LEVEL');
      const [row] = await sql`SELECT permissions FROM agents WHERE id = ${productLead}`;
      assert.deepEqual(row?.permissions, ['read_repository'], 'nothing was written');

      const within = await call(`/api/v1/agents/${await agentIdFor('backend-engineer')}/permissions`, {
         method: 'PUT',
         body: JSON.stringify({ permissions: ['read_repository', 'create_branches'] }),
      });
      assert.equal(within.status, 200, 'a Level 3 role may hold what its level allows');
   });

   test('restoring a role agent whose role another agent fills again is a 409, not a 500', async () => {
      const [original] = await sql`
         SELECT id, role_contract, autonomy_level FROM agents
          WHERE workspace_id = ${mine!.workspaceId} AND role_key = 'growth-engineer' AND archived_at IS NULL`;
      const originalId = original!.id as string;
      assert.equal((await call(`/api/v1/agents/${originalId}`, { method: 'DELETE' })).status, 204);
      // A live duplicate from before archived roles counted as removed.
      const duplicateId = randomUUID();
      await sql`
         INSERT INTO agents (id, workspace_id, name, status, role_key, role_contract, autonomy_level)
         VALUES (${duplicateId}, ${mine!.workspaceId}, 'Growth Engineer (again)', 'available', 'growth-engineer',
                 ${sql.json(original!.role_contract as never)}, ${original!.autonomy_level as number})`;
      try {
         const response = await call(`/api/v1/agents/${originalId}/restore`, { method: 'POST', body: '{}' });
         assert.equal(response.status, 409);
         assert.equal(((await response.json()) as { error: { code: string } }).error.code, 'ROLE_TAKEN');
      } finally {
         await sql`DELETE FROM agents WHERE id = ${duplicateId}`;
      }
      assert.equal((await call(`/api/v1/agents/${originalId}/restore`, { method: 'POST', body: '{}' })).status, 200);
   });

   test('without a session nothing answers', async () => {
      assert.equal((await app.request('/api/v1/organization')).status, 401);
      assert.equal((await app.request('/api/v1/work-proposals')).status, 401);
   });
});
