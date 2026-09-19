import assert from 'node:assert/strict';
import { after, afterEach, before, describe, test } from 'node:test';
import { closeDatabase, openDatabase, type Sql } from '../db/pool.ts';
import { nullRunMemory } from '../agentcore/memory.ts';
import { GitHubClient } from '../integrations/github.ts';
import { enqueueTask } from '../runs/queue.ts';
import { EnvelopeBuilder, loadTask } from './envelope-builder.ts';
import { runtimeSessionIdFor } from './session-id.ts';
import { cleanupFixture, createIssue, seedFixture, type Fixture } from './test-fixture.ts';
import { buildTranscript } from './transcript.ts';

const url = process.env.BERRY_TEST_DATABASE_URL;

describe('envelope builder', { skip: url ? false : 'BERRY_TEST_DATABASE_URL is not set' }, () => {
   let sql: Sql;
   let fixture: Fixture | null = null;
   let builder: EnvelopeBuilder;

   before(async () => {
      sql = openDatabase({ url: url! });
      fixture = await seedFixture(sql, 'envelope');
      builder = new EnvelopeBuilder({
         sql, publicUrl: 'https://berry.test', defaultModel: 'default-model', memory: nullRunMemory(), sealer: null,
         github: (token) => new GitHubClient({ token }),
      });
   });
   afterEach(async () => {
      await sql`DELETE FROM runs WHERE workspace_id = ${fixture!.workspaceId}`;
   });
   after(async () => {
      await cleanupFixture(sql, fixture);
      await closeDatabase(sql);
   });

   async function finishedRun(issueId: string, prompt: string, output: string, agentId = fixture!.agentId): Promise<string> {
      const { runId } = await enqueueTask(sql, {
         workspaceId: fixture!.workspaceId, agentId, issueId, kind: 'agent', source: 'mention', prompt,
      });
      await sql`UPDATE runs SET status = 'succeeded', dispatch_state = 'succeeded', output = ${output},
                       completed_at = now() WHERE id = ${runId}`;
      await sql`UPDATE issues SET active_run_id = NULL WHERE id = ${issueId}`;
      return runId;
   }

   test('the transcript is this agent on this issue, oldest first, without the current run', async () => {
      const f = fixture!;
      const issueId = await createIssue(sql, f);
      await finishedRun(issueId, 'first ask', 'first answer');
      await finishedRun(issueId, 'second ask', 'second answer');
      await finishedRun(issueId, 'someone else', 'not mine', f.orchestratorId);
      const { runId } = await enqueueTask(sql, { workspaceId: f.workspaceId, agentId: f.agentId, issueId, kind: 'agent', source: 'mention', prompt: 'now' });
      const transcript = await buildTranscript(sql, { agentId: f.agentId, issueId, chatSessionId: null, excludeRunId: runId });
      assert.deepEqual(transcript.map((m) => m.text), ['first ask', 'first answer', 'second ask', 'second answer']);
   });

   test('the transcript keeps the newest messages within its budget', async () => {
      const f = fixture!;
      const issueId = await createIssue(sql, f);
      for (let i = 0; i < 5; i += 1) await finishedRun(issueId, `ask ${i}`, `answer ${i}`);
      const transcript = await buildTranscript(sql, { agentId: f.agentId, issueId, chatSessionId: null, excludeRunId: 'none', maxMessages: 4 });
      assert.deepEqual(transcript.map((m) => m.text), ['ask 3', 'answer 3', 'ask 4', 'answer 4']);
   });

   test('an issue task envelope is on the (agent, issue) session and carries the transcript and token', async () => {
      const f = fixture!;
      const issueId = await createIssue(sql, f, 'Envelope task');
      await finishedRun(issueId, 'earlier', 'did a thing');
      const { runId } = await enqueueTask(sql, { workspaceId: f.workspaceId, agentId: f.agentId, issueId, kind: 'agent', source: 'mention', prompt: 'continue' });
      const task = await loadTask(sql, runId);
      const { envelope, delivery } = await builder.build({ task, dispatch: null, token: 'berry_task_x' });
      assert.equal(envelope.runtimeSessionId, runtimeSessionIdFor(`${f.agentId}:${issueId}`));
      assert.equal(envelope.kind, 'agent');
      assert.equal(envelope.agent.model, 'default-model');
      assert.equal(envelope.transcript.length, 2);
      assert.equal(envelope.berry.token, 'berry_task_x');
      assert.match(envelope.task.prompt, /Envelope task/);
      assert.equal(delivery, null, 'no git credential means no repository');
   });

   describe('a task with a repository', () => {
      const BRANCH_HEAD = 'b'.repeat(40);
      const MAIN_HEAD = 'c'.repeat(40);
      const FORK = 'a'.repeat(40);
      let projectId = '';

      before(async () => {
         const [project] = await sql`
            INSERT INTO projects (workspace_id, name, github_repo_full_name, github_repo_id, created_by)
            VALUES (${fixture!.workspaceId}, 'Gallery', 'berry/gallery', 42, ${fixture!.userId}) RETURNING id`;
         projectId = project!.id as string;
         await sql`UPDATE agents SET permissions = ${sql.array(['read_repository', 'create_branches', 'open_pull_requests'])} WHERE id = ${fixture!.agentId}`;
      });
      after(async () => {
         await sql`DELETE FROM issue_project_links WHERE project_id = ${projectId}`;
         await sql`DELETE FROM projects WHERE id = ${projectId}`;
      });

      /**
       * GitHub as three trees. `main` is what the default branch changed since
       * the fork; the task branch always rewrote the README and added a file.
       */
      function repositoryBuilder(main: Record<string, string>, options: { branchExists?: boolean } = {}) {
         const entry = (sha: string) => ({ sha, mode: '100644', type: 'blob', size: 10 });
         const fork = { 'server/README.md': 'readme-0', 'src/app.ts': 'app-0' };
         const trees: Record<string, Record<string, string>> = {
            [FORK]: fork,
            [BRANCH_HEAD]: { ...fork, 'server/README.md': 'readme-task', 'src/gallery.ts': 'gallery-task' },
            [MAIN_HEAD]: { ...fork, ...main },
         };
         const asked: string[] = [];
         const client = {
            repository: async () => ({ defaultBranch: 'main', canPush: true }),
            branchHead: async (_owner: string, _name: string, branch: string) =>
               branch === 'main' ? MAIN_HEAD : options.branchExists === false ? null : BRANCH_HEAD,
            mergeBase: async () => {
               asked.push('mergeBase');
               return { commit: FORK, behindBy: 1 };
            },
            treeEntries: async (_owner: string, _name: string, commit: string) =>
               new Map(Object.entries(trees[commit]!).map(([path, sha]) => [path, entry(sha)])),
         } as unknown as GitHubClient;
         return {
            asked,
            builder: new EnvelopeBuilder({
               sql, publicUrl: 'https://berry.test', defaultModel: 'default-model', memory: nullRunMemory(), sealer: null,
               gitCredential: async () => ({ username: 'x', password: 't', canPush: true }),
               github: () => client,
            }),
         };
      }

      async function queued(title: string) {
         const f = fixture!;
         const issueId = await createIssue(sql, f, title);
         await sql`INSERT INTO issue_project_links (workspace_id, issue_id, project_id, linked_by) VALUES (${f.workspaceId}, ${issueId}, ${projectId}, ${f.userId})`;
         const { runId } = await enqueueTask(sql, { workspaceId: f.workspaceId, agentId: f.agentId, issueId, kind: 'agent', source: 'mention', prompt: 'continue' });
         return loadTask(sql, runId);
      }

      const snapshotOf = async (runId: string) =>
         (await sql`SELECT base_commit, default_commit, expected_head, merge_parent, merge_base FROM run_repository_snapshots WHERE run_id = ${runId}`)[0]!;

      test('a branch that conflicts with the default branch gets a run built to merge it', async () => {
         const { builder: withRepository } = repositoryBuilder({ 'server/README.md': 'readme-other-task', 'src/app.ts': 'app-other-task' });
         const task = await queued('Conflicting task');
         const { envelope } = await withRepository.build({ task, dispatch: null, token: 'berry_task_x' });
         // The workspace starts from the default branch head; the branch head
         // stays the commit the delivery builds on, and its first parent.
         assert.equal(envelope.repo?.snapshotCommit, MAIN_HEAD);
         assert.deepEqual(envelope.repo?.merge, { conflicts: ['server/README.md'] });
         const row = await snapshotOf(task.runId);
         assert.equal(row.base_commit, BRANCH_HEAD);
         assert.equal(row.expected_head, BRANCH_HEAD);
         assert.equal(row.merge_parent, MAIN_HEAD);
         assert.equal(row.merge_base, FORK);
         // The run is told, by name, what to reconcile and how.
         assert.match(envelope.task.prompt, /Merging main into this task/);
         assert.match(envelope.task.prompt, /- server\/README\.md/);
         assert.doesNotMatch(envelope.task.prompt, /- src\/app\.ts/, 'a file only the default branch changed is not the agent\'s to merge');
         assert.match(envelope.task.prompt, /Remove nothing the other task contributed/);
         // Built again for the same run, it is the same merge.
         const again = await withRepository.build({ task, dispatch: null, token: 'berry_task_x' });
         assert.deepEqual(again.envelope.repo?.merge, { conflicts: ['server/README.md'] });
      });

      test('a branch that is only behind is an ordinary run on its own head', async () => {
         const { builder: withRepository } = repositoryBuilder({ 'src/app.ts': 'app-other-task' });
         const task = await queued('Behind, no conflict');
         const { envelope } = await withRepository.build({ task, dispatch: null, token: 'berry_task_x' });
         assert.equal(envelope.repo?.snapshotCommit, BRANCH_HEAD);
         assert.equal(envelope.repo?.merge, undefined);
         assert.equal((await snapshotOf(task.runId)).merge_parent, null);
         assert.doesNotMatch(envelope.task.prompt, /Merging main/);
      });

      test('a task with no branch yet starts from the default branch and asks nothing about a merge', async () => {
         const { builder: withRepository, asked } = repositoryBuilder({}, { branchExists: false });
         const task = await queued('First run');
         const { envelope } = await withRepository.build({ task, dispatch: null, token: 'berry_task_x' });
         assert.equal(envelope.repo?.snapshotCommit, MAIN_HEAD);
         assert.equal(envelope.repo?.merge, undefined);
         assert.deepEqual(asked, []);
      });
   });

   test('two completion tasks never share a session', async () => {
      const f = fixture!;
      const one = await enqueueTask(sql, { workspaceId: f.workspaceId, agentId: f.orchestratorId, kind: 'completion', source: 'completion', prompt: 'a' });
      const two = await enqueueTask(sql, { workspaceId: f.workspaceId, agentId: f.orchestratorId, kind: 'completion', source: 'completion', prompt: 'b' });
      await sql`UPDATE runs SET completion_spec = ${sql.json({ purpose: 't', system: 's', jsonSchema: null, model: null } as never)}
                 WHERE id IN (${one.runId}, ${two.runId})`;
      const a = await builder.build({ task: await loadTask(sql, one.runId), dispatch: null, token: 't' });
      const b = await builder.build({ task: await loadTask(sql, two.runId), dispatch: null, token: 't' });
      assert.notEqual(a.envelope.runtimeSessionId, b.envelope.runtimeSessionId);
      assert.equal(a.envelope.completion?.system, 's');
      assert.deepEqual(a.envelope.transcript, []);
   });
});
