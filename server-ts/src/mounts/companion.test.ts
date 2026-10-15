import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Hono } from 'hono';
import { companionMount } from './companion.ts';
import type { Sql } from '../db/pool.ts';
import type { SessionService } from '../auth/sessions.ts';
import type { IdempotencyStore } from '../http/idempotency.ts';
import type { Companion } from '../runtime/companion.ts';
import { ApiError } from '../http/errors.ts';

function fixture() {
   let updates = 0;
   let authentications = 0;
   const sessions = { async resolveRequest() { authentications++; return { id: 'person' }; } } as unknown as SessionService;
   const companion = { async update() { updates++; return { cancel: false, nextSequence: 1 }; } } as unknown as Companion;
   const mount = companionMount({ sql: {} as Sql, sessions, companion, idempotency: {} as IdempotencyStore });
   const app = new Hono();
   app.onError(error => new Response(null, { status: error instanceof ApiError ? error.status : 500 }));
   app.route(mount.prefix, mount.handler);
   return { app, updates: () => updates, authentications: () => authentications };
}
const runId = '9d4049dd-f9c4-486d-a53e-75cdcd52f281';
const claim = '931cf034-935e-42d3-86bd-f11330b022aa';
test('companion control accepts PAT headers only, never cookies or task/plugin tokens', async () => {
   const { app, updates, authentications } = fixture();
   for (const authorization of ['', 'Bearer berry_task_test', 'Bearer plugin_test', 'Basic berry_pat_test']) {
      const response = await app.request('/api/v1/companion/' + runId + '/heartbeat', { method: 'POST', headers: { authorization, cookie: 'session=present', 'content-type': 'application/json' }, body: JSON.stringify({ claim }) });
      assert.equal(response.status, 401);
   }
   assert.equal(updates(), 0);
   assert.equal(authentications(), 0);
});
test('lifecycle boundary validates IDs, sequence, event shapes and unknown fields', async () => {
   const { app, updates } = fixture();
   for (const body of [ { claim, sequence: -1, event: { type: 'task.started' } }, { claim, sequence: 0, event: { type: 'invented' } }, { claim, sequence: 0, event: { type: 'task.started' }, pat: 'must-not-enter-envelope' } ]) {
      const response = await app.request('/api/v1/companion/' + runId + '/events', { method: 'POST', headers: { authorization: 'Bearer berry_pat_test', 'content-type': 'application/json' }, body: JSON.stringify(body) });
      assert.equal(response.status, 422);
   }
   assert.equal(updates(), 0);
   const response = await app.request('/api/v1/companion/' + runId + '/events', { method: 'POST', headers: { authorization: 'Bearer berry_pat_test', 'content-type': 'application/json' }, body: JSON.stringify({ claim, sequence: 0, event: { type: 'task.started' } }) });
   assert.equal(response.status, 200);
   assert.equal(response.headers.get('cache-control'), 'no-store');
   assert.equal(updates(), 1);
});
