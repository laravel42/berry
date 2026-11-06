import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { closeDatabase, openDatabase, type Sql } from '../db/pool.ts';
import {
   MilestoneRepository,
   InvalidMilestoneTransition,
   canTransition,
   progressPercent,
   type MilestoneStatus,
} from './milestones.ts';
import { Forbidden, NotFound } from '../identity/errors.ts';
import { deleteWorkspaceBoards } from '../test-support/boards.ts';
import { deleteWorkspaceAgents } from '../test-support/protected-agents.ts';

/**
 * Milestones against a real PostgreSQL. Stages belong to a project; progress
 * percent and sort order are the product contract. Coarse status remains for
 * SCM mapping and lifecycle transitions.
 */

const url = process.env.BERRY_TEST_DATABASE_URL;

test('progress percent weights finished tasks fully and working tasks halfway', () => {
   assert.equal(
      progressPercent({ issuesTotal: 0, issuesDone: 0, issuesCancelled: 0, issuesWorking: 0 }),
      0
   );
   assert.equal(
      progressPercent({ issuesTotal: 4, issuesDone: 2, issuesCancelled: 0, issuesWorking: 2 }),
      75
   );
   assert.equal(
      progressPercent({ issuesTotal: 2, issuesDone: 1, issuesCancelled: 1, issuesWorking: 0 }),
      100
   );
});

test('the lifecycle is draft → planned → active ⇄ blocked → terminal', () => {
   assert.ok(canTransition('draft', 'planned'));
   assert.ok(canTransition('draft', 'active'));
   assert.ok(canTransition('planned', 'active'));
   assert.ok(canTransition('active', 'blocked'));
   assert.ok(canTransition('blocked', 'active'));
   assert.ok(canTransition('active', 'completed'));

   for (const to of ['draft', 'planned', 'active', 'blocked'] as MilestoneStatus[]) {
      assert.ok(!canTransition('completed', to), `completed → ${to}`);
      assert.ok(!canTransition('cancelled', to), `cancelled → ${to}`);
   }
   assert.ok(!canTransition('active', 'planned'));
   assert.ok(!canTransition('planned', 'draft'));
});

