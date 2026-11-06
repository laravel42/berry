import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createConsoleMailer, magicLinkMail, resetPasswordMail } from './mailer.ts';

test('console mailer records the destination without throwing', async () => {
   const mailer = createConsoleMailer('Berry <noreply@localhost>');
   assert.equal(mailer.delivers, false);
   await mailer.send({
      to: 'ada@berry.test',
      subject: 'ping',
      text: 'hello',
   });
});

test('magic link and reset copy name the expiry', () => {
   const magic = magicLinkMail('https://berry.test/api/auth/magic-link/verify?token=abc');
   assert.match(magic.text, /15 minutes/);
   assert.match(magic.html, /abc/);

   const reset = resetPasswordMail('https://berry.test/reset-password?token=xyz');
   assert.match(reset.subject, /password/i);
   assert.match(reset.text, /xyz/);
});
