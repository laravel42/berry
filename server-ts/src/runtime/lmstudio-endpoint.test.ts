import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { lmStudioBaseUrl, lmStudioEndpointLabel } from './lmstudio-endpoint.ts';

describe('LM Studio base URL', () => {
   test('keeps the documented address and adds /v1 to a bare origin', () => {
      assert.equal(lmStudioBaseUrl('http://localhost:1234/v1'), 'http://localhost:1234/v1');
      assert.equal(lmStudioBaseUrl('http://localhost:1234/v1/'), 'http://localhost:1234/v1');
      assert.equal(lmStudioBaseUrl('http://localhost:1234'), 'http://localhost:1234/v1');
      assert.equal(lmStudioBaseUrl(' http://192.168.1.20:1234/ '), 'http://192.168.1.20:1234/v1');
      assert.equal(lmStudioBaseUrl('https://lm.example.com/proxy/v1'), 'https://lm.example.com/proxy/v1');
      assert.equal(lmStudioBaseUrl('http://[::1]:1234/v1'), 'http://[::1]:1234/v1');
   });

   test('refuses what is not an HTTP server address', () => {
      for (const raw of [
         '',
         'localhost:1234',
         'file:///etc/passwd',
         'ftp://localhost/v1',
         'http://user:pass@localhost:1234/v1',
         'http://localhost:1234/v1?x=1',
         'http://localhost:1234/v1#frag',
      ]) {
         assert.equal(lmStudioBaseUrl(raw), null, raw);
      }
   });

   test('refuses cloud metadata and link-local addresses, however they are written', () => {
      for (const raw of [
         'http://169.254.169.254/latest',
         'http://169.254.170.2/v1',
         'http://2852039166/',
         'http://0xa9fea9fe/',
         'http://[fd00:ec2::254]/',
         'http://[fe80::1]:1234/v1',
         'http://[::ffff:169.254.169.254]/',
         'http://metadata.google.internal/computeMetadata/v1',
         'http://METADATA.GOOGLE.INTERNAL./',
         'http://100.100.100.200/',
         'http://0.0.0.0:1234/v1',
         'http://224.0.0.1/',
      ]) {
         assert.equal(lmStudioBaseUrl(raw), null, raw);
      }
   });

   test('labels a connection by host and port', () => {
      assert.equal(lmStudioEndpointLabel('http://localhost:1234/v1'), 'localhost:1234');
   });
});