describe('milestones', { skip: url ? false : 'BERRY_TEST_DATABASE_URL is not set' }, () => {
   let sql: Sql;
   let milestones: MilestoneRepository;
   const fixture = { workspaceId: '', boardId: '', userId: '', otherId: '', projectId: '' };

   before(async () => {
      sql = openDatabase({ url: url! });
      milestones = new MilestoneRepository(sql);
      await seed(sql, fixture);
   });

   after(async () => {
      await cleanup(sql, fixture);
      await closeDatabase(sql);
   });

   const now = () => new Date().toISOString();
   const make = (title: string, projectId = fixture.projectId) =>
      milestones.create({
         workspaceId: fixture.workspaceId,
         title,
         projectId,
         createdBy: fixture.userId,
         createdAt: now(),
      });

   test('a milestone starts planned on a project with the next sort order', async () => {
      const { goal, event } = await make('Ship the thing');
      assert.equal(goal.status, 'planned');
      assert.equal(goal.projectId, fixture.projectId);
      assert.equal(goal.source, 'manual');
      assert.equal(goal.startedAt, null);
      assert.equal(goal.completedAt, null);
      assert.ok(goal.sortOrder >= 1);
      assert.equal(event.type, 'milestone.created');

      assert.deepEqual(await milestones.get(goal.id), goal);
   });

   test('reorder assigns 1..n inside the project', async () => {
      const [project] = await sql`
         INSERT INTO projects (workspace_id, name, created_by)
         VALUES (${fixture.workspaceId}, 'Reorder', ${fixture.userId})
         RETURNING id`;
      const projectId = project!.id as string;
      const first = await make('First', projectId);
      const second = await make('Second', projectId);
      const third = await make('Third', projectId);
      await milestones.reorder(
         fixture.workspaceId,
         projectId,
         [third.goal.id, first.goal.id, second.goal.id],
         fixture.userId,
         now()
      );
      const listed = await milestones.list(
         fixture.workspaceId,
         { query: '', status: null, projectId },
         null,
         100
      );
      assert.deepEqual(
         listed.map((row) => row.title),
         ['Third', 'First', 'Second']
      );
      assert.deepEqual(
         listed.map((row) => row.sortOrder),
         [1, 2, 3]
      );
   });

   test('starting stamps startedAt, and returning from blocked does not restart it', async () => {
      const { goal } = await make('Lifecycle');
      const started = await milestones.transition(goal.id, 'active', fixture.userId, now());
      assert.equal(started.event!.type, 'milestone.started');
      assert.notEqual(started.goal.startedAt, null);

      const blocked = await milestones.transition(goal.id, 'blocked', fixture.userId, now());
      assert.equal(blocked.event!.type, 'milestone.updated');
      assert.equal(blocked.goal.startedAt, started.goal.startedAt);

      const resumed = await milestones.transition(goal.id, 'active', fixture.userId, now());
      assert.equal(resumed.event!.type, 'milestone.updated');
      assert.equal(resumed.goal.startedAt, started.goal.startedAt);
   });

   test('completing stamps completedAt and cancelling clears it', async () => {
      const finished = await make('Finish');
      await milestones.transition(finished.goal.id, 'active', fixture.userId, now());
      const done = await milestones.transition(finished.goal.id, 'completed', fixture.userId, now());
      assert.equal(done.event!.type, 'milestone.completed');
      assert.notEqual(done.goal.completedAt, null);

      const dropped = await make('Drop');
      const cancelled = await milestones.transition(dropped.goal.id, 'cancelled', fixture.userId, now());
      assert.equal(cancelled.event!.type, 'milestone.cancelled');
      assert.equal(cancelled.goal.completedAt, null);
   });

   test('asking for the status it already has is agreement, not a conflict', async () => {
      const { goal } = await make('Idempotent');
      const again = await milestones.transition(goal.id, 'planned', fixture.userId, now());
      assert.equal(again.goal.status, 'planned');
      assert.equal(again.event, null);
   });

   test('a move the lifecycle forbids names both ends', async () => {
      const { goal } = await make('Refused');
      await milestones.transition(goal.id, 'cancelled', fixture.userId, now());
      await assert.rejects(
         () => milestones.transition(goal.id, 'active', fixture.userId, now()),
         (error: unknown) =>
            error instanceof InvalidMilestoneTransition && error.from === 'cancelled' && error.to === 'active'
      );
   });

   test('a patch names what changed and leaves the rest alone', async () => {
      const { goal } = await milestones.create({
         workspaceId: fixture.workspaceId,
         title: 'Before',
         description: 'Original.',
         projectId: fixture.projectId,
         createdBy: fixture.userId,
         createdAt: now(),
      });
      const updated = await milestones.update(goal.id, { title: 'After' }, fixture.userId, now());
      assert.equal(updated.goal.title, 'After');
      assert.equal(updated.goal.description, 'Original.');
      assert.deepEqual(JSON.parse(updated.event.payload).changedFields, ['title']);

      const same = await milestones.update(goal.id, { title: 'After' }, fixture.userId, now());
      assert.deepEqual(JSON.parse(same.event.payload).changedFields, []);
   });

   test('target date can be set and cleared', async () => {
      const { goal } = await make('Dated');
      const set = await milestones.update(
         goal.id,
         { targetDate: '2026-12-01', targetDateSet: true },
         fixture.userId,
         now()
      );
      assert.equal(set.goal.targetDate, '2026-12-01');
      const cleared = await milestones.update(
         goal.id,
         { targetDate: null, targetDateSet: true },
         fixture.userId,
         now()
      );
      assert.equal(cleared.goal.targetDate, null);
   });

   test('an issue belongs to at most one milestone, so linking moves it', async () => {
      const first = await make('First owner');
      const second = await make('Second owner');
      const issueId = await createIssue(sql, fixture, 'Contested');

      for (const goal of [first.goal, second.goal]) {
         await milestones.linkIssue({
            workspaceId: fixture.workspaceId,
            milestoneId: goal.id,
            issueId,
            actorId: fixture.userId,
            now: now(),
         });
      }
      assert.deepEqual((await milestones.listIssues(first.goal.id)).map((i) => i.id), []);
      assert.deepEqual((await milestones.listIssues(second.goal.id)).map((i) => i.id), [issueId]);
   });

   test('progress counts the work, percent, and hides what was deleted', async () => {
      const { goal } = await make('Counted');
      const open = await createIssue(sql, fixture, 'Open');
      const done = await createIssue(sql, fixture, 'Done');
      const working = await createIssue(sql, fixture, 'Working');
      const gone = await createIssue(sql, fixture, 'Gone');
      for (const issueId of [open, done, working, gone]) {
         await milestones.linkIssue({
            workspaceId: fixture.workspaceId, milestoneId: goal.id, issueId,
            actorId: fixture.userId, now: now(),
         });
      }
      await sql`UPDATE issues SET status = 'done' WHERE id = ${done}`;
      await sql`UPDATE issues SET status = 'in_progress' WHERE id = ${working}`;
      await sql`UPDATE issues SET deleted_at = now() WHERE id = ${gone}`;

      const progress = await milestones.progress(goal.id);
      assert.equal(progress.issuesTotal, 3);
      assert.equal(progress.issuesDone, 1);
      assert.equal(progress.issuesCancelled, 0);
      assert.equal(progress.issuesWorking, 1);
      assert.equal(progress.percent, 50);
      assert.deepEqual(
         (await milestones.listIssues(goal.id)).map((i) => i.title).sort(),
         ['Done', 'Open', 'Working']
      );
   });

   test('progressMany matches a single read and zeros a milestone with no work', async () => {
      const { goal: counted } = await make('Batch counted');
      const { goal: idle } = await make('Batch idle');
      const open = await createIssue(sql, fixture, 'Batch open');
      const done = await createIssue(sql, fixture, 'Batch done');
      for (const issueId of [open, done]) {
         await milestones.linkIssue({
            workspaceId: fixture.workspaceId, milestoneId: counted.id, issueId,
            actorId: fixture.userId, now: now(),
         });
      }
      await sql`UPDATE issues SET status = 'done' WHERE id = ${done}`;

      const single = await milestones.progress(counted.id);
      const many = await milestones.progressMany([counted.id, idle.id]);
      assert.deepEqual(many.get(counted.id), single);
      assert.deepEqual(many.get(idle.id), {
         issuesTotal: 0,
         issuesDone: 0,
         issuesCancelled: 0,
         issuesWorking: 0,
         approvalsPending: 0,
         percent: 0,
      });
   });

   test('unlinking an issue that was not linked is a not-found', async () => {
      const { goal } = await make('Detach');
      const issueId = await createIssue(sql, fixture, 'Unlinked');
      await assert.rejects(() => milestones.unlinkIssue(goal.id, issueId), NotFound);
   });

   test('an archived milestone is gone from reads but its events survive', async () => {
      const { goal } = await make('Retire');
      const event = await milestones.archive(goal.id, fixture.userId, now());
      assert.equal(event.type, 'milestone.archived');
      await assert.rejects(() => milestones.get(goal.id), NotFound);

      const listed = await milestones.list(
         fixture.workspaceId, { query: '', status: null, projectId: null }, null, 100);
      assert.ok(!listed.some((item) => item.id === goal.id));
   });

   test('every milestone fact is relayed as a jsonb object with no board', async () => {
      const { goal } = await make('Relayed');
      await milestones.transition(goal.id, 'active', fixture.userId, now());

      const rows = await sql`
         SELECT topic, jsonb_typeof(payload) AS kind, board_id, payload
           FROM outbox_events WHERE aggregate_id = ${goal.id} ORDER BY occurred_at`;
      assert.deepEqual(rows.map((r) => r.topic), ['milestone.created', 'milestone.started']);
      for (const row of rows) {
         assert.equal(row.kind, 'object');
         assert.equal(row.board_id, null);
      }
      assert.equal((rows[0]!.payload as Record<string, unknown>).aggregateType, 'milestone');
   });

   test('a viewer may read milestones and may not write them', async () => {
      const scope = await milestones.authorizeWorkspace(fixture.otherId, fixture.workspaceId, 'product.read');
      assert.equal(scope.role, 'viewer');
      await assert.rejects(
         () => milestones.authorizeWorkspace(fixture.otherId, fixture.workspaceId, 'product.write'),
         Forbidden
      );
   });

   test('a search for % matches that character and not every milestone', async () => {
      await make('50% done');
      await make('plain milestone');
      const listed = await milestones.list(
         fixture.workspaceId, { query: '%', status: null, projectId: null }, null, 100
      );
      const titles = listed.map((goal) => goal.title);
      assert.ok(titles.includes('50% done'));
      assert.ok(!titles.includes('plain milestone'));
   });

   test('the page is newest-updated first and resumes where it stopped', async () => {
      const workspaceId = await freshWorkspace(sql, fixture.userId);
      const [project] = await sql`
         INSERT INTO projects (workspace_id, name, created_by)
         VALUES (${workspaceId}, 'Paged', ${fixture.userId})
         RETURNING id`;
      const projectId = project!.id as string;
      const created = [];
      for (const title of ['one', 'two', 'three']) {
         created.push(
            (await milestones.create({
               workspaceId,
               title,
               projectId,
               createdBy: fixture.userId,
               createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, created.length)).toISOString(),
            })).goal
         );
      }
      const filter = { query: '', status: null, projectId: null };
      const first = await milestones.list(workspaceId, filter, null, 2);
      assert.deepEqual(first.map((g) => g.title), ['three', 'two']);

      const last = first.at(-1)!;
      const second = await milestones.list(workspaceId, filter, { updatedAt: last.updatedAt, id: last.id }, 10);
      assert.deepEqual(second.map((g) => g.title), ['one']);

      await sql`DELETE FROM outbox_events WHERE workspace_id = ${workspaceId}`;
      await sql`DELETE FROM milestones WHERE workspace_id = ${workspaceId}`;
      await sql`DELETE FROM projects WHERE workspace_id = ${workspaceId}`;
      await sql`DELETE FROM workspace_memberships WHERE workspace_id = ${workspaceId}`;
      await deleteWorkspaceAgents(sql, [workspaceId]);
      await deleteWorkspaceBoards(sql, [workspaceId]);
      await sql`DELETE FROM workspaces WHERE id = ${workspaceId}`;
   });
});

