import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, describe, test } from 'node:test';

import pg from 'pg';

import { closeDatabase, openDatabase, type Sql } from '../db/pool.ts';
import { createBerryAuth } from './better-auth.ts';

/**
 * Email registration against host Postgres. Gated like every database test:
 * without BERRY_TEST_DATABASE_URL this skips and the default suite stays offline.
 */

const url = process.env.BERRY_TEST_DATABASE_URL;
const BASE = 'http://127.0.0.1:4174';

describe('email registration', { skip: url ? false : 'BERRY_TEST_DATABASE_URL is not set' }, () => {
   let sql: Sql | undefined;
   let pool: pg.Pool | undefined;

   after(async () => {
      await pool?.end();
      if (sql !== undefined) await closeDatabase(sql);
   });

   test('a person can register and sign in', async () => {
      const db = openDatabase({ url: url as string });
      sql = db;
      pool = new pg.Pool({ connectionString: url, max: 1 });
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

      const [account] = await db`
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
   });
});
