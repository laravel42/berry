import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parsePatch, touchesIssueRow } from './issues.ts';

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
