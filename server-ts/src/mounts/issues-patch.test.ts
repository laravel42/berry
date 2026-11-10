import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parsePatch, readBody, touchesIssueRow } from './issues.ts';

test('autoGate alone is a patch that writes the row', () => {
   // touchesIssueRow decides whether the update runs at all; a field it does
   // not know about is accepted and silently dropped.
   const { patch } = parsePatch({ autoGate: true });
   assert.equal(patch.autoGate, true);
   assert.equal(touchesIssueRow(patch), true);
   assert.equal(parsePatch({ autoGate: false }).patch.autoGate, false);
});

test('autoGate must be a boolean', () => {
   assert.throws(() => parsePatch({ autoGate: 'yes' }));
   assert.throws(() => parsePatch({ autoGate: null }));
});

test('a patch without autoGate leaves it alone', () => {
   assert.equal(parsePatch({ title: 'x' }).patch.autoGate, undefined);
});

test('the route accepts autoGate in a body, which it refused with a 422 before', async () => {
   // The unit tests above passed while every real request failed: the body is
   // checked against an allowlist of field names before parsePatch runs.
   const request = (body: unknown) =>
      new Request('http://berry.test/api/v1/issues/BER-1', { method: 'PATCH', body: JSON.stringify(body) });
   assert.deepEqual(await readBody(request({ autoGate: false })), { autoGate: false });
   assert.deepEqual(await readBody(request({ autoGate: true, title: 'x' })), { autoGate: true, title: 'x' });
   await assert.rejects(readBody(request({ autoGateway: true })));
});

test('startDate alone is a patch that writes the row, and null clears it', async () => {
   const { patch } = parsePatch({ startDate: '2026-11-10T00:00:00Z' });
   assert.equal(patch.startDateSet, true);
   assert.equal(patch.startDate, '2026-11-10T00:00:00.000Z');
   assert.equal(touchesIssueRow(patch), true);
   const cleared = parsePatch({ startDate: null }).patch;
   assert.equal(cleared.startDateSet, true);
   assert.equal(cleared.startDate, null);
   assert.equal(parsePatch({ title: 'x' }).patch.startDateSet, undefined);
   const request = new Request('http://berry.test/api/v1/issues/BER-1', {
      method: 'PATCH',
      body: JSON.stringify({ startDate: null }),
   });
   assert.deepEqual(await readBody(request), { startDate: null });
});

test('a start after the due date in one patch is refused', () => {
   assert.throws(
      () => parsePatch({ startDate: '2026-11-12T00:00:00Z', dueDate: '2026-11-10T00:00:00Z' }),
      (error: { status?: number }) => error.status === 422
   );
   assert.doesNotThrow(() => parsePatch({ startDate: '2026-11-10T00:00:00Z', dueDate: '2026-11-10T00:00:00Z' }));
   assert.throws(() => parsePatch({ startDate: '2026-11-10' }));
});
