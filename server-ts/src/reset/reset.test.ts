import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Sql } from '../db/pool.ts';
import {
   assertBerryDatabase,
   EMPTIED_TABLES,
   KEPT_TABLES,
   NotABerryDatabase,
   unlistedTables,
} from './reset.ts';
import * as reset from './reset.ts';

/** A pool that answers each query in turn with a canned result. */
function answering(...results: unknown[][]): Sql {
   let next = 0;
   return (async () => results[next++] ?? []) as unknown as Sql;
}

test('a database carrying the Berry schema is accepted', async () => {
   const sql = answering([
      { ledger: 'berry_schema_migrations', projects: 'projects' },
   ]);
   await assertBerryDatabase(sql);
});

test('a database with no Berry schema is refused', async () => {
   const sql = answering([{ ledger: null, projects: null }], [{ db: 'berry', host: '127.0.0.1' }]);
   await assert.rejects(assertBerryDatabase(sql), NotABerryDatabase);
});

test('the refusal names the database and server it declined', async () => {
   const sql = answering([{ ledger: null, projects: null }], [{ db: 'berry', host: '127.0.0.1' }]);
   await assert.rejects(assertBerryDatabase(sql), (error: Error) => {
      assert.match(error.message, /"berry"/);
      assert.match(error.message, /127\.0\.0\.1/);
      return true;
   });
});

// A second PostgreSQL listening on the same port, holding an unrelated `berry`
// database, is the failure this check exists for — and it is not hypothetical.
test('a half-migrated database is refused rather than half-emptied', async () => {
   const sql = answering(
      [{ ledger: 'berry_schema_migrations', projects: null }],
      [{ db: 'berry', host: null }]
   );
   await assert.rejects(assertBerryDatabase(sql), NotABerryDatabase);
});

test('the reset has no way to delete a repository', () => {
   // Repositories are GitHub's now, owned by the workspace's organization.
   // Deleting somebody's code because a development database was reset would
   // be unrecoverable, so the capability is absent rather than guarded.
   const exported = Object.keys(reset);
   assert.ok(
      !exported.some((name) => /repositor/i.test(name)),
      `the reset should expose nothing repository-shaped, got: ${exported.join(', ')}`
   );
});

test('no table is both kept and emptied', () => {
   const both = EMPTIED_TABLES.filter((table) => KEPT_TABLES.has(table));
   assert.deepEqual(both, []);
   assert.equal(new Set(EMPTIED_TABLES).size, EMPTIED_TABLES.length, 'a table listed twice');
});

test('only users, workspaces, agents, skills and autopilots survive', () => {
   // Every kept table is one of the five, or a row one of them is made of.
   const families = /^(users|auth_|sessions$|personal_api_tokens|notification_preferences|user_channel_identities|workspaces|workspace_|boards|agents|agent_|runtime_profiles|mcp_servers|model_role_agents|quick_action_definitions|skills|skill_files|autopilots|autopilot_|berry_schema_migrations)/;
   for (const table of KEPT_TABLES) {
      assert.match(table, families, `${table} is kept but belongs to none of the five`);
   }
   // Work never survives, whatever the lists say.
   for (const table of ['projects', 'goals', 'issues', 'runs', 'plans', 'conversations', 'outbox_events']) {
      assert.ok(!KEPT_TABLES.has(table), `${table} must not be kept`);
      assert.ok(EMPTIED_TABLES.includes(table), `${table} must be emptied`);
   }
});

test('a table on neither list is reported so the lists get taught', () => {
   const tables = [...KEPT_TABLES, ...EMPTIED_TABLES, 'brand_new_feature', 'another_one'];
   assert.deepEqual(unlistedTables(tables), ['brand_new_feature', 'another_one']);
   assert.deepEqual(unlistedTables([...KEPT_TABLES]), []);
});

test('every table the migrations create is on one list or the other', async () => {
   const { readdir, readFile } = await import('node:fs/promises');
   const dir = new URL('../../migrations/', import.meta.url);
   const created = new Set<string>();
   const dropped = new Set<string>();
   for (const file of await readdir(dir)) {
      if (!file.endsWith('.up.sql')) continue;
      const text = await readFile(new URL(file, dir), 'utf8');
      for (const match of text.matchAll(/CREATE TABLE (?:IF NOT EXISTS )?(?:public\.)?([a-z_]+)/gi)) {
         created.add(match[1]!.toLowerCase());
      }
      for (const match of text.matchAll(/DROP TABLE (?:IF EXISTS )?(?:public\.)?([a-z_]+)/gi)) {
         dropped.add(match[1]!.toLowerCase());
      }
   }
   const live = [...created].filter((table) => !dropped.has(table));
   assert.deepEqual(unlistedTables(live), [], 'add these tables to KEPT_TABLES or EMPTIED_TABLES');
});