async function createIssue(sql: Sql, fixture: Record<string, string>, title: string): Promise<string> {
   const id = randomUUID();
   const [counter] = await sql`
      UPDATE boards SET issue_counter = issue_counter + 1 WHERE id = ${fixture.boardId!}
      RETURNING issue_counter`;
   await sql`
      INSERT INTO issues (id, board_id, number, title, created_by)
      VALUES (${id}, ${fixture.boardId!}, ${Number(counter!.issue_counter)}, ${title}, ${fixture.userId!})`;
   return id;
}

async function freshWorkspace(sql: Sql, ownerId: string): Promise<string> {
   const suffix = randomUUID().slice(0, 8);
   const [workspace] = await sql`
      INSERT INTO workspaces (id, name, slug, settings, created_by)
      VALUES (${randomUUID()}, ${`Milestones ${suffix}`}, ${`milestones-${suffix}`},
              ${sql.json({ issuePrefix: 'GOL', defaultRole: 'member', allowMemberInvites: false } as never)},
              ${ownerId})
      RETURNING id`;
   const workspaceId = workspace!.id as string;
   await sql`
      INSERT INTO workspace_memberships (workspace_id, user_id, role)
      VALUES (${workspaceId}, ${ownerId}, 'owner')`;
   return workspaceId;
}

