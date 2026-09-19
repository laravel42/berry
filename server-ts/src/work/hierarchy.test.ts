import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { closeDatabase, openDatabase, type Sql } from '../db/pool.ts';
import { cleanupWorld, createIssue, seedWorld, type World } from './fixture.ts';
import {
   HierarchyCycle,
   ParentNotFound,
   blockedByEarlierStage,
   childIssueIds,
   nextStageReady,
   setParent,
} from './hierarchy.ts';

const url = process.env.BERRY_TEST_DATABASE_URL;

describe('hierarchy', { skip: url ? false : 'BERRY_TEST_DATABASE_URL is not set' }, () => {
   let sql: Sql;
   let world: World;
   let other: World;
   before(async () => {
      sql = openDatabase({ url: url as string });
      world = await seedWorld(sql, 'tree');
      other = await seedWorld(sql, 'tree-other');
   });
   after(async () => {
      await cleanupWorld(sql, world);
      await cleanupWorld(sql, other);
      await closeDatabase(sql);
   });

   test('an issue cannot become a descendant of itself', async () => {
      const child = await createIssue(sql, world);
      await setParent(sql, { workspaceId: world.workspaceId, issueId: child, parentId: world.issueId, stage: null });
      await assert.rejects(
         setParent(sql, { workspaceId: world.workspaceId, issueId: world.issueId, parentId: child, stage: null }),
         HierarchyCycle
      );
   });

   test('a parent from another workspace is not found', async () => {
      const child = await createIssue(sql, world);
      await assert.rejects(
         setParent(sql, { workspaceId: world.workspaceId, issueId: child, parentId: other.issueId, stage: null }),
         ParentNotFound
      );
   });

   test('a task with no project takes its nearest ancestor’s when it gets a parent, and keeps one it has', async () => {
      const [project] = await sql`INSERT INTO projects (workspace_id, name) VALUES (${world.workspaceId}, 'Tree') RETURNING id`;
      const [elsewhere] = await sql`INSERT INTO projects (workspace_id, name) VALUES (${world.workspaceId}, 'Elsewhere') RETURNING id`;
      const link = (issueId: string, projectId: string) =>
         sql`INSERT INTO issue_project_links (workspace_id, issue_id, project_id) VALUES (${world.workspaceId}, ${issueId}, ${projectId})`;
      const projectOf = async (issueId: string) => (await sql`SELECT project_id FROM issue_project_links WHERE issue_id = ${issueId}`)[0]?.project_id ?? null;

      const root = await createIssue(sql, world, { title: 'Linked root' });
      await link(root, project!.id as string);
      // A decision filed under it has no project of its own, and neither does what is filed under that.
      const decision = await createIssue(sql, world);
      const followUp = await createIssue(sql, world);
      await setParent(sql, { workspaceId: world.workspaceId, issueId: decision, parentId: root, stage: null });
      await sql`DELETE FROM issue_project_links WHERE issue_id = ${decision}`;
      await setParent(sql, { workspaceId: world.workspaceId, issueId: followUp, parentId: decision, stage: null });
      assert.equal(await projectOf(followUp), project!.id, 'reaches past an unlinked parent to the nearest linked ancestor');

      const own = await createIssue(sql, world);
      await link(own, elsewhere!.id as string);
      await setParent(sql, { workspaceId: world.workspaceId, issueId: own, parentId: root, stage: null });
      assert.equal(await projectOf(own), elsewhere!.id, 'a project the task already has is left alone');
   });

   test('stage two waits for stage one, then is released as a group', async () => {
      const parent = await createIssue(sql, world, { title: 'Staged' });
      const a1 = await createIssue(sql, world, { parentId: parent, stage: 1, status: 'todo' });
      const a2 = await createIssue(sql, world, { parentId: parent, stage: 1, status: 'todo' });
      const b1 = await createIssue(sql, world, { parentId: parent, stage: 2, status: 'todo' });
      const c1 = await createIssue(sql, world, { parentId: parent, stage: 3, status: 'todo' });

      assert.equal((await childIssueIds(sql, parent)).length, 4);
      assert.equal(await blockedByEarlierStage(sql, b1), true);
      assert.equal(await blockedByEarlierStage(sql, a1), false);

      await sql`UPDATE issues SET status = 'done' WHERE id = ${a1}`;
      assert.deepEqual(await nextStageReady(sql, a1), []);
      await sql`UPDATE issues SET status = 'cancelled' WHERE id = ${a2}`;
      assert.deepEqual(await nextStageReady(sql, a2), [b1]);
      assert.equal(await blockedByEarlierStage(sql, b1), false);
      assert.equal(await blockedByEarlierStage(sql, c1), true);
   });
});
