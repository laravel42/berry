import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, test } from 'node:test';
import pg from 'pg';
import { apply, type Logger } from '../migrate/migrations.ts';
import { startEmbeddedDatabase } from './embedded.ts';
import { closeDatabase, openDatabase, type Sql } from './pool.ts';

/**
 * The standalone gate: PGlite has to run the checksummed migrations and the
 * statements the server cannot lose (a comment, a session row, SKIP LOCKED).
 * A failure here stops the migration. Host Postgres tests stay on
 * BERRY_TEST_DATABASE_URL and do not come through this file.
 */

const quiet: Logger = {
   info() {},
   error() {},
};

const directories: string[] = [];

after(async () => {
   await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function tempDir(): Promise<string> {
   const directory = await mkdtemp(path.join(tmpdir(), 'berry-pglite-'));
   directories.push(directory);
   return directory;
}

describe('embedded PGlite', () => {
   test('a second open of the same directory is refused while the first is alive', async () => {
      const directory = await tempDir();
      const first = await startEmbeddedDatabase(directory);
      await assert.rejects(startEmbeddedDatabase(directory), /in use by process/);
      await first.close();
      const second = await startEmbeddedDatabase(directory);
      await second.close();
   });

   test(
      'migrations apply, and a comment, a session lookup, and SKIP LOCKED succeed',
      { timeout: 300_000 },
      async () => {
         const directory = await tempDir();
         const embedded = await startEmbeddedDatabase(directory);
         const sql = openDatabase({ url: embedded.url, max: 1 });
         try {
            await apply(sql, quiet);
            await proof(sql, embedded.url);
            await apply(sql, quiet);
         } finally {
            await closeDatabase(sql);
            await embedded.close();
         }
      }
   );
});

async function proof(sql: Sql, url: string): Promise<void> {
   const userId = randomUUID();
   const suffix = userId.slice(0, 8);
   await sql`
      INSERT INTO users (id, email, name, email_verified)
      VALUES (${userId}, ${`owner-${suffix}@berry.test`}, 'Owner', true)`;

   const token = randomUUID();
   await sql`
      INSERT INTO auth_sessions (id, user_id, token, expires_at)
      VALUES (${randomUUID()}, ${userId}, ${token}, now() + interval '1 hour')`;
   const [session] = await sql`SELECT user_id FROM auth_sessions WHERE token = ${token}`;
   assert.equal(session?.user_id, userId);

   const pool = new pg.Pool({ connectionString: url, max: 1 });
   try {
      const lookedUp = await pool.query<{ user_id: string }>('SELECT user_id FROM auth_sessions WHERE token = $1', [token]);
      assert.equal(lookedUp.rows[0]?.user_id, userId);
   } finally {
      await pool.end();
   }

   const [workspace] = await sql`
      INSERT INTO workspaces (id, name, slug, created_by)
      VALUES (${randomUUID()}, 'Local', ${`local-${suffix}`}, ${userId})
      RETURNING id`;
   const workspaceId = workspace?.id as string;
   const [board] = await sql`SELECT id FROM boards WHERE workspace_id = ${workspaceId}`;
   assert.ok(board?.id, 'creating a workspace did not create its board');

   const [counter] = await sql`
      UPDATE boards SET issue_counter = issue_counter + 1 WHERE id = ${board.id as string}
      RETURNING issue_counter`;
   const [issue] = await sql`
      INSERT INTO issues (id, board_id, number, title, created_by)
      VALUES (${randomUUID()}, ${board.id as string}, ${Number(counter?.issue_counter)}, 'Private', ${userId})
      RETURNING id`;
   const [comment] = await sql`
      INSERT INTO comments (issue_id, author_type, author_id, body)
      VALUES (${issue?.id as string}, 'user', ${userId}, 'kept on this device')
      RETURNING id, body`;
   assert.equal(comment?.body, 'kept on this device');

   const [locked] = await sql`
      SELECT id FROM runs
       WHERE status = 'queued'
       FOR UPDATE SKIP LOCKED
       LIMIT 1`;
   assert.equal(locked, undefined);

   await sql`SELECT pg_advisory_lock(4784356015137974631)`;
   await sql`SELECT pg_advisory_unlock(4784356015137974631)`;

   const [stamp] = await sql`SELECT now()::text AS now`;
   assert.match(String(stamp?.now), /\d{4}-\d{2}-\d{2}/);
}
