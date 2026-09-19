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
