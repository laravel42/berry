import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bundledPluginPackages } from './catalog.ts';
import { InvalidPluginInput } from './errors.ts';
import { loadPackage } from './loader.ts';
import type { PluginNetwork } from './net.ts';

test('the plugins directory is listed, including Customer.io', async () => {
   const packages = await bundledPluginPackages();
   const customerio = packages.find((pkg) => pkg.manifest.key === 'customerio');
   assert.ok(customerio);
   assert.equal(customerio.manifest.name, 'Customer.io');
   assert.equal(customerio.manifest.mcp?.offer, 'all');
   assert.equal(customerio.manifest.port, undefined);
   assert.equal(customerio.manifest.mcp?.protocolVersion, '2025-03-26');
   assert.equal(customerio.manifest.mcp?.servers?.us, 'https://mcp.customer.io/mcp');
   assert.equal(customerio.manifest.mcp?.servers?.eu, 'https://mcp-eu.customer.io/mcp');
   assert.deepEqual(customerio.manifest.secrets, []);
   assert.ok(customerio.manifest.config.some((field) => field.type === 'array' && field.key === 'REGION' && field.options?.join() === 'us,eu'));
   assert.ok(customerio.manifest.config.some((field) => field.type === 'secret' && field.key === 'API_KEY' && field.name === 'API Key'));
   assert.deepEqual(customerio.manifest.mcp?.tools, []);
   assert.equal(customerio.manifest.baseUrl, undefined);
});

test('installing the bundled Customer.io package does not require a base URL', async () => {
   const packages = await bundledPluginPackages();
   const customerio = packages.find((pkg) => pkg.manifest.key === 'customerio');
   assert.ok(customerio);
   const network: PluginNetwork = { request: async () => { throw new Error('not fetched'); } };
   const loaded = await loadPackage(network, { package: customerio });
   assert.equal(loaded.pkg.manifest.key, 'customerio');
   assert.equal(loaded.pkg.manifest.baseUrl, undefined);
   const other = { manifest: { ...customerio.manifest, key: 'other-plugin' } };
   await assert.rejects(() => loadPackage(network, { package: other }), (error: unknown) => error instanceof InvalidPluginInput);
});
