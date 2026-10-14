import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { personalTokenResolver } from '../auth/credentials.ts';
import { SessionService } from '../auth/sessions.ts';
import { issueTestToken } from '../auth/test-credentials.ts';
import { closeDatabase, openDatabase, type Sql } from '../db/pool.ts';
import { createApp, type BerryApp } from '../http/app.ts';
import { Registry } from '../http/registry.ts';
import { cleanupFixture, seedFixture, type Fixture } from '../runtime/test-fixture.ts';
import { createWorkstationHub } from '../runtime/workstation-hub.ts';
import { WorkstationRepository } from '../runtime/workstations.ts';
import { workstationBridgeMounts, workstationMounts } from './workstations.ts';

const url = process.env.BERRY_TEST_DATABASE_URL;

describe('/api/v1/workstations', { skip: url ? false : 'BERRY_TEST_DATABASE_URL is not set' }, () => {
   let sql: Sql;
   let app: BerryApp;
   let mine: Fixture | null = null;
   let token = '';

   before(async () => {
      sql = openDatabase({ url: url as string });
      mine = await seedFixture(sql, 'wsm');
      await sql`UPDATE users SET last_workspace_id = ${mine.workspaceId} WHERE id = ${mine.userId}`;
      token = await issueTestToken(sql, mine.userId);
      const sessions = new SessionService({ sql, auth: null, bearer: [personalTokenResolver(sql)] });
      const hub = createWorkstationHub();
      const workstations = new WorkstationRepository(sql);
      const registry = new Registry();
      registry.registerAll(
         workstationMounts({
            sessions,
            workstations,
            hub,
            berryUrl: 'https://berry.example',
         })
      );
      registry.registerAll(workstationBridgeMounts({ workstations, hub }));
      app = createApp(registry);
   });
   after(async () => {
      if (sql && mine) {
         await sql`DELETE FROM workstations WHERE user_id = ${mine.userId}`;
         await cleanupFixture(sql, mine);
      }
      if (sql) await closeDatabase(sql);
   });

   const session = (path: string, init: RequestInit = {}) =>
      app.request(path, {
         ...init,
         headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...(init.headers ?? {}) },
      });

   test('pairing shows the token once and the bridge can poll with it', async () => {
      const created = await session('/api/v1/workstations', {
         method: 'POST',
         body: JSON.stringify({ name: 'Office' }),
      });
      assert.equal(created.status, 201);
      const body = (await created.json()) as {
         id: string;
         name: string;
         token: string;
         berryUrl: string;
         upCommand: string;
         online: boolean;
      };
      assert.equal(body.name, 'Office');
      assert.equal(body.berryUrl, 'https://berry.example');
      assert.match(body.token, /^berry_ws_/);
      assert.match(
         body.upCommand,
         /wget -qO- 'https:\/\/berry\.example\/install\/berry-bridge' \| sh -s -- up --url 'https:\/\/berry\.example' --token 'berry_ws_/
      );
      assert.equal(created.headers.get('cache-control'), 'no-store');

      const listed = (await (await session('/api/v1/workstations')).json()) as {
         nodes: Array<{ id: string; token?: string }>;
      };
      assert.equal(listed.nodes.some((row) => row.id === body.id), true);
      assert.equal(listed.nodes.every((row) => row.token === undefined), true);

      const jobs = await app.request('/api/v1/workstation-bridge/jobs?wait=0', {
         headers: { authorization: `Bearer ${body.token}` },
      });
      assert.equal(jobs.status, 204);

      const refused = await app.request('/api/v1/workstation-bridge/jobs?wait=0', {
         headers: { authorization: 'Bearer berry_ws_not-a-token' },
      });
      assert.equal(refused.status, 401);

      const deleted = await session(`/api/v1/workstations/${body.id}`, { method: 'DELETE' });
      assert.equal(deleted.status, 204);
      const after = await app.request('/api/v1/workstation-bridge/jobs?wait=0', {
         headers: { authorization: `Bearer ${body.token}` },
      });
      assert.equal(after.status, 401);
   });
});
