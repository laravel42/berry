import assert from 'node:assert/strict';
import { test } from 'node:test';
import { usageEventIdentity } from './usage-identity.ts';

test('an old runtime usage frame has the same durable ID after a reconnect', () => {
   assert.equal(usageEventIdentity(undefined, 'session', 8), usageEventIdentity(undefined, 'session', 8));
   assert.notEqual(usageEventIdentity(undefined, 'session', 8), usageEventIdentity(undefined, 'session', 9));
   assert.notEqual(usageEventIdentity(undefined, 'session', 8), usageEventIdentity(undefined, 'other-session', 8));
   assert.equal(usageEventIdentity('provider-request', 'session', 8), 'provider-request');
});
