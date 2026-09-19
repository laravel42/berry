import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { closeDatabase, openDatabase, type Sql } from '../db/pool.ts';
import { ProjectRepository } from './projects.ts';
import { deleteWorkspaceAgents } from '../test-support/protected-agents.ts';

/**
 * Project updates against a real PostgreSQL.
 *
 * Worth a database because the create path has to keep two rows in step: the
 * update itself and the project's health. A fake sql would not catch a write
 * that updated one and rolled back the other.
 */

const url = process.env.BERRY_TEST_DATABASE_URL;

describe('project updates', { skip: url ? false : 'BERRY_TEST_DATABASE_URL is not set' }, () => {
   let sql: Sql;
   let projects: ProjectRepository;
   const fixture = { workspaceId: '', userId: '', projectId: '' };

   before(async () => {
      sql = openDatabase({ url: url! });
      projects = new ProjectRepository(sql);
      const suffix = randomUUID().slice(0, 8);
      const [user] = await sql`
         INSERT INTO users (id, email, name, avatar_url)
         VALUES (${randomUUID()}, ${`update-${suffix}@berry.test`}, 'Update Author',
                 'https://example.test/a.png')
         RETURNING id`;
      fixture.userId = user!.id as string;
      const [workspace] = await sql`
         INSERT INTO workspaces (id, name, slug, settings, created_by)
         VALUES (${randomUUID()}, ${`Updates ${suffix}`}, ${`updates-${suffix}`},
                 ${sql.json({ issuePrefix: 'UPD', defaultRole: 'member', allowMemberInvites: false } as never)},
                 ${fixture.userId})
         RETURNING id`;
      fixture.workspaceId = workspace!.id as string;
      await sql`
         INSERT INTO workspace_memberships (workspace_id, user_id, role)
         VALUES (${fixture.workspaceId}, ${fixture.userId}, 'owner')`;
      const project = await projects.create({
         workspaceId: fixture.workspaceId,
         name: 'Tracked',
         description: null,
         status: 'active',
         priority: 'none',
         startDate: null,
         targetDate: null,
         githubRepoId: null,
         githubRepoFullName: null,
         createdBy: fixture.userId,
      });
      fixture.projectId = project.id;
   });

   after(async () => {
      if (fixture.workspaceId) {
         await sql`DELETE FROM project_updates WHERE workspace_id = ${fixture.workspaceId}`;
         await sql`DELETE FROM projects WHERE workspace_id = ${fixture.workspaceId}`;
         await deleteWorkspaceAgents(sql, [fixture.workspaceId]);
         await sql`DELETE FROM boards WHERE workspace_id = ${fixture.workspaceId}`;
         await sql`DELETE FROM workspace_memberships WHERE workspace_id = ${fixture.workspaceId}`;
         await sql`DELETE FROM workspaces WHERE id = ${fixture.workspaceId}`;
      }
      if (fixture.userId) await sql`DELETE FROM users WHERE id = ${fixture.userId}`;
      await closeDatabase(sql);
   });

   test('createUpdate stores the body and moves project health with it', async () => {
      const created = await projects.createUpdate({
         workspaceId: fixture.workspaceId,
         projectId: fixture.projectId,
         authorId: fixture.userId,
         body: 'Shipped the first cut.',
         health: 'on_track',
      });

      assert.equal(created.body, 'Shipped the first cut.');
      assert.equal(created.health, 'on_track');
      assert.equal(created.author.id, fixture.userId);
      assert.equal(created.author.name, 'Update Author');
      assert.equal(created.author.avatarUrl, 'https://example.test/a.png');

      const project = await projects.get(fixture.workspaceId, fixture.projectId);
      assert.equal(project.health, 'on_track');

      const listed = await projects.listUpdates(fixture.workspaceId, fixture.projectId, null, 10);
      assert.equal(listed.length, 1);
      assert.equal(listed[0]?.id, created.id);
   });

   test('listUpdates returns newest first', async () => {
      const older = await projects.createUpdate({
         workspaceId: fixture.workspaceId,
         projectId: fixture.projectId,
         authorId: fixture.userId,
         body: 'Older note',
         health: 'at_risk',
      });
      // Distinct timestamps so the order is not id-order alone.
      await new Promise((resolve) => setTimeout(resolve, 5));
      const newer = await projects.createUpdate({
         workspaceId: fixture.workspaceId,
         projectId: fixture.projectId,
         authorId: fixture.userId,
         body: 'Newer note',
         health: 'off_track',
      });

      const listed = await projects.listUpdates(fixture.workspaceId, fixture.projectId, null, 10);
      assert.ok(listed.length >= 2);
      assert.equal(listed[0]?.id, newer.id);
      assert.ok(listed.some((entry) => entry.id === older.id));

      const project = await projects.get(fixture.workspaceId, fixture.projectId);
      assert.equal(project.health, 'off_track');
   });
});
