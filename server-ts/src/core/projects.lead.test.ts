import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { closeDatabase, openDatabase, type Sql } from '../db/pool.ts';
import { ProjectRepository, type ProjectLead, type ProjectPatch } from './projects.ts';
import { deleteWorkspaceAgents } from '../test-support/protected-agents.ts';

/**
 * Who leads a project, against a real PostgreSQL.
 *
 * Worth a database rather than a stub, because the part that used to be wrong is
 * the part only PostgreSQL can answer: the lead was never stored at all, and the
 * two columns that hold it are governed by a check constraint the repository has
 * to keep satisfied on every write. A test with a fake `sql` would agree with
 * whatever the repository sent.
 */

const url = process.env.BERRY_TEST_DATABASE_URL;

/** A patch with only the lead set, since every other field is a "leave alone". */
const leadPatch = (lead: ProjectLead | null): ProjectPatch => ({
   descriptionSet: false,
   startDateSet: false,
   targetDateSet: false,
   githubRepoSet: false,
   leadSet: true,
   lead,
});

describe('project lead', { skip: url ? false : 'BERRY_TEST_DATABASE_URL is not set' }, () => {
   let sql: Sql;
   let projects: ProjectRepository;
   const fixture = { workspaceId: '', userId: '' };

   before(async () => {
      sql = openDatabase({ url: url! });
      projects = new ProjectRepository(sql);
      const suffix = randomUUID().slice(0, 8);
      const [user] = await sql`
         INSERT INTO users (id, email, name)
         VALUES (${randomUUID()}, ${`lead-${suffix}@berry.test`}, 'Lead Owner') RETURNING id`;
      fixture.userId = user!.id as string;
      const [workspace] = await sql`
         INSERT INTO workspaces (id, name, slug, settings, created_by)
         VALUES (${randomUUID()}, ${`Leads ${suffix}`}, ${`leads-${suffix}`},
                 ${sql.json({ issuePrefix: 'LED', defaultRole: 'member', allowMemberInvites: false } as never)},
                 ${fixture.userId})
         RETURNING id`;
      fixture.workspaceId = workspace!.id as string;
      await sql`
         INSERT INTO workspace_memberships (workspace_id, user_id, role)
         VALUES (${fixture.workspaceId}, ${fixture.userId}, 'owner')`;
   });

   after(async () => {
      if (fixture.workspaceId) {
         await sql`DELETE FROM projects WHERE workspace_id = ${fixture.workspaceId}`;
         await deleteWorkspaceAgents(sql, [fixture.workspaceId]);
         await sql`DELETE FROM boards WHERE workspace_id = ${fixture.workspaceId}`;
         await sql`DELETE FROM workspace_memberships WHERE workspace_id = ${fixture.workspaceId}`;
         await sql`DELETE FROM workspaces WHERE id = ${fixture.workspaceId}`;
      }
      if (fixture.userId) await sql`DELETE FROM users WHERE id = ${fixture.userId}`;
      await closeDatabase(sql);
   });

   const make = (name: string, lead?: ProjectLead | null) =>
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
         ...(lead === undefined ? {} : { lead }),
      });

   test('the AI workflow is stored and read back as itself', async () => {
      const created = await make('Berry leads this', { type: 'aiWorkflow' });
      assert.deepEqual(created.lead, { type: 'aiWorkflow' });
      // Read again rather than trusting the RETURNING row: a column the reading
      // query forgets to select is exactly the bug this is here to catch.
      const found = await projects.get(fixture.workspaceId, created.id);
      assert.deepEqual(found.lead, { type: 'aiWorkflow' });
   });

   test('a person is stored with their id', async () => {
      const created = await make('A person leads this', {
         type: 'user',
         userId: fixture.userId,
      });
      assert.deepEqual(created.lead, { type: 'user', userId: fixture.userId });
      const found = await projects.get(fixture.workspaceId, created.id);
      assert.deepEqual(found.lead, { type: 'user', userId: fixture.userId });
   });

   test('no lead is null, not the creator', async () => {
      const created = await make('Nobody leads this');
      // The distinction the API exists to keep: "nobody decided" is not "the
      // person who made it". A client that cannot tell them apart is how the AI
      // workflow used to read back as the reader.
      assert.equal(created.lead, null);
      assert.equal((await projects.get(fixture.workspaceId, created.id)).lead, null);
   });

   test('the lead is listed, so a board does not have to fetch each project', async () => {
      const created = await make('Listed', { type: 'aiWorkflow' });
      const rows = await projects.list(
         fixture.workspaceId,
         { query: 'Listed', status: null, priority: null },
         null,
         10
      );
      assert.deepEqual(
         rows.find((row) => row.id === created.id)?.lead,
         { type: 'aiWorkflow' },
         'list must carry the lead'
      );
   });

   test('a patch moves the pair through every legal state', async () => {
      const created = await make('Handed over', { type: 'aiWorkflow' });

      const toPerson = await projects.update(
         fixture.workspaceId,
         created.id,
         leadPatch({ type: 'user', userId: fixture.userId })
      );
      assert.deepEqual(toPerson.lead, { type: 'user', userId: fixture.userId });

      const backToBerry = await projects.update(
         fixture.workspaceId,
         created.id,
         leadPatch({ type: 'aiWorkflow' })
      );
      assert.deepEqual(backToBerry.lead, { type: 'aiWorkflow' }, 'the user id must be cleared too');

      const cleared = await projects.update(fixture.workspaceId, created.id, leadPatch(null));
      assert.equal(cleared.lead, null);
   });

   test('a patch that does not mention the lead leaves it alone', async () => {
      const created = await make('Renamed', { type: 'aiWorkflow' });
      const renamed = await projects.update(fixture.workspaceId, created.id, {
         name: 'Renamed twice',
         descriptionSet: false,
         startDateSet: false,
         targetDateSet: false,
         githubRepoSet: false,
         leadSet: false,
      });
      assert.equal(renamed.name, 'Renamed twice');
      assert.deepEqual(renamed.lead, { type: 'aiWorkflow' });
   });

   test('deleting the account releases the project instead of refusing', async () => {
      const suffix = randomUUID().slice(0, 8);
      const [leaver] = await sql`
         INSERT INTO users (id, email, name)
         VALUES (${randomUUID()}, ${`leaver-${suffix}@berry.test`}, 'Leaver') RETURNING id`;
      const leaverId = leaver!.id as string;
      const created = await make('Led by someone leaving', { type: 'user', userId: leaverId });

      // The foreign key nulls the id, and `projects_lead_ck` would then refuse
      // the row for claiming a user lead with nobody in it — so the pair has to
      // be released before the key acts. If that ever regresses, this DELETE
      // throws rather than this assertion failing.
      await sql`DELETE FROM users WHERE id = ${leaverId}`;

      assert.equal((await projects.get(fixture.workspaceId, created.id)).lead, null);
   });
});
