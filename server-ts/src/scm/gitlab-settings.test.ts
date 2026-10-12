import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { closeDatabase, openDatabase, type Sql } from '../db/pool.ts';
import { deleteWorkspaceBoards } from '../test-support/boards.ts';
import { deleteWorkspaceAgents } from '../test-support/protected-agents.ts';
import { DEFAULT_GITLAB_SETTINGS, GitLabSettingsRepository } from './gitlab-settings.ts';

const url = process.env.BERRY_TEST_DATABASE_URL;

describe(
   'GitLab settings, per workspace',
   { skip: url ? false : 'BERRY_TEST_DATABASE_URL is not set' },
   () => {
      let sql: Sql;
      const workspaceIds: string[] = [];
      let userId = '';

      async function workspace(label: string): Promise<string> {
         const suffix = randomUUID().slice(0, 8);
         const [row] = await sql`
            INSERT INTO workspaces (id, name, slug, settings, created_by)
            VALUES (${randomUUID()}, ${`${label} ${suffix}`}, ${`${label.toLowerCase()}-${suffix}`},
                    ${sql.json({ issuePrefix: 'GLS', defaultRole: 'member', allowMemberInvites: false } as never)},
                    ${userId})
            RETURNING id`;
         const id = row?.id;
         if (typeof id !== 'string') throw new Error('workspace was not created');
         workspaceIds.push(id);
         return id;
      }

      before(async () => {
         if (!url) throw new Error('BERRY_TEST_DATABASE_URL is not set');
         sql = openDatabase({ url });
         const [user] = await sql`
            INSERT INTO users (id, email, name)
            VALUES (${randomUUID()}, ${`gls-${randomUUID().slice(0, 8)}@berry.test`}, 'Settings')
            RETURNING id`;
         const id = user?.id;
         if (typeof id !== 'string') throw new Error('user was not created');
         userId = id;
      });

      after(async () => {
         if (!sql) return;
         for (const id of workspaceIds) {
            await sql`DELETE FROM outbox_events WHERE workspace_id = ${id}`;
            await deleteWorkspaceAgents(sql, [id]);
            await deleteWorkspaceBoards(sql, [id]);
            await sql`DELETE FROM workspaces WHERE id = ${id}`;
         }
         if (userId) await sql`DELETE FROM users WHERE id = ${userId}`;
         await closeDatabase(sql);
      });

      test('a workspace that never saved settings reads the defaults', async () => {
         const w = await workspace('Defaults');
         const settings = await new GitLabSettingsRepository(sql).get(w);
         assert.deepEqual({ ...settings, updatedAt: null }, DEFAULT_GITLAB_SETTINGS);
      });

      test('an update persists, keeps untouched fields, and publishes one event', async () => {
         const w = await workspace('Update');
         const repository = new GitLabSettingsRepository(sql);
         const saved = await sql.begin((tx) =>
            repository.update(w, { coAuthorTrailer: false }, userId, tx)
         );
         assert.equal(saved.coAuthorTrailer, false);
         assert.equal(saved.enabled, true);
         assert.equal(saved.showLinkedMergeRequests, true);
         assert.equal((await repository.get(w)).coAuthorTrailer, false);
         const events = await sql`
            SELECT topic FROM outbox_events WHERE workspace_id = ${w} AND topic = 'gitlab.settings.updated'`;
         assert.equal(events.length, 1);
      });
   }
);
