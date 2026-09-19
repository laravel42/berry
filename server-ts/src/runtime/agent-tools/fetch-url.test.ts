import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { after, before, describe, test } from 'node:test';
import {
   DEFAULT_FETCH_LIMITS,
   FetchRefused,
   checkUrl,
   fetchPublicUrl,
   isBlockedAddress,
   readableHtml,
   type FetchLimits,
} from './fetch-url.ts';

/**
 * `fetch_url` is the server making a request an agent chose, from inside a
 * private network. What matters most is what it refuses.
 */

test('private, loopback, link-local and reserved addresses are blocked, in both families', () => {
   for (const address of [
      '127.0.0.1',
      '10.1.2.3',
      '172.20.0.1',
      '192.168.1.1',
      '169.254.169.254',
      '100.64.0.1',
      '0.0.0.0',
      '224.0.0.1',
      '::1',
      '::',
      'fe80::1',
      'fd00::1',
      '::ffff:127.0.0.1',
      '::ffff:7f00:1',
      '64:ff9b::10.0.0.1',
      'not-an-ip',
   ]) {
      assert.equal(isBlockedAddress(address), true, address);
   }
   for (const address of ['93.184.216.34', '1.1.1.1', '2606:4700:4700::1111', '::ffff:1.1.1.1']) {
      assert.equal(isBlockedAddress(address), false, address);
   }
});

test('a URL is refused for its scheme, its credentials or a private literal host, before any request', () => {
   const refused = (url: string, code: FetchRefused['code']) =>
      assert.throws(() => checkUrl(url, {}), (error: unknown) => error instanceof FetchRefused && error.code === code, url);
   refused('file:///etc/passwd', 'URL_NOT_ALLOWED');
   refused('ftp://example.com/', 'URL_NOT_ALLOWED');
   refused('javascript:alert(1)', 'URL_NOT_ALLOWED');
   refused('https://user:pass@example.com/', 'URL_NOT_ALLOWED');
   refused('not a url', 'URL_NOT_ALLOWED');
   refused('http://169.254.169.254/latest/meta-data/', 'ADDRESS_NOT_ALLOWED');
   refused('http://localhost:4000/', 'ADDRESS_NOT_ALLOWED');
   refused('http://db.internal/', 'ADDRESS_NOT_ALLOWED');
   // The URL parser normalises these to 127.0.0.1 before the check sees them.
   refused('http://2130706433/', 'ADDRESS_NOT_ALLOWED');
   refused('http://0x7f000001/', 'ADDRESS_NOT_ALLOWED');
   refused('http://[::ffff:127.0.0.1]/', 'ADDRESS_NOT_ALLOWED');
   assert.equal(checkUrl('https://emailbuilder.online/', {}).hostname, 'emailbuilder.online');
});

describe('fetching', () => {
   let server: Server;
   let origin = '';
   // Only this exact host is exempt; everything else is still checked.
   const limits: FetchLimits = { ...DEFAULT_FETCH_LIMITS, trustedHosts: ['127.0.0.1'] };

   before(async () => {
      server = createServer((request, response) => {
         const path = request.url ?? '/';
         if (path === '/page') {
            response.setHeader('content-type', 'text/html; charset=utf-8');
            response.end(
               '<!doctype html><html><head><title>Build &amp; send</title>' +
                  '<meta name="description" content="Drag, drop, send.">' +
                  '<link rel="stylesheet" href="/app.css"><style>.x{color:red}</style>' +
                  '<script>steal()</script></head><body><h1>Emails, <em>built</em></h1>' +
                  '<p>No code needed.</p><a href="/pricing">Pricing</a><h2>Features</h2></body></html>'
            );
         } else if (path === '/to-metadata') {
            response.writeHead(302, { location: 'http://169.254.169.254/latest/meta-data/' });
            response.end();
         } else if (path === '/to-page') {
            response.writeHead(301, { location: '/page' });
            response.end();
         } else if (path === '/loop') {
            response.writeHead(302, { location: '/loop' });
            response.end();
         } else if (path === '/big') {
            response.setHeader('content-type', 'text/plain');
            response.end('x'.repeat(5000));
         } else {
            response.statusCode = 404;
            response.end('nope');
         }
      }).listen(0, '127.0.0.1');
      await new Promise((resolve) => server.once('listening', resolve));
      origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
   });

   after(() => server.close());

   test('without the exemption, even the test server on loopback is refused', async () => {
      await assert.rejects(fetchPublicUrl(`${origin}/page`), (error: unknown) =>
         error instanceof FetchRefused && error.code === 'ADDRESS_NOT_ALLOWED');
   });

   test('a name that resolves to loopback is refused at connect time, not by its spelling', async () => {
      const port = new URL(origin).port;
      // `localhost.` slips past the name check; the guarded lookup catches the address.
      await assert.rejects(fetchPublicUrl(`http://localhost.:${port}/page`), (error: unknown) =>
         error instanceof FetchRefused && error.code === 'ADDRESS_NOT_ALLOWED');
   });

   test('a page is fetched, and redirects are followed', async () => {
      const page = await fetchPublicUrl(`${origin}/to-page`, limits);
      assert.equal(page.status, 200);
      assert.equal(page.url, `${origin}/page`);
      assert.match(page.contentType, /text\/html/);
      assert.match(page.body.toString('utf8'), /<h1>/);
   });

   test('a redirect to a private address is refused, however the first hop looked', async () => {
      await assert.rejects(fetchPublicUrl(`${origin}/to-metadata`, limits), (error: unknown) =>
         error instanceof FetchRefused && error.code === 'ADDRESS_NOT_ALLOWED');
   });

   test('redirects are bounded', async () => {
      await assert.rejects(fetchPublicUrl(`${origin}/loop`, limits), (error: unknown) =>
         error instanceof FetchRefused && error.code === 'TOO_MANY_REDIRECTS');
   });

   test('a body past the size cap is cut there, and says so', async () => {
      const page = await fetchPublicUrl(`${origin}/big`, { ...limits, maxBytes: 1000 });
      assert.equal(page.truncated, true);
      assert.equal(page.body.length, 1000);
   });
});

test('a readable page keeps the outline, links and stylesheets, and drops scripts and styles', () => {
   const page = readableHtml(
      '<html><head><title>Build &amp; send</title><meta name="description" content="Drag, drop, send.">' +
         '<link rel="stylesheet" href="/app.css"><style>.x{color:red}</style><script>steal()</script></head>' +
         '<body><h1>Emails, <em>built</em></h1><p>No code&nbsp;needed.</p><a href="/pricing">Pricing</a>' +
         '<h2>Features</h2></body></html>',
      'https://emailbuilder.online/'
   );
   assert.equal(page.title, 'Build & send');
   assert.equal(page.description, 'Drag, drop, send.');
   assert.deepEqual(page.headings, [
      { level: 1, text: 'Emails, built' },
      { level: 2, text: 'Features' },
   ]);
   assert.deepEqual(page.links, [{ href: 'https://emailbuilder.online/pricing', text: 'Pricing' }]);
   assert.deepEqual(page.stylesheets, ['https://emailbuilder.online/app.css']);
   assert.match(page.text, /No code needed\./);
   assert.doesNotMatch(page.text, /steal|color:red/);
});
