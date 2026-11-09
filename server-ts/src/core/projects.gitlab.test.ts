import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';

import { closeDatabase, openDatabase, type Sql } from '../db/pool.ts';
import { ProjectRepository } from './projects.ts';

const url = process.env.BERRY_TEST_DATABASE_URL;

describe(
   'project GitLab repository link',
   { skip: url ? false : 'BERRY_TEST_DATABASE_URL is not set' },
   () => {
      let sql: Sql;
      let projects: ProjectRepository;
      const fixture = { workspaceId: '', userId: '' };

      before(async () => {
         sql = openDatabase({ url: url! });
         projects = new ProjectRepository(sql);
         const suffix = randomUUID().slice(0, 8);
         const [user] = await sql`
            INSERT INTO users (id, email, name)
            VALUES (${randomUUID()}, ${`gl-proj-${suffix}@berry.test`}, 'GL Project')
            RETURNING id`;
         fixture.userId = user!.id as string;
         const [workspace] = await sql`
            INSERT INTO workspaces (id, name, slug, settings, created_by)
            VALUES (${randomUUID()}, ${`GL Proj ${suffix}`}, ${`gl-proj-${suffix}`},
                    ${sql.json({ issuePrefix: 'GLP', defaultRole: 'member', allowMemberInvites: false } as never)},
                    ${fixture.userId})
            RETURNING id`;
         fixture.workspaceId = workspace!.id as string;
         await sql`
            INSERT INTO workspace_memberships (workspace_id, user_id, role)
            VALUES (${fixture.workspaceId}, ${fixture.userId}, 'owner')`;
      });

      after(async () => {
         if (!sql) return;
         await sql`DELETE FROM projects WHERE workspace_id = ${fixture.workspaceId}`;
         await sql`DELETE FROM workspace_memberships WHERE workspace_id = ${fixture.workspaceId}`;
         await sql`DELETE FROM workspaces WHERE id = ${fixture.workspaceId}`;
         await sql`DELETE FROM users WHERE id = ${fixture.userId}`;
         await closeDatabase(sql);
      });

      test('create stores a nested GitLab path and serializes gitlabRepo', async () => {
         const created = await projects.create({
            workspaceId: fixture.workspaceId,
            name: 'With GitLab',
            description: null,
            status: 'planned',
            priority: 'none',
            startDate: null,
            targetDate: null,
            githubRepoId: null,
            githubRepoFullName: null,
            gitlabProjectId: '991',
            gitlabProjectPath: 'group/sub/app',
            createdBy: fixture.userId,
         });
         assert.equal(created.gitlabRepo, 'group/sub/app');
         assert.equal(created.githubRepo, null);

         const loaded = await projects.get(fixture.workspaceId, created.id);
         assert.equal(loaded.gitlabRepo, 'group/sub/app');
      });

      test('linking GitHub clears GitLab and the reverse', async () => {
         const created = await projects.create({
            workspaceId: fixture.workspaceId,
            name: 'Switch SCM',
            description: null,
            status: 'planned',
            priority: 'none',
            startDate: null,
            targetDate: null,
            githubRepoId: null,
            githubRepoFullName: null,
            gitlabProjectId: '1001',
            gitlabProjectPath: 'org/service',
            createdBy: fixture.userId,
         });

         const github = await projects.update(fixture.workspaceId, created.id, {
            descriptionSet: false,
            startDateSet: false,
            targetDateSet: false,
            githubRepoSet: true,
            githubRepoId: '42',
            githubRepoFullName: 'acme/service',
            gitlabRepoSet: true,
            gitlabProjectId: null,
            gitlabProjectPath: null,
            leadSet: false,
         });
         assert.equal(github.githubRepo, 'acme/service');
         assert.equal(github.gitlabRepo, null);

         const gitlab = await projects.update(fixture.workspaceId, created.id, {
            descriptionSet: false,
            startDateSet: false,
            targetDateSet: false,
            githubRepoSet: true,
            githubRepoId: null,
            githubRepoFullName: null,
            gitlabRepoSet: true,
            gitlabProjectId: '1002',
            gitlabProjectPath: 'org/nested/service',
            leadSet: false,
         });
         assert.equal(gitlab.githubRepo, null);
         assert.equal(gitlab.gitlabRepo, 'org/nested/service');
      });

      test('mutual exclusion refuses both pairs at once', async () => {
         await assert.rejects(
            () =>
               projects.create({
                  workspaceId: fixture.workspaceId,
                  name: 'Both',
                  description: null,
                  status: 'planned',
                  priority: 'none',
                  startDate: null,
                  targetDate: null,
                  githubRepoId: '1',
                  githubRepoFullName: 'a/b',
                  gitlabProjectId: '2',
                  gitlabProjectPath: 'c/d',
                  createdBy: fixture.userId,
               }),
            /Conflict|check|scm/i
         );
      });
   }
);
