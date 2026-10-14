import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createApp } from '../http/app.ts';
import { Registry } from '../http/registry.ts';
import { bridgeInstallMounts } from './bridge-install.ts';

function app() {
   const registry = new Registry();
   registry.registerAll(bridgeInstallMounts({ origin: 'https://berry.example' }));
   return createApp(registry);
}

test('GET /install/berry-bridge is a public wget script for this origin', async () => {
   const response = await app().request('/install/berry-bridge');
   assert.equal(response.status, 200);
   assert.match(response.headers.get('content-type') ?? '', /text\/plain/);
   const body = await response.text();
   assert.match(body, /wget/);
   assert.match(body, /https:\/\/berry\.example/);
   assert.equal(body.includes('berry_ws_'), false);
});

test('GET /install/berry-bridge.tgz is a public gzip archive', async () => {
   const response = await app().request('/install/berry-bridge.tgz');
   assert.equal(response.status, 200);
   assert.equal(response.headers.get('content-type'), 'application/gzip');
   const bytes = Buffer.from(await response.arrayBuffer());
   assert.equal(bytes[0], 0x1f);
   assert.equal(bytes[1], 0x8b);
});