async function seed(sql: Sql, fixture: Record<string, string>): Promise<void> {
   const suffix = randomUUID().slice(0, 8);
   const [user] = await sql`
      INSERT INTO users (id, email, name)
      VALUES (${randomUUID()}, ${`milestones-${suffix}@berry.test`}, 'Milestone Owner') RETURNING id`;
   fixture.userId = user!.id as string;
   const [other] = await sql`
      INSERT INTO users (id, email, name)
      VALUES (${randomUUID()}, ${`viewer-${suffix}@berry.test`}, 'Viewer') RETURNING id`;
   fixture.otherId = other!.id as string;

   fixture.workspaceId = await freshWorkspace(sql, fixture.userId);
   await sql`
      INSERT INTO workspace_memberships (workspace_id, user_id, role)
      VALUES (${fixture.workspaceId}, ${fixture.otherId}, 'viewer')`;

   const [board] = await sql`
      INSERT INTO boards (id, workspace_id, name, slug, created_by)
      VALUES (${randomUUID()}, ${fixture.workspaceId}, 'Milestones', ${`gol-${suffix}`}, ${fixture.userId})
      RETURNING id`;
   fixture.boardId = board!.id as string;

   const [project] = await sql`
      INSERT INTO projects (workspace_id, name, created_by)
      VALUES (${fixture.workspaceId}, 'Stages', ${fixture.userId})
      RETURNING id`;
   fixture.projectId = project!.id as string;
}

async function cleanup(sql: Sql, fixture: Record<string, string>): Promise<void> {
   if (!fixture.workspaceId) return;
   await sql`DELETE FROM outbox_events WHERE workspace_id = ${fixture.workspaceId}`;
   await sql`DELETE FROM issues WHERE board_id = ${fixture.boardId!}`;
   await sql`DELETE FROM milestones WHERE workspace_id = ${fixture.workspaceId}`;
   await sql`DELETE FROM projects WHERE workspace_id = ${fixture.workspaceId}`;
   await deleteWorkspaceAgents(sql, [fixture.workspaceId]);
   await sql`DELETE FROM boards WHERE workspace_id = ${fixture.workspaceId}`;
   await sql`DELETE FROM workspace_memberships WHERE workspace_id = ${fixture.workspaceId}`;
   await sql`DELETE FROM workspaces WHERE id = ${fixture.workspaceId}`;
   for (const id of [fixture.userId, fixture.otherId]) {
      if (id) await sql`DELETE FROM users WHERE id = ${id}`;
   }
}
