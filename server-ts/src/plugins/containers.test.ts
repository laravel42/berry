import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { apiUrlFromContainer, ASSIGNED_PLUGIN_PORT, pluginContainers, type DockerResult } from './containers.ts';

function layout(): { root: string; sdk: string } {
   const root = mkdtempSync(join(tmpdir(), 'berry-plugins-'));
   const sdk = mkdtempSync(join(tmpdir(), 'berry-sdk-'));
   mkdirSync(join(root, 'customerio'));
   writeFileSync(join(root, 'customerio', 'Dockerfile'), 'FROM scratch\n');
   writeFileSync(join(root, 'customerio', 'manifest.json'), JSON.stringify({ key: 'customerio' }));
   mkdirSync(join(root, 'plain'));
   writeFileSync(join(root, 'plain', 'manifest.json'), JSON.stringify({ key: 'plain' }));
   return { root, sdk };
}

test('a plugin without a Dockerfile is not started', async () => {
   const { root, sdk } = layout();
   const calls: string[][] = [];
   const containers = pluginContainers({
      root, sdkDir: sdk, publishAddr: '127.0.0.1', hostAddr: '127.0.0.1',
      docker: async (args) => {
         calls.push(args);
         return { code: 0, output: '' };
      },
   });
   assert.equal(await containers.ensure({ key: 'plain' }), null);
   assert.deepEqual(calls, []);
});

test('a running container is reused', async () => {
   const { root, sdk } = layout();
   const calls: string[][] = [];
   const containers = pluginContainers({
      root, sdkDir: sdk, publishAddr: '127.0.0.1', hostAddr: '127.0.0.1',
      fetch: (async () => new Response('no', { status: 404 })) as typeof fetch,
      docker: async (args) => {
         calls.push(args);
         return { code: 0, output: '127.0.0.1:49152\n' };
      },
   });
   assert.equal(await containers.ensure({ key: 'customerio' }), 'http://127.0.0.1:49152');
   assert.deepEqual(calls, [['port', 'berry-plugin-customerio', `${ASSIGNED_PLUGIN_PORT}/tcp`]]);
});

test('a missing container is built and started', async () => {
   const { root, sdk } = layout();
   const calls: string[][] = [];
   const containers = pluginContainers({
      root, sdkDir: sdk, publishAddr: '127.0.0.1', hostAddr: '127.0.0.1',
      fetch: (async () => new Response('', { status: 404 })) as typeof fetch,
      docker: async (args): Promise<DockerResult> => {
         calls.push(args);
         if (args[0] === 'port' && calls.filter((call) => call[0] === 'port').length === 1) return { code: 1, output: '' };
         if (args[0] === 'port') return { code: 0, output: '127.0.0.1:49153\n' };
         return { code: 0, output: '' };
      },
   });
   assert.equal(await containers.ensure({ key: 'customerio' }), 'http://127.0.0.1:49153');
   assert.equal(calls[1]?.[0], 'build');
   assert.ok(calls[1]?.includes(`sdk=${sdk}`));
   assert.equal(calls[3]?.[0], 'run');
   assert.ok(calls[3]?.includes(`127.0.0.1::${ASSIGNED_PLUGIN_PORT}`));
   assert.ok(calls[3]?.includes(`PORT=${ASSIGNED_PLUGIN_PORT}`));
   assert.ok(calls[3]?.includes('host.docker.internal:host-gateway'));
});

test('a loopback Berry address is rewritten for the container', () => {
   assert.equal(apiUrlFromContainer('http://127.0.0.1:4000'), 'http://host.docker.internal:4000');
   assert.equal(apiUrlFromContainer('http://localhost:4000/'), 'http://host.docker.internal:4000');
   assert.equal(apiUrlFromContainer('https://berry.example.com'), 'https://berry.example.com');
   assert.equal(apiUrlFromContainer(null), null);
});
