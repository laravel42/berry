import assert from 'node:assert/strict';
import { test } from 'node:test';

import { resolveTestMailRecipient } from './send-test.ts';

test('CLI recipient wins over env fallbacks', () => {
   assert.equal(
      resolveTestMailRecipient(['you@example.com'], {
         BERRY_MAIL_TEST_TO: 'fallback@example.com',
      }),
      'you@example.com'
   );
});

test('env is used only when no CLI address is given', () => {
   assert.equal(
      resolveTestMailRecipient([], { BERRY_MAIL_TEST_TO: 'fallback@example.com' }),
      'fallback@example.com'
   );
   assert.equal(resolveTestMailRecipient(['--dry-run'], { MAIL_TEST_TO: 'alt@example.com' }), 'alt@example.com');
   assert.equal(resolveTestMailRecipient([], { TEST_EMAIL_TO: 'third@example.com' }), 'third@example.com');
});

test('missing or invalid addresses yield null', () => {
   assert.equal(resolveTestMailRecipient([]), null);
   assert.equal(resolveTestMailRecipient(['not-an-email'], {}), null);
   assert.equal(resolveTestMailRecipient([], { BERRY_MAIL_TEST_TO: 'nope' }), null);
});
