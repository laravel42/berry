import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
   CLOUDFLARE_EMAIL_SMTP,
   cloudflareSmtpTransport,
   createConsoleMailer,
   magicLinkMail,
   resetPasswordMail,
} from './mailer.ts';

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

test('Cloudflare SMTP uses implicit TLS on 465 with the api_token username', () => {
   assert.equal(CLOUDFLARE_EMAIL_SMTP.host, 'smtp.mx.cloudflare.net');
   assert.equal(CLOUDFLARE_EMAIL_SMTP.port, 465);
   assert.equal(CLOUDFLARE_EMAIL_SMTP.secure, true);
   const transport = cloudflareSmtpTransport('cf-token-value');
   assert.equal(transport.host, 'smtp.mx.cloudflare.net');
   assert.equal(transport.port, 465);
   assert.equal(transport.secure, true);
   assert.deepEqual(transport.auth, { user: 'api_token', pass: 'cf-token-value' });
});
