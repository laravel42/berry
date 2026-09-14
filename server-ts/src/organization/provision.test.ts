import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';

import { closeDatabase, openDatabase, type Sql } from '../db/pool.ts';
import { deleteWorkspaceBoards } from '../test-support/boards.ts';
import { deleteWorkspaceAgents } from '../test-support/protected-agents.ts';
import { AgentRepository } from '../agents/repository.ts';
import { CATALOG, CATALOG_VERSION, catalogRole, MODELS } from './catalog.ts';
import { hashContract } from './contract.ts';
import { ensureOrganizationAgents, KEPT_INSTRUCTIONS_SUFFIX, resetRole } from './provision.ts';

const url = process.env.BERRY_TEST_DATABASE_URL;

describe('provisioning the organization', { skip: url ? false : 'BERRY_TEST_DATABASE_URL is not set' }, () => {
   let sql: Sql;
   let workspaceId: string;

   before(async () => {
      sql = openDatabase({ url: url! });
      const [workspace] = await sql`
         INSERT INTO workspaces (id, slug, name) VALUES (${randomUUID()}, ${`org-${randomUUID().slice(0, 8)}`}, 'Org')
         RETURNING id`;
      workspaceId = workspace!.id as string;
      // Legacy agents the organization retires.
      await sql`
         INSERT INTO agents (id, workspace_id, name, instructions, status)
         VALUES (${randomUUID()}, ${workspaceId}, 'us-nova-micro', 'You are US Nova Micro, one of a fleet of agents that differ only by model.', 'available'),
                (${randomUUID()}, ${workspaceId}, 'text-to-speech', 'You produce spoken audio from text.', 'available')`;
   });

   after(async () => {
      if (!sql) return;
      await deleteWorkspaceAgents(sql, [workspaceId]);
      await deleteWorkspaceBoards(sql, [workspaceId]);
      await sql`DELETE FROM workspaces WHERE id = ${workspaceId}`;
      await closeDatabase(sql);
   });

   const rows = () => sql`
      SELECT name, role_key, protected, autonomy_level, model_name, permissions, contract_version, archived_at
        FROM agents WHERE workspace_id = ${workspaceId} ORDER BY role_key NULLS LAST, name`;

   test('every role exists once; the Orchestrator keeps its protection and gains its contract', async () => {
      const result = await ensureOrganizationAgents(sql, workspaceId);
      assert.equal(result.inserted.length, CATALOG.length - 1, 'all but the trigger-made Orchestrator are inserted');
      const live = (await rows()).filter((row) => row.archived_at === null);
      const roles = live.filter((row) => row.role_key !== null);
      assert.equal(roles.length, CATALOG.length);
      const orchestrator = roles.find((row) => row.role_key === 'orchestrator');
      assert.equal(orchestrator?.protected, true);
      assert.equal(roles.filter((row) => row.protected).length, 1);
      assert.equal(roles.find((row) => row.role_key === 'engineering-manager')?.protected, false);
      assert.equal(roles.find((row) => row.role_key === 'cto')?.model_name, MODELS.opus);
      assert.deepEqual(roles.find((row) => row.role_key === 'product-lead')?.permissions, ['read_repository']);
      assert.ok(roles.every((row) => row.contract_version === CATALOG_VERSION));
   });

   test('legacy fleet and media agents are archived; the Guide is untouched', async () => {
      const all = await rows();
      assert.ok(all.find((row) => row.name === 'us-nova-micro')?.archived_at);
      assert.ok(all.find((row) => row.name === 'text-to-speech')?.archived_at);
      const guide = all.find((row) => row.name === 'Guide');
      assert.ok(guide && guide.archived_at === null && guide.role_key === null);
   });

   test('running it again changes nothing', async () => {
      const second = await ensureOrganizationAgents(sql, workspaceId);
      assert.deepEqual(second, { inserted: [], upgraded: [], customised: [], archived: 0 });
   });

   test('an archived role is a deliberate removal: not re-inserted, and restoring brings it back', async () => {
      const agents = new AgentRepository(sql);
      const [growth] = await sql`
         SELECT id FROM agents WHERE workspace_id = ${workspaceId} AND role_key = 'growth-engineer' AND archived_at IS NULL`;
      const growthId = growth!.id as string;
      await agents.archive(growthId, workspaceId, new Date());

      const rerun = await ensureOrganizationAgents(sql, workspaceId);
      assert.deepEqual(rerun.inserted, [], 'the removed role is not provisioned again');
      const live = await sql`
         SELECT id FROM agents WHERE workspace_id = ${workspaceId} AND role_key = 'growth-engineer' AND archived_at IS NULL`;
      assert.equal(live.length, 0);

      const restored = await agents.restore(growthId, workspaceId);
      assert.equal(restored.roleKey, 'growth-engineer');
      assert.equal(restored.archivedAt, null);
      assert.deepEqual(await ensureOrganizationAgents(sql, workspaceId), { inserted: [], upgraded: [], customised: [], archived: 0 });
   });

   test('an adopted Orchestrator whose instructions a person wrote is customised until reset', async () => {
      const [workspace] = await sql`
         INSERT INTO workspaces (id, slug, name) VALUES (${randomUUID()}, ${`orch-${randomUUID().slice(0, 8)}`}, 'Orch')
         RETURNING id`;
      const otherId = workspace!.id as string;
      try {
         await sql`UPDATE agents SET instructions = 'Answer in French.' WHERE workspace_id = ${otherId} AND protected`;
         await ensureOrganizationAgents(sql, otherId);

         const agents = new AgentRepository(sql);
         const [row] = await sql`
            SELECT id, instructions, contract_hash FROM agents WHERE workspace_id = ${otherId} AND role_key = 'orchestrator'`;
         assert.equal(row?.instructions, 'Answer in French.', 'a person\'s instructions stay');
         assert.equal(row?.contract_hash, hashContract(catalogRole('orchestrator')!) + KEPT_INSTRUCTIONS_SUFFIX);
         const adopted = await agents.get(row!.id as string, otherId);
         assert.equal(adopted.customized, true);
         assert.equal(adopted.protected, true);

         await resetRole(sql, otherId, 'orchestrator');
         const reset = await agents.get(row!.id as string, otherId);
         assert.equal(reset.customized, false);
         assert.equal(reset.instructions, catalogRole('orchestrator')!.system_prompt);
      } finally {
         await deleteWorkspaceAgents(sql, [otherId]);
         await deleteWorkspaceBoards(sql, [otherId]);
         await sql`DELETE FROM workspaces WHERE id = ${otherId}`;
      }
   });

   test('an older contract is upgraded unless a person edited it', async () => {
      await sql`
         UPDATE agents SET contract_version = 0
          WHERE workspace_id = ${workspaceId} AND role_key IN ('qa-engineer', 'technical-writer')`;
      await sql`
         UPDATE agents SET role_contract = jsonb_set(role_contract, '{mission}', '"Edited by a person."')
          WHERE workspace_id = ${workspaceId} AND role_key = 'technical-writer'`;
      const result = await ensureOrganizationAgents(sql, workspaceId);
      assert.deepEqual(result.upgraded, ['qa-engineer']);
      assert.deepEqual(result.customised, ['technical-writer']);
      const [writer] = await sql`
         SELECT role_contract->>'mission' AS mission FROM agents
          WHERE workspace_id = ${workspaceId} AND role_key = 'technical-writer'`;
      assert.equal(writer?.mission, 'Edited by a person.');
   });
});
