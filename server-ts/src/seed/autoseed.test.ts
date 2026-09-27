import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';

import { closeDatabase, openDatabase, type Sql } from '../db/pool.ts';
import { CORE_ROLES } from '../organization/catalog.ts';
import { deleteWorkspaceBoards } from '../test-support/boards.ts';
import { deleteWorkspaceAgents } from '../test-support/protected-agents.ts';
import { autoseedWorkspace } from './deploy.ts';
import type { PackedSkill } from './skill-pack.ts';

const url = process.env.BERRY_TEST_DATABASE_URL;

describe('autoseedWorkspace', { skip: url ? false : 'BERRY_TEST_DATABASE_URL is not set' }, () => {
   let sql: Sql;
   let workspaceId: string;
   let userId: string;
   let boardId: string;

   const pack: PackedSkill[] = [
      {
         name: 'product-discovery',
         description: 'Use for a new product idea.',
         content: '# Product discovery\n',
         labels: ['Product Lead'],
      },
   ];

   before(async () => {
      sql = openDatabase({ url: url! });
      const suffix = randomUUID().slice(0, 8);
      const [user] = await sql`
         INSERT INTO users (id, email, name)
         VALUES (${randomUUID()}, ${`autoseed-${suffix}@berry.test`}, 'Autoseed test')
         RETURNING id`;
      userId = user!.id as string;
      const [workspace] = await sql`
         INSERT INTO workspaces (id, slug, name, created_by, discovery_enabled)
         VALUES (${randomUUID()}, ${`auto-${suffix}`}, 'Autoseed org', ${userId}, true)
         RETURNING id`;
      workspaceId = workspace!.id as string;
      await sql`
         INSERT INTO workspace_memberships (workspace_id, user_id, role)
         VALUES (${workspaceId}, ${userId}, 'owner')`;
      const [board] = await sql`SELECT id FROM boards WHERE workspace_id = ${workspaceId}`;
      boardId = board!.id as string;
   });

   after(async () => {
      if (!sql) return;
      await sql`DELETE FROM autopilot_runs WHERE workspace_id = ${workspaceId}`;
      await sql`DELETE FROM autopilot_triggers WHERE workspace_id = ${workspaceId}`;
      await sql`DELETE FROM autopilots WHERE workspace_id = ${workspaceId}`;
      await sql`DELETE FROM agent_skills WHERE workspace_id = ${workspaceId}`;
      await sql`DELETE FROM skills WHERE workspace_id = ${workspaceId}`;
      await sql`DELETE FROM issues WHERE board_id = ${boardId}`;
      await deleteWorkspaceAgents(sql, [workspaceId]);
      await deleteWorkspaceBoards(sql, [workspaceId]);
      await sql`DELETE FROM workspaces WHERE id = ${workspaceId}`;
      await sql`DELETE FROM users WHERE id = ${userId}`;
      await closeDatabase(sql);
   });

   test('a new workspace gets role agents and pack skills, and no autopilots', async () => {
      const steps: string[] = [];
      await autoseedWorkspace(sql, workspaceId, {
         skills: pack,
         syncRuntime: async () => {
            steps.push('runtime');
            throw new Error('runtime unavailable');
         },
         onError: (step) => steps.push(`error:${step}`),
      });

      // Runtime failure is logged and does not block skills.
      assert.deepEqual(steps, ['runtime', 'error:runtime']);

      const [agents] = await sql<Array<{ n: number }>>`
         SELECT count(*)::int AS n FROM agents
          WHERE workspace_id = ${workspaceId} AND archived_at IS NULL AND role_key IS NOT NULL`;
      assert.equal(agents!.n, CORE_ROLES.length, 'the core roles only (ADR-0018)');

      const [skills] = await sql<Array<{ n: number }>>`
         SELECT count(*)::int AS n FROM skills WHERE workspace_id = ${workspaceId} AND name = 'product-discovery'`;
      assert.equal(skills!.n, 1);

      const [bindings] = await sql<Array<{ n: number }>>`
         SELECT count(*)::int AS n FROM agent_skills WHERE workspace_id = ${workspaceId}`;
      assert.ok((bindings!.n ?? 0) >= 1, 'pack skill is bound to the matching role');

      // Weekly discovery is switched on by a person, even where the flag is
      // already on: nothing seeds its autopilots.
      await autoseedWorkspace(sql, workspaceId, { skills: pack });
      const [autopilots] = await sql<Array<{ n: number }>>`
         SELECT count(*)::int AS n FROM autopilots WHERE workspace_id = ${workspaceId}`;
      assert.equal(autopilots!.n, 0);
   });
});
