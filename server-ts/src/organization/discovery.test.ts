import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';

import { AgentRepository } from '../agents/repository.ts';
import { AutopilotRepository } from '../autopilots/repository.ts';
import { fireAutopilot } from '../autopilots/fire.ts';
import { closeDatabase, openDatabase, type Sql } from '../db/pool.ts';
import { IssueRepository } from '../core/issues.ts';
import { unavailableSealer } from '../integrations/sealing.ts';
import { deleteWorkspaceAgents } from '../test-support/protected-agents.ts';
import { deleteWorkspaceBoards } from '../test-support/boards.ts';
import { ensureOrganizationAgents } from './provision.ts';
import { ensureDiscovery } from './discovery.ts';

const url = process.env.BERRY_TEST_DATABASE_URL;

describe('ensureDiscovery', { skip: url ? false : 'BERRY_TEST_DATABASE_URL is not set' }, () => {
   let sql: Sql;
   let workspaceId: string;
   let userId: string;
   let boardId: string;
   let issues: IssueRepository;
   let autopilots: AutopilotRepository;

   before(async () => {
      sql = openDatabase({ url: url! });
      const suffix = randomUUID().slice(0, 8);
      const [user] = await sql`
         INSERT INTO users (id, email, name) VALUES (${randomUUID()}, ${`disc-${suffix}@berry.test`}, 'Discovery test')
         RETURNING id`;
      userId = user!.id as string;
      const [workspace] = await sql`
         INSERT INTO workspaces (id, slug, name, created_by)
         VALUES (${randomUUID()}, ${`disc-${suffix}`}, 'Discovery org', ${userId})
         RETURNING id`;
      workspaceId = workspace!.id as string;
      await sql`INSERT INTO workspace_memberships (workspace_id, user_id, role) VALUES (${workspaceId}, ${userId}, 'owner')`;
      const [board] = await sql`SELECT id FROM boards WHERE workspace_id = ${workspaceId}`;
      boardId = board!.id as string;
      issues = new IssueRepository(sql);
      autopilots = new AutopilotRepository({ sql, sealer: unavailableSealer('test') });
      await ensureOrganizationAgents(sql, workspaceId);
   });

   after(async () => {
      if (!sql) return;
      await sql`DELETE FROM autopilot_runs WHERE workspace_id = ${workspaceId}`;
      await sql`DELETE FROM autopilot_triggers WHERE workspace_id = ${workspaceId}`;
      await sql`DELETE FROM autopilots WHERE workspace_id = ${workspaceId}`;
      await sql`DELETE FROM issues WHERE board_id = ${boardId}`;
      await deleteWorkspaceAgents(sql, [workspaceId]);
      await deleteWorkspaceBoards(sql, [workspaceId]);
      await sql`DELETE FROM workspaces WHERE id = ${workspaceId}`;
      await sql`DELETE FROM users WHERE id = ${userId}`;
      await closeDatabase(sql);
   });

   async function discoveryAutopilots() {
      return sql<Array<{ id: string; discovery_role: string; status: string; quota_period: string; quota_max: number }>>`
         SELECT id, discovery_role, status, quota_period, quota_max FROM autopilots
          WHERE workspace_id = ${workspaceId} AND discovery_role IS NOT NULL`;
   }

   test('every discovery role gets one active weekly autopilot with one enabled cron trigger', async () => {
      const result = await ensureDiscovery(sql, workspaceId, { autopilots, issues });
      assert.equal(result.created.length, 18, 'every role but the Orchestrator carries a discovery block');

      const rows = await discoveryAutopilots();
      assert.equal(rows.length, 18);
      for (const row of rows) {
         assert.equal(row.status, 'active');
         assert.equal(row.quota_period, 'week');
         assert.equal(row.quota_max, 1);
         const triggers = await sql<Array<{ enabled: boolean; kind: string }>>`
            SELECT enabled, kind FROM autopilot_triggers WHERE autopilot_id = ${row.id}`;
         assert.equal(triggers.length, 1);
         assert.equal(triggers[0]?.kind, 'cron');
         assert.equal(triggers[0]?.enabled, true);
      }
   });

   test('a second call creates nothing', async () => {
      const result = await ensureDiscovery(sql, workspaceId, { autopilots, issues });
      assert.deepEqual(result.created, []);
      const rows = await discoveryAutopilots();
      assert.equal(rows.length, 18);
   });

   test('discovery turned off for the workspace skips with DISCOVERY_OFF', async () => {
      await sql`UPDATE workspaces SET discovery_enabled = false WHERE id = ${workspaceId}`;
      const [row] = await discoveryAutopilots();
      const outcome = await fireAutopilot(
         {
            sql,
            issues,
            enqueue: async () => {
               throw new Error('should not enqueue while discovery is off');
            },
         },
         { autopilotId: row!.id, source: 'cron' }
      );
      assert.equal(outcome.status, 'skipped');
      assert.equal(outcome.reasonCode, 'DISCOVERY_OFF');
      await sql`UPDATE workspaces SET discovery_enabled = true WHERE id = ${workspaceId}`;
   });

   test('no repository and no other task skips with NOTHING_TO_INSPECT', async () => {
      // Only the discovery tasks themselves exist on this board, and no
      // project is linked to a repository, so there is nothing to inspect.
      const [row] = await discoveryAutopilots();
      const outcome = await fireAutopilot(
         {
            sql,
            issues,
            enqueue: async () => {
               throw new Error('should not enqueue with nothing to inspect');
            },
         },
         { autopilotId: row!.id, source: 'cron' }
      );
      assert.equal(outcome.status, 'skipped');
      assert.equal(outcome.reasonCode, 'NOTHING_TO_INSPECT');
   });

   test('archiving a role pauses its discovery; a re-run re-creates neither; restoring resumes it', async () => {
      const agents = new AgentRepository(sql);
      const [growth] = await sql<Array<{ id: string }>>`
         SELECT id FROM agents WHERE workspace_id = ${workspaceId} AND role_key = 'growth-engineer' AND archived_at IS NULL`;
      const growthId = growth!.id;
      const pilots = () => sql<Array<{ id: string; status: string; assignee_id: string }>>`
         SELECT id, status, assignee_id FROM autopilots
          WHERE workspace_id = ${workspaceId} AND discovery_role = 'growth-engineer' AND archived_at IS NULL`;

      await agents.archive(growthId, workspaceId, new Date());
      let found = await pilots();
      assert.equal(found.length, 1);
      assert.equal(found[0]!.status, 'paused', 'discovery stops with the agent');

      assert.deepEqual((await ensureOrganizationAgents(sql, workspaceId)).inserted, [], 'the role is not provisioned again');
      assert.deepEqual((await ensureDiscovery(sql, workspaceId, { autopilots, issues })).created, []);
      found = await pilots();
      assert.equal(found.length, 1, 'no second discovery for the removed role');
      assert.equal(found[0]!.assignee_id, growthId, 'and it is not handed to anyone else');
      assert.equal(found[0]!.status, 'paused');

      // A slot that passed while the role was removed.
      await sql`UPDATE autopilot_triggers SET next_fire_at = now() - interval '1 day' WHERE autopilot_id = ${found[0]!.id}`;
      await agents.restore(growthId, workspaceId);
      found = await pilots();
      assert.equal(found[0]!.status, 'active', 'restoring the role resumes its discovery');
      const [trigger] = await sql`SELECT next_fire_at > now() AS future FROM autopilot_triggers WHERE autopilot_id = ${found[0]!.id}`;
      assert.equal(trigger?.future, true, 'the schedule restarts from now, not from the missed slot');
      assert.deepEqual((await ensureDiscovery(sql, workspaceId, { autopilots, issues })).created, []);
   });

   describe('concurrency and orphan self-heal', () => {
      // A workspace of its own: these tests race `ensureDiscovery` against
      // itself and seed a deliberately half-finished autopilot, and must not
      // interact with the counts the tests above assert.
      let raceWorkspaceId: string;
      let raceBoardId: string;
      let raceUserId: string;

      before(async () => {
         const suffix = randomUUID().slice(0, 8);
         const [user] = await sql`
            INSERT INTO users (id, email, name) VALUES (${randomUUID()}, ${`disc-race-${suffix}@berry.test`}, 'Discovery race test')
            RETURNING id`;
         raceUserId = user!.id as string;
         const [workspace] = await sql`
            INSERT INTO workspaces (id, slug, name, created_by)
            VALUES (${randomUUID()}, ${`disc-race-${suffix}`}, 'Discovery race org', ${raceUserId})
            RETURNING id`;
         raceWorkspaceId = workspace!.id as string;
         await sql`INSERT INTO workspace_memberships (workspace_id, user_id, role) VALUES (${raceWorkspaceId}, ${raceUserId}, 'owner')`;
         const [board] = await sql`SELECT id FROM boards WHERE workspace_id = ${raceWorkspaceId}`;
         raceBoardId = board!.id as string;
         await ensureOrganizationAgents(sql, raceWorkspaceId);
      });

      after(async () => {
         await sql`DELETE FROM autopilot_runs WHERE workspace_id = ${raceWorkspaceId}`;
         await sql`DELETE FROM autopilot_triggers WHERE workspace_id = ${raceWorkspaceId}`;
         await sql`DELETE FROM autopilots WHERE workspace_id = ${raceWorkspaceId}`;
         await sql`DELETE FROM issues WHERE board_id = ${raceBoardId}`;
         await deleteWorkspaceAgents(sql, [raceWorkspaceId]);
         await deleteWorkspaceBoards(sql, [raceWorkspaceId]);
         await sql`DELETE FROM workspaces WHERE id = ${raceWorkspaceId}`;
         await sql`DELETE FROM users WHERE id = ${raceUserId}`;
      });

      test('two concurrent ensureDiscovery calls converge on one autopilot and one task per role', async () => {
         const [first, second] = await Promise.all([
            ensureDiscovery(sql, raceWorkspaceId, { autopilots, issues }),
            ensureDiscovery(sql, raceWorkspaceId, { autopilots, issues }),
         ]);
         assert.equal(first.created.length + second.created.length, 18, 'every role is accounted for exactly once between the two calls');

         const rows = await sql<Array<{ id: string; discovery_role: string; issue_id: string | null }>>`
            SELECT id, discovery_role, issue_id FROM autopilots
             WHERE workspace_id = ${raceWorkspaceId} AND archived_at IS NULL AND discovery_role IS NOT NULL`;
         assert.equal(rows.length, 18, 'exactly one live discovery autopilot per role');
         assert.equal(new Set(rows.map((row) => row.discovery_role)).size, 18, 'no role is duplicated');
         assert.ok(rows.every((row) => row.issue_id), 'every autopilot points at a task');
         assert.equal(new Set(rows.map((row) => row.issue_id)).size, 18, 'no two autopilots share a task');

         const [tasks] = await sql<Array<{ n: number }>>`
            SELECT count(*)::int AS n FROM issues
             WHERE board_id = ${raceBoardId} AND title LIKE 'Discovery: %' AND deleted_at IS NULL`;
         assert.equal(tasks?.n, 18, 'exactly one Discovery task per role, not one per call');
      });

      test('an orphaned autopilot (created but never marked) is adopted rather than duplicated', async () => {
         // A workspace of its own, untouched by the concurrency test above:
         // that test already resolves every role (including sre), so
         // simulating an orphan for a role that already has a live discovery
         // autopilot would not exercise the adoption path at all.
         const suffix = randomUUID().slice(0, 8);
         const [user] = await sql`
            INSERT INTO users (id, email, name) VALUES (${randomUUID()}, ${`disc-orphan-${suffix}@berry.test`}, 'Discovery orphan test')
            RETURNING id`;
         const orphanUserId = user!.id as string;
         const [workspace] = await sql`
            INSERT INTO workspaces (id, slug, name, created_by)
            VALUES (${randomUUID()}, ${`disc-orphan-${suffix}`}, 'Discovery orphan org', ${orphanUserId})
            RETURNING id`;
         const orphanWorkspaceId = workspace!.id as string;
         await sql`INSERT INTO workspace_memberships (workspace_id, user_id, role) VALUES (${orphanWorkspaceId}, ${orphanUserId}, 'owner')`;
         const [board] = await sql`SELECT id FROM boards WHERE workspace_id = ${orphanWorkspaceId}`;
         const orphanBoardId = board!.id as string;
         await ensureOrganizationAgents(sql, orphanWorkspaceId);

         try {
            const [agent] = await sql<Array<{ id: string; name: string }>>`
               SELECT id, name FROM agents WHERE workspace_id = ${orphanWorkspaceId} AND role_key = 'sre'`;
            assert.ok(agent, 'the sre role agent exists');
            const { issue } = await issues.create({
               boardId: orphanBoardId,
               title: `Discovery: ${agent!.name}`,
               description: 'Orphaned by a simulated crash between creating the autopilot and marking it.',
               status: 'backlog',
               priority: 'none',
               sortOrder: 0,
               dueDate: null,
               assignee: { type: 'agent', id: agent!.id },
               project: null,
               createdBy: orphanUserId,
            });
            const orphan = await autopilots.create(
               orphanWorkspaceId,
               {
                  name: `Discovery: ${agent!.name}`,
                  description: 'Weekly inspection by the sre, half-finished.',
                  assigneeType: 'agent',
                  assigneeId: agent!.id,
                  promptTemplate: 'Inspect.',
                  executionMode: 'fixed_issue',
                  boardId: null,
                  issueId: issue.id,
                  quotaPeriod: 'week',
                  quotaMax: 1,
               },
               orphanUserId
            );
            // discovery_role deliberately left NULL, and no cron trigger: this
            // is exactly where a crash between `autopilots.create` and the
            // `discovery_role` write (or between that and `addCronTrigger`)
            // would leave things.

            const result = await ensureDiscovery(sql, orphanWorkspaceId, { autopilots, issues });
            assert.ok(result.created.includes('sre'), 'sre is reported as handled');

            const rows = await sql<Array<{ id: string }>>`
               SELECT id FROM autopilots
                WHERE workspace_id = ${orphanWorkspaceId} AND archived_at IS NULL AND discovery_role = 'sre'`;
            assert.equal(rows.length, 1, 'no second autopilot was created for sre');
            assert.equal(rows[0]!.id, orphan.id, 'the orphan itself was adopted');

            const triggers = await sql<Array<{ enabled: boolean; kind: string }>>`
               SELECT enabled, kind FROM autopilot_triggers WHERE autopilot_id = ${orphan.id}`;
            assert.equal(triggers.length, 1);
            assert.equal(triggers[0]?.kind, 'cron');
            assert.equal(triggers[0]?.enabled, true);
         } finally {
            await sql`DELETE FROM autopilot_runs WHERE workspace_id = ${orphanWorkspaceId}`;
            await sql`DELETE FROM autopilot_triggers WHERE workspace_id = ${orphanWorkspaceId}`;
            await sql`DELETE FROM autopilots WHERE workspace_id = ${orphanWorkspaceId}`;
            await sql`DELETE FROM issues WHERE board_id = ${orphanBoardId}`;
            await deleteWorkspaceAgents(sql, [orphanWorkspaceId]);
            await deleteWorkspaceBoards(sql, [orphanWorkspaceId]);
            await sql`DELETE FROM workspaces WHERE id = ${orphanWorkspaceId}`;
            await sql`DELETE FROM users WHERE id = ${orphanUserId}`;
         }
      });
   });
});
