import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bundledPluginPackages } from './catalog.ts';
import { InvalidPluginInput } from './errors.ts';
import { loadPackage } from './loader.ts';
import { describePackage, pluginCatalogAvailable } from './manifest.ts';
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
   assert.ok(customerio.manifest.config.some((field) => field.type === 'secret' && field.key === 'API_KEY' && field.name === 'Access token'));
   assert.equal(customerio.manifest.mcp?.auth, 'oauth');
   assert.deepEqual(customerio.manifest.mcp?.scopes, ['read', 'write']);
   assert.deepEqual(customerio.manifest.mcp?.tools, []);
   assert.equal(customerio.manifest.baseUrl, undefined);
   const gmail = packages.find((pkg) => pkg.manifest.key === 'gmail');
   assert.ok(gmail);
   assert.equal(gmail.manifest.mcp?.auth, 'oauth');
   assert.equal(gmail.manifest.mcp?.servers?.default, 'https://gmailmcp.googleapis.com/mcp/v1');
   assert.deepEqual(gmail.manifest.mcp?.scopes, [
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/gmail.compose',
   ]);
   assert.ok(gmail.manifest.config.some((field) => field.type === 'secret' && field.key === 'API_KEY' && field.required === false));
   assert.ok(gmail.manifest.config.some((field) => field.type === 'secret' && field.key === 'REFRESH_TOKEN' && field.required === false));
   assert.equal(gmail.manifest.config.some((field) => field.key === 'CLIENT_ID'), false);
   assert.deepEqual(gmail.manifest.mcp?.authorize, { access_type: 'offline', prompt: 'consent' });
   const github = packages.find((pkg) => pkg.manifest.key === 'github');
   assert.ok(github);
   assert.equal(github.manifest.mcp?.auth, 'oauth');
   assert.equal(github.manifest.mcp?.servers?.default, 'https://api.githubcopilot.com/mcp/');
   assert.deepEqual(github.manifest.mcp?.scopes, [
      'repo',
      'read:org',
      'read:user',
      'user:email',
      'offline_access',
   ]);
   assert.ok(github.manifest.config.some((field) => field.type === 'secret' && field.key === 'API_KEY' && field.required === false));
   const dcr = [
      'adobe', 'ahrefs', 'airtable', 'amplitude', 'apollo', 'atlassian', 'attio', 'calendly',
      'clay', 'clickhouse', 'close', 'context7', 'datadog', 'deepnote', 'descript', 'dropbox',
      'fever', 'figma', 'fireflies', 'gamma', 'granola', 'hex', 'heygen', 'hg-insights',
      'higgsfield', 'hostinger-mail', 'klaviyo', 'linear', 'lovable', 'magicpath', 'metricool',
      'mixpanel', 'mobbin', 'monday', 'motherduck', 'neon', 'notion', 'otter', 'outreach',
      'plaud', 'posthog', 'quicknode', 'railway', 'runway', 'scite', 'similarweb', 'statsig',
      'stripe', 'supabase', 'superhuman-mail', 'tinyfish', 'todoist', 'trello', 'tripsy',
      'vercel', 'vidiq', 'webflow', 'windsor', 'wix', 'wordpress',
   ];
   for (const key of dcr) {
      const pkg = packages.find((item) => item.manifest.key === key);
      assert.ok(pkg, key);
      assert.equal(pkg.manifest.mcp?.auth, 'oauth', key);
      assert.ok(pkg.manifest.config.some((field) => field.key === 'API_KEY' && field.type === 'secret' && field.required === false), key);
      assert.ok(pkg.manifest.config.some((field) => field.key === 'REFRESH_TOKEN' && field.type === 'secret' && field.required === false), key);
   }
   assert.deepEqual(packages.find((pkg) => pkg.manifest.key === 'linear')?.manifest.mcp?.scopes, ['read', 'write']);
   assert.deepEqual(packages.find((pkg) => pkg.manifest.key === 'notion')?.manifest.mcp?.scopes, ['default']);
   assert.equal(describePackage(customerio).available, true);
   assert.equal(pluginCatalogAvailable(gmail.manifest), true);
   const slack = packages.find((pkg) => pkg.manifest.key === 'slack');
   assert.ok(slack);
   assert.equal(pluginCatalogAvailable(slack.manifest), false);
   const firecrawl = packages.find((pkg) => pkg.manifest.key === 'firecrawl');
   assert.ok(firecrawl);
   assert.equal(pluginCatalogAvailable(firecrawl.manifest), true);
   const shop = packages.find((pkg) => pkg.manifest.key === 'shop');
   assert.ok(shop);
   assert.equal(pluginCatalogAvailable(shop.manifest), false);
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
