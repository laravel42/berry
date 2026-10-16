import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { closeDatabase, openDatabase, type Sql } from '../db/pool.ts';
import { ProjectRepository } from './projects.ts';
import { deleteWorkspaceAgents } from '../test-support/protected-agents.ts';

/**
 * A project write that does not record an outbox row never reaches the
 * Projects page: that store is a session snapshot plus the workspace stream.
 */

const url = process.env.BERRY_TEST_DATABASE_URL;

describe('project events', { skip: url ? false : 'BERRY_TEST_DATABASE_URL is not set' }, () => {
   let sql: Sql;
   let projects: ProjectRepository;
   const fixture = { workspaceId: '', userId: '' };

   before(async () => {
      sql = openDatabase({ url: url! });
      projects = new ProjectRepository(sql);
      const suffix = randomUUID().slice(0, 8);
      const [user] = await sql`
         INSERT INTO users (id, email, name)
         VALUES (${randomUUID()}, ${`proj-evt-${suffix}@berry.test`}, 'Project Events') RETURNING id`;
      fixture.userId = user!.id as string;
      const [workspace] = await sql`
         INSERT INTO workspaces (id, name, slug, settings, created_by)
         VALUES (${randomUUID()}, ${`Events ${suffix}`}, ${`events-${suffix}`},
                 ${sql.json({ issuePrefix: 'EVT', defaultRole: 'member', allowMemberInvites: false } as never)},
                 ${fixture.userId})
         RETURNING id`;
      fixture.workspaceId = workspace!.id as string;
      await sql`
         INSERT INTO workspace_memberships (workspace_id, user_id, role)
         VALUES (${fixture.workspaceId}, ${fixture.userId}, 'owner')`;
   });

   after(async () => {
      if (fixture.workspaceId) {
         await sql`DELETE FROM outbox_events WHERE workspace_id = ${fixture.workspaceId}`;
         await sql`DELETE FROM projects WHERE workspace_id = ${fixture.workspaceId}`;
         await deleteWorkspaceAgents(sql, [fixture.workspaceId]);
         await sql`DELETE FROM boards WHERE workspace_id = ${fixture.workspaceId}`;
         await sql`DELETE FROM workspace_memberships WHERE workspace_id = ${fixture.workspaceId}`;
         await sql`DELETE FROM workspaces WHERE id = ${fixture.workspaceId}`;
      }
      if (fixture.userId) await sql`DELETE FROM users WHERE id = ${fixture.userId}`;
      await closeDatabase(sql);
   });

   const make = (name: string) =>
      projects.create({
         workspaceId: fixture.workspaceId,
         name,
         description: null,
         status: 'planned',
         priority: 'none',
         startDate: null,
         targetDate: null,
         githubRepoId: null,
         githubRepoFullName: null,
         createdBy: fixture.userId,
      });

   test('creating a project writes project.created on the workspace stream', async () => {
      const created = await make('Test Project');
      const [row] = await sql`
         SELECT topic, aggregate_type, board_id
           FROM outbox_events
          WHERE aggregate_id = ${created.id} AND topic = 'project.created'`;
      assert.equal(row?.topic, 'project.created');
      assert.equal(row?.aggregate_type, 'project');
      assert.equal(row?.board_id, null);
   });

   test('updating a project writes project.updated', async () => {
      const created = await make('Rename me');
      await projects.update(fixture.workspaceId, created.id, {
         name: 'Renamed',
         descriptionSet: false,
         startDateSet: false,
         targetDateSet: false,
         githubRepoSet: false,
         leadSet: false,
      });
      const [row] = await sql`
         SELECT topic FROM outbox_events
          WHERE aggregate_id = ${created.id} AND topic = 'project.updated'`;
      assert.equal(row?.topic, 'project.updated');
   });

   test('archiving a project writes project.archived', async () => {
      const created = await make('Done with this');
      await projects.archive(fixture.workspaceId, created.id);
      const [row] = await sql`
         SELECT topic FROM outbox_events
          WHERE aggregate_id = ${created.id} AND topic = 'project.archived'`;
      assert.equal(row?.topic, 'project.archived');
   });
});
