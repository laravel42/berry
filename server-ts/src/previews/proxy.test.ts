import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parsePreviewHost, previewOrigin, previewProxy } from './proxy.ts';

const ID = 'a'.repeat(20);
const DOMAIN = 'preview.localhost';

test('a preview host names its environment and app; nothing else is a preview host', () => {
   assert.deepEqual(parsePreviewHost(`p-${ID}-web.${DOMAIN}:4000`, DOMAIN), { id: ID, app: 'web' });
   assert.deepEqual(parsePreviewHost(`P-${ID}.PREVIEW.localhost`, DOMAIN), { id: ID, app: null });
   for (const host of ['localhost:4000', `p-${ID}-web.evil.test`, `p-short-web.${DOMAIN}`, `x.p-${ID}-web.${DOMAIN}`, `p-${ID}-Web_App.${DOMAIN}`, '', null]) {
      assert.equal(parsePreviewHost(host, DOMAIN), null, String(host));
   }
   assert.equal(previewOrigin({ domain: DOMAIN, scheme: 'http', port: 4000 }, ID, 'web'), `http://p-${ID}-web.${DOMAIN}:4000`);
   assert.equal(previewOrigin({ domain: 'pv.example.com', scheme: 'https', port: null }, ID, 'api'), `https://p-${ID}-api.pv.example.com`);
});

test('a request for Berry itself is not the proxy’s to answer', async () => {
   const proxy = previewProxy({ target: () => 1 }, DOMAIN, (async () => assert.fail('must not fetch')) as unknown as typeof fetch);
   assert.equal(await proxy(new Request('http://localhost:4000/api/v1/config', { headers: { host: 'localhost:4000' } })), null);
});

test('a preview request reaches its app with the path intact, without Berry’s session, framable', async () => {
   const seen: Array<{ url: string; headers: Headers; body: string }> = [];
   const upstream = (async (url: string, init: RequestInit) => {
      seen.push({ url, headers: new Headers(init.headers), body: init.body ? await new Response(init.body as ReadableStream).text() : '' });
      return new Response('<h1>app</h1>', { status: 201, headers: { 'content-type': 'text/html', 'x-frame-options': 'DENY', 'set-cookie': 'cart=1; Path=/', 'content-encoding': 'gzip' } });
   }) as unknown as typeof fetch;
   const asked: Array<[string, string | null]> = [];
   const proxy = previewProxy({ target: (id, app) => (asked.push([id, app]), 49200) }, DOMAIN, upstream);
   const response = (await proxy(
      new Request(`http://p-${ID}-web.${DOMAIN}:4000/_next/static/x.js?v=1`, {
         method: 'POST',
         body: 'payload',
         headers: { host: `p-${ID}-web.${DOMAIN}:4000`, cookie: 'berry.session_token=secret; cart=1; __Secure-berry.session_data=x', authorization: 'Bearer app-own-token' },
      })
   ))!;
   assert.deepEqual(asked, [[ID, 'web']]);
   assert.equal(seen[0]!.url, 'http://127.0.0.1:49200/_next/static/x.js?v=1');
   assert.equal(seen[0]!.body, 'payload');
   assert.equal(seen[0]!.headers.get('cookie'), 'cart=1');
   assert.equal(seen[0]!.headers.get('authorization'), 'Bearer app-own-token');
   assert.equal(response.status, 201);
   assert.equal(await response.text(), '<h1>app</h1>');
   assert.equal(response.headers.get('x-frame-options'), null);
   assert.equal(response.headers.get('content-encoding'), null);
   assert.equal(response.headers.get('set-cookie'), 'cart=1; Path=/');
});

test('an environment that is gone, or an app that does not answer, says so plainly', async () => {
   const host = { host: `p-${ID}.${DOMAIN}` };
   const gone = await previewProxy({ target: () => null }, DOMAIN)(new Request(`http://p-${ID}.${DOMAIN}/`, { headers: host }));
   assert.equal(gone!.status, 404);
   const down = await previewProxy({ target: () => 1 }, DOMAIN, (async () => { throw new Error('refused'); }) as unknown as typeof fetch)(new Request(`http://p-${ID}.${DOMAIN}/`, { headers: host }));
   assert.equal(down!.status, 502);
});
