import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';

import { AutopilotRepository } from '../autopilots/repository.ts';
import { IssueRepository } from '../core/issues.ts';
import { closeDatabase, openDatabase, type Sql } from '../db/pool.ts';
import { unavailableSealer } from '../integrations/sealing.ts';
import { CATALOG } from '../organization/catalog.ts';
import { ensureDiscovery } from '../organization/discovery.ts';
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
   let autopilots: AutopilotRepository;
   let issues: IssueRepository;

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
      issues = new IssueRepository(sql);
      autopilots = new AutopilotRepository({ sql, sealer: unavailableSealer('test') });
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

   test('a new workspace gets role agents, pack skills and discovery autopilots', async () => {
      const steps: string[] = [];
      await autoseedWorkspace(sql, workspaceId, {
         skills: pack,
         syncRuntime: async () => {
            steps.push('runtime');
            throw new Error('runtime unavailable');
         },
         ensureDiscovery: async (id) => {
            steps.push('discovery');
            return ensureDiscovery(sql, id, { autopilots, issues });
         },
         onError: (step) => steps.push(`error:${step}`),
      });

      // Runtime failure is logged and does not block skills or discovery.
      assert.deepEqual(steps, ['runtime', 'error:runtime', 'discovery']);

      const [agents] = await sql<Array<{ n: number }>>`
         SELECT count(*)::int AS n FROM agents
          WHERE workspace_id = ${workspaceId} AND archived_at IS NULL AND role_key IS NOT NULL`;
      assert.equal(agents!.n, CATALOG.length);

      const [skills] = await sql<Array<{ n: number }>>`
         SELECT count(*)::int AS n FROM skills WHERE workspace_id = ${workspaceId} AND name = 'product-discovery'`;
      assert.equal(skills!.n, 1);

      const [bindings] = await sql<Array<{ n: number }>>`
         SELECT count(*)::int AS n FROM agent_skills WHERE workspace_id = ${workspaceId}`;
      assert.ok((bindings!.n ?? 0) >= 1, 'pack skill is bound to the matching role');

      const [discovery] = await sql<Array<{ n: number }>>`
         SELECT count(*)::int AS n FROM autopilots
          WHERE workspace_id = ${workspaceId} AND archived_at IS NULL
            AND discovery_role IS NOT NULL AND issue_id IS NOT NULL`;
      assert.equal(discovery!.n, 18);

      await autoseedWorkspace(sql, workspaceId, {
         skills: pack,
         ensureDiscovery: (id) => ensureDiscovery(sql, id, { autopilots, issues }),
      });
      const [again] = await sql<Array<{ n: number }>>`
         SELECT count(*)::int AS n FROM autopilots
          WHERE workspace_id = ${workspaceId} AND archived_at IS NULL AND discovery_role IS NOT NULL`;
      assert.equal(again!.n, 18);
   });
});
