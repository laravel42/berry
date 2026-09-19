import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { closeDatabase, openDatabase, type Sql } from '../db/pool.ts';
import { cleanupWorld, seedWorld, type World } from '../work/fixture.ts';
import { IssueRepository } from './issues.ts';

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
