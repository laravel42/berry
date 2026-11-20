import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { closeDatabase, openDatabase, type Sql } from '../db/pool.ts';
import { cleanupWorld, seedWorld, type World } from '../work/fixture.ts';
import { IssueRepository } from './issues.ts';
import { ProjectRepository } from './projects.ts';

const url = process.env.BERRY_TEST_DATABASE_URL;

/**
 * A task's project is what gives it a repository, so a task filed with none is
 * one an agent cannot work. Most callers that create tasks do not name one.
 */
describe('a task created with no project', { skip: url ? false : 'BERRY_TEST_DATABASE_URL is not set' }, () => {
   let sql: Sql;
   let world: World;
   before(async () => {
      sql = openDatabase({ url: url as string });
      world = await seedWorld(sql, 'project-default');
   });
   after(async () => {
      await sql`DELETE FROM projects WHERE workspace_id = ${world.workspaceId}`;
      await cleanupWorld(sql, world);
      await closeDatabase(sql);
   });

   const create = (title: string) =>
      new IssueRepository(sql).create({ boardId: world.boardId, title, description: null, status: 'todo', priority: 'none', sortOrder: 0, dueDate: null, assignee: null, project: null, createdBy: world.ownerId });

   test('has none while the workspace has no project, is the sole project’s when there is one, and is not guessed when there are two', async () => {
      assert.equal((await create('before any project')).issue.project, null);

      const [only] = await sql`INSERT INTO projects (workspace_id, name) VALUES (${world.workspaceId}, 'Only') RETURNING id`;
      assert.equal((await create('one project')).issue.project?.id, only!.id);

      await sql`INSERT INTO projects (workspace_id, name) VALUES (${world.workspaceId}, 'Second')`;
      assert.equal((await create('two projects')).issue.project, null);
   });
});

/**
 * Deleting a project deletes its work: the tasks filed under it and the
 * sub-tasks beneath them, their inbox rows, and the approvals that would put
 * those rows back. A sub-task filed under another project is that project's.
 */
describe('deleting a project', { skip: url ? false : 'BERRY_TEST_DATABASE_URL is not set' }, () => {
   let sql: Sql;
   let world: World;
   before(async () => {
      sql = openDatabase({ url: url as string });
      world = await seedWorld(sql, 'project-delete');
   });
   after(async () => {
      await sql`DELETE FROM inbox_items WHERE workspace_id = ${world.workspaceId}`;
      await sql`DELETE FROM approvals WHERE workspace_id = ${world.workspaceId}`;
      await sql`DELETE FROM outbox_events WHERE workspace_id = ${world.workspaceId}`;
      await sql`DELETE FROM projects WHERE workspace_id = ${world.workspaceId}`;
      await cleanupWorld(sql, world);
      await closeDatabase(sql);
   });

   test('removes its tasks, their sub-tasks, inbox rows and pending approvals, and nothing of another project', async () => {
      const issues = new IssueRepository(sql);
      const projects = new ProjectRepository(sql);
      const [doomed] = await sql`INSERT INTO projects (workspace_id, name) VALUES (${world.workspaceId}, 'Doomed') RETURNING id`;
      const [kept] = await sql`INSERT INTO projects (workspace_id, name) VALUES (${world.workspaceId}, 'Kept') RETURNING id`;
      const create = async (title: string, project: string | null, parentId: string | null = null) => {
         const { issue } = await issues.create({ boardId: world.boardId, title, description: null, status: 'todo', priority: 'none', sortOrder: 0, dueDate: null, assignee: null, project, createdBy: world.ownerId });
         if (parentId) await sql`UPDATE issues SET parent_id = ${parentId} WHERE id = ${issue.id}`;
         return issue.id;
      };
      const task = await create('in the doomed project', doomed!.id as string);
      const child = await create('sub-task with no project', null, task);
      const elsewhere = await create('sub-task filed elsewhere', kept!.id as string, task);
      const other = await create('in the kept project', kept!.id as string);

      for (const issueId of [task, child, other]) {
         await sql`
            INSERT INTO inbox_items (workspace_id, recipient_id, event_type, category, title, issue_id)
            VALUES (${world.workspaceId}, ${world.ownerId}, 'issue.assigned', 'assignments', 'Assigned', ${issueId})`;
      }
      const [approval] = await sql`
         INSERT INTO approvals (workspace_id, kind, title, issue_id, requested_from_role)
         VALUES (${world.workspaceId}, 'issue_start', 'Start it?', ${task}, 'member') RETURNING id`;

      await projects.archive(world.workspaceId, doomed!.id as string, async (tx, now) => {
         await issues.removeProjectWork(tx, { workspaceId: world.workspaceId, projectId: doomed!.id as string, deletedBy: world.ownerId, now });
      });

      const live = await sql`
         SELECT id FROM issues
          WHERE id = ANY(${[task, child, elsewhere, other]}::uuid[]) AND deleted_at IS NULL`;
      assert.deepEqual(new Set(live.map((row) => row.id as string)), new Set([elsewhere, other]));

      const inbox = await sql`SELECT issue_id FROM inbox_items WHERE workspace_id = ${world.workspaceId}`;
      assert.deepEqual(inbox.map((row) => row.issue_id as string), [other]);

      const [state] = await sql`SELECT status, resolved_at FROM approvals WHERE id = ${approval!.id}`;
      assert.equal(state?.status, 'expired');
      assert.notEqual(state?.resolved_at, null);

      const deleted = await sql`
         SELECT aggregate_id FROM outbox_events
          WHERE workspace_id = ${world.workspaceId} AND topic = 'issue.deleted'`;
      assert.deepEqual(new Set(deleted.map((row) => row.aggregate_id as string)), new Set([task, child]));
   });
});
