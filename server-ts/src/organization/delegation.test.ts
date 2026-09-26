import assert from 'node:assert/strict';
import { test } from 'node:test';

import { catalogRole } from './catalog.ts';
import { canDelegate } from './delegation.ts';

const role = (key: string) => {
   const found = catalogRole(key);
   assert.ok(found, key);
   return found;
};

test('the sender\'s contract decides; what the receiver lists is derived from senders', () => {
   assert.equal(canDelegate(role('engineering-manager'), role('backend-engineer')), true);
   assert.equal(canDelegate(role('backend-engineer'), role('engineering-manager')), false);
   // The receiver's stored list no longer vetoes: it is worked out from who hands it work.
   assert.equal(canDelegate({ ...role('engineering-manager') }, { ...role('backend-engineer'), receives_work_from: [] }), true);
});

test('the Orchestrator can route to every role', () => {
   for (const key of ['product-lead', 'sre', 'frontend-engineer', 'cto']) {
      assert.equal(canDelegate(role('orchestrator'), role(key)), true, key);
   }
});
