import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { closeDatabase, openDatabase, type Sql } from '../db/pool.ts';
import { nullRunMemory } from '../agentcore/memory.ts';
import { adoptProjectRepositoryForIssue } from '../core/issue-repository.ts';
import { GitHubClient } from '../integrations/github.ts';
import type { GitLabClient } from '../integrations/gitlab.ts';
import { enqueueTask } from '../runs/queue.ts';
import { EnvelopeBuilder, loadTask } from './envelope-builder.ts';
import { configurePlatformModel } from './platform-model.ts';
import { cleanupFixture, createIssue, seedFixture, type Fixture } from './test-fixture.ts';
import { publishTrustedDelivery } from './trusted-delivery.ts';

const url = process.env.BERRY_TEST_DATABASE_URL;

describe('a task on a nested GitLab project', { skip: url ? false : 'BERRY_TEST_DATABASE_URL is not set' }, () => {
   const PATH = 'quattrolinee/ql/bozzo';
   const MAIN_HEAD = 'c'.repeat(40);
   let sql: Sql;
   let fixture: Fixture | null = null;
   let projectId = '';

   before(async () => {
      sql = openDatabase({ url: url! });
      fixture = await seedFixture(sql, 'gitlab');
      // The test database connects no AI provider; Berry's own model lets a run queue.
      configurePlatformModel({ provider: 'bedrock', model: 'test-model', region: 'us-east-1' });
      const [project] = await sql`
         INSERT INTO projects (workspace_id, name, gitlab_project_path, gitlab_project_id, created_by)
         VALUES (${fixture.workspaceId}, 'Bozzo', ${PATH}, 99, ${fixture.userId}) RETURNING id`;
      projectId = project!.id as string;
      await sql`UPDATE agents SET permissions = ${sql.array(['read_repository', 'create_branches', 'open_pull_requests'])} WHERE id = ${fixture.agentId}`;
   });

   after(async () => {
      configurePlatformModel(null);
      await sql`DELETE FROM issue_project_links WHERE project_id = ${projectId}`;
      await sql`DELETE FROM projects WHERE id = ${projectId}`;
      await cleanupFixture(sql, fixture);
      await closeDatabase(sql);
   });

   /** GitLab with a default branch and no task branch yet; records what it was asked. */
   function gitlab() {
      const asked: string[] = [];
      const client = {
         repository: async (owner: string, name: string) => {
            asked.push(`repository ${owner} | ${name}`);
            return { defaultBranch: 'main', canPush: true };
         },
         branchHead: async (_owner: string, _name: string, branch: string) => (branch === 'main' ? MAIN_HEAD : null),
         seedEmptyBranch: async () => MAIN_HEAD,
      } as unknown as GitLabClient;
      return { client, asked };
   }

   test('is planned through GitLab, and the runtime is handed the nested path', async () => {
      const f = fixture!;
      const { client, asked } = gitlab();
      const builder = new EnvelopeBuilder({
         sql, publicUrl: 'https://berry.test', defaultModel: 'default-model', memory: nullRunMemory(), sealer: null,
         // No GitHub at all: a GitLab task must not need it.
         github: (token) => new GitHubClient({ token }),
         gitlab: async () => client,
      });
      const issueId = await createIssue(sql, f, 'Fix the header');
      await sql`INSERT INTO issue_project_links (workspace_id, issue_id, project_id, linked_by) VALUES (${f.workspaceId}, ${issueId}, ${projectId}, ${f.userId})`;
      await adoptProjectRepositoryForIssue(sql, issueId, null);
      const { runId } = await enqueueTask(sql, { workspaceId: f.workspaceId, agentId: f.agentId, issueId, kind: 'agent', source: 'mention', prompt: 'go' });
      const task = await loadTask(sql, runId);

      const { envelope, delivery } = await builder.build({ task, dispatch: null, token: 'berry_task_x' });
      assert.deepEqual(asked, ['repository quattrolinee/ql | bozzo']);
      assert.equal(envelope.repo?.fullName, PATH);
      assert.equal(envelope.repo?.snapshotCommit, MAIN_HEAD, 'a new branch starts from the default branch head');
      assert.equal(envelope.repo?.readOnly, false);
      assert.equal(delivery?.provider, 'gitlab');
      assert.equal(delivery?.fullName, PATH);
      const [snapshot] = await sql`SELECT provider, repository, base_commit, expected_head, merge_parent FROM run_repository_snapshots WHERE run_id = ${runId}`;
      assert.equal(snapshot?.provider, 'gitlab');
      assert.equal(snapshot?.repository, PATH);
      assert.equal(snapshot?.expected_head, null);
      assert.equal(snapshot?.merge_parent, null);

      // Trusted delivery publishes to the same project, split the same way.
      await sql`UPDATE runs SET status = 'running' WHERE id = ${runId}`;
      const published: Array<{ owner: string; name: string; branch: string }> = [];
      const result = await publishTrustedDelivery(
         sql,
         runId,
         {
            publishCandidate: async (input) => {
               published.push({ owner: input.owner, name: input.name, branch: input.branch });
               return { commit: 'd'.repeat(40), files: ['header.css'] };
            },
         },
         {
            committed: true, commit: null, branch: delivery!.branch, files: ['header.css'], filesChanged: 1, insertions: 1, deletions: 0,
            candidate: [{ path: 'header.css', mode: '100644', content: Buffer.from('h1{}').toString('base64') }],
         }
      );
      assert.deepEqual(published, [{ owner: 'quattrolinee/ql', name: 'bozzo', branch: delivery!.branch }]);
      assert.equal(result.commit, 'd'.repeat(40));
   });
});
