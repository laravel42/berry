import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { parseWorkstationToken, secretMatches } from '../auth/tokens.ts';
import { closeDatabase, openDatabase, type Sql } from '../db/pool.ts';
import { cleanupFixture, seedFixture, type Fixture } from './test-fixture.ts';
import { WorkstationLimit, WorkstationRepository } from './workstations.ts';

const url = process.env.BERRY_TEST_DATABASE_URL;

describe('workstations', { skip: url ? false : 'BERRY_TEST_DATABASE_URL is not set' }, () => {
   let sql: Sql;
   let fixture: Fixture | null = null;
   let repo: WorkstationRepository;

   before(async () => {
      sql = openDatabase({ url: url as string });
      fixture = await seedFixture(sql, 'ws');
      repo = new WorkstationRepository(sql);
   });
   after(async () => {
      if (sql && fixture) await cleanupFixture(sql, fixture);
      if (sql) await closeDatabase(sql);
   });

   test('issues a token once and authenticates with it', async () => {
      const issued = await repo.create(fixture!.userId, 'Office');
      assert.equal(issued.name, 'Office');
      assert.match(issued.token, /^berry_ws_/);
      const parsed = parseWorkstationToken(issued.token);
      const found = await repo.authenticate(parsed);
      assert.ok(found);
      assert.equal(found.id, issued.id);
      assert.ok(secretMatches(parsed.secret, found.tokenHash));

      const listed = await repo.list(fixture!.userId);
      assert.equal(listed.some((row) => row.id === issued.id), true);
      assert.equal('token' in listed[0]!, false);

      await repo.revoke(fixture!.userId, issued.id);
      assert.equal(await repo.authenticate(parsed), null);
   });

   test('caps how many machines one person can pair', async () => {
      const ids: string[] = [];
      try {
         for (let i = 0; i < 8; i += 1) {
            ids.push((await repo.create(fixture!.userId, `Machine ${i}`)).id);
         }
         await assert.rejects(() => repo.create(fixture!.userId, 'Ninth'), WorkstationLimit);
      } finally {
         for (const id of ids) await repo.revoke(fixture!.userId, id);
      }
   });
});
