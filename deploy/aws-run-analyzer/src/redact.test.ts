import assert from 'node:assert/strict';
import { test } from 'node:test';
import { redact, redactText } from './redact.ts';

test('credentials in command output are replaced, the text around them kept', () => {
   const out = redactText(
      [
         'token berry_task_abcdef123456 used',
         'AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCY',
         'key AKIAIOSFODNN7EXAMPLE here',
         'Authorization: Bearer abcdefghijklmnopqrstuvwxyz012345',
         'postgres://berry:hunter22@127.0.0.1:5432/berry',
         'gh token ghp_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      ].join('\n')
   );
   assert.doesNotMatch(out, /abcdef123456|wJalrXUtn|AKIAIOSFODNN7EXAMPLE|abcdefghijklmnop|hunter22|ghp_a/);
   assert.match(out, /token \[redacted\] used/);
   assert.match(out, /AWS_SECRET_ACCESS_KEY=\[redacted\]/);
   assert.match(out, /Bearer \[redacted\]/);
   assert.match(out, /postgres:\/\/\[redacted\]@127\.0\.0\.1/);
});

test('source code that merely names a token is left as it is', () => {
   const code = "credential = { type: 'oauth', token: runtimeId === 'codex' ? CODEX_CLI_LOGIN : null, password: input.value }";
   assert.equal(redactText(code), code);
   assert.equal(redactText('BERRY_KILO_API_KEY: "kilo_live_abcdef"'), 'BERRY_KILO_API_KEY: [redacted]');
});

test('a private key block is removed whole', () => {
   const out = redactText('a\n-----BEGIN RSA PRIVATE KEY-----\nMIIE\nabc\n-----END RSA PRIVATE KEY-----\nb');
   assert.equal(out, 'a\n[redacted]\nb');
});

test('nested values are redacted and their keys and other types left alone', () => {
   const value = redact({ payload: { text: 'sk-abcdefghijklmnopqrstuvwxyz', n: 3, ok: true, list: ['ghp_bbbbbbbbbbbbbbbbbbbbbbbbbbbb'] } });
   assert.deepEqual(value, { payload: { text: '[redacted]', n: 3, ok: true, list: ['[redacted]'] } });
});
