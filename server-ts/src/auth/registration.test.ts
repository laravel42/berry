import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';

import pg from 'pg';

import { startEmbeddedDatabase } from '../db/embedded.ts';
import { closeDatabase, openDatabase } from '../db/pool.ts';
import { apply, type Logger } from '../migrate/migrations.ts';
import { createBerryAuth } from './better-auth.ts';

/**
 * Email registration against PGlite, the database the desktop app starts.
 * Host Postgres tests stay on BERRY_TEST_DATABASE_URL.
 */

const BASE = 'http://127.0.0.1:4174';
const quiet: Logger = { info() {}, error() {} };
const directories: string[] = [];

after(async () => {
   await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

test('a person can register and sign in on PGlite', { timeout: 120_000 }, async () => {
   const directory = await mkdtemp(path.join(tmpdir(), 'berry-register-'));
   directories.push(directory);
   const embedded = await startEmbeddedDatabase(directory);
   const sql = openDatabase({ url: embedded.url, max: 1 });
   const pool = new pg.Pool({ connectionString: embedded.url, max: 1 });
   try {
      await apply(sql, quiet);
      const auth = createBerryAuth({
         pool,
         secret: 'test-secret-that-is-at-least-32-characters',
         baseUrl: BASE,
         trustedOrigins: [BASE],
         github: null,
         sessionTtlMs: 60 * 60 * 1000,
      });
      const email = `ada-${randomUUID()}@berry.test`;
      const password = 'long-enough-password';
      const created = await auth.handler(
         new Request(`${BASE}/api/auth/sign-up/email`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', origin: BASE },
            body: JSON.stringify({ email, password, name: 'Ada' }),
         })
      );
      assert.equal(created.status, 200, await created.clone().text());
      assert.match(created.headers.getSetCookie().join('\n'), /berry\.session_token=/);

      const [account] = await sql`
         SELECT provider_id, password IS NOT NULL AS has_password
         FROM auth_accounts
         WHERE user_id = (SELECT id FROM users WHERE email = ${email})`;
      assert.equal(account?.provider_id, 'credential');
      assert.equal(account?.has_password, true);

      const signedIn = await auth.handler(
         new Request(`${BASE}/api/auth/sign-in/email`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', origin: BASE },
            body: JSON.stringify({ email, password }),
         })
      );
      assert.equal(signedIn.status, 200, await signedIn.clone().text());

      const refused = await auth.handler(
         new Request(`${BASE}/api/auth/sign-up/email`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', origin: BASE },
            body: JSON.stringify({ email: `short-${randomUUID()}@berry.test`, password: 'short', name: 'Bo' }),
         })
      );
      assert.ok(refused.status >= 400);
   } finally {
      await pool.end();
      await closeDatabase(sql);
      await embedded.close();
   }
});
