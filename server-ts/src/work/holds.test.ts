import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { closeDatabase, openDatabase, type Sql } from '../db/pool.ts';
import { cleanupWorld, createIssue, seedWorld, type World } from './fixture.ts';
import { issueHasOpenHold } from './holds.ts';

const url = process.env.BERRY_TEST_DATABASE_URL;

describe('holds', { skip: url ? false : 'BERRY_TEST_DATABASE_URL is not set' }, () => {
   let sql: Sql;
   let world: World;
   before(async () => {
      sql = openDatabase({ url: url as string });
      world = await seedWorld(sql, 'hold');
   });
   after(async () => {
      await cleanupWorld(sql, world);
      await closeDatabase(sql);
   });

   test('a task with nothing waiting is not held', async () => {
      const issueId = await createIssue(sql, world, { title: 'Alone' });
      assert.equal(await issueHasOpenHold(sql, issueId), false);
   });

   test('an unfinished dependency is a hold; a finished one is not', async () => {
      const issueId = await createIssue(sql, world, { title: 'Waiting' });
      const blocker = await createIssue(sql, world, { title: 'Not done', status: 'todo' });
      await sql`
         INSERT INTO issue_dependencies (workspace_id, issue_id, depends_on_issue_id)
         VALUES (${world.workspaceId}, ${issueId}, ${blocker})`;
      assert.equal(await issueHasOpenHold(sql, issueId), true);
      await sql`UPDATE issues SET status = 'done' WHERE id = ${blocker}`;
      assert.equal(await issueHasOpenHold(sql, issueId), false);
   });

   test('a pending escalation is a hold', async () => {
      const issueId = await createIssue(sql, world, { title: 'Asked' });
      await sql`
         INSERT INTO approvals (id, workspace_id, kind, risk, title, description, issue_id,
                                requested_from_role, requested_by_type, requested_by, status)
         VALUES (${randomUUID()}, ${world.workspaceId}, 'escalation', 'medium', 'Decision', 'Which way?',
                 ${issueId}, 'admin', 'user', ${world.ownerId}, 'pending')`;
      assert.equal(await issueHasOpenHold(sql, issueId), true);
   });

   test('an open child is a hold; finishing it releases', async () => {
      const parent = await createIssue(sql, world, { title: 'Parent' });
      const child = await createIssue(sql, world, { title: 'Decision', parentId: parent, status: 'todo' });
      assert.equal(await issueHasOpenHold(sql, parent), true);
      await sql`UPDATE issues SET status = 'done' WHERE id = ${child}`;
      assert.equal(await issueHasOpenHold(sql, parent), false);
   });
});
