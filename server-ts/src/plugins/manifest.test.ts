import assert from 'node:assert/strict';
import { test } from 'node:test';
import { InvalidPluginInput } from './errors.ts';
import { HELLO } from './fixture.test-support.ts';
import {
   describePackage,
   oauthAuthorizeParams,
   oauthClientId,
   oauthClientSecretName,
   oauthRefreshSecretName,
   oauthScopeList,
   oauthTokenSecretName,
   parsePackage,
   validateConfig,
} from './manifest.ts';

function fields(work: () => unknown): string[] {
   try {
      work();
   } catch (error) {
      assert.ok(error instanceof InvalidPluginInput);
      return error.fields.map((field) => field.path);
   }
   assert.fail('expected InvalidPluginInput');
}

test('a complete package parses with defaults filled in', () => {
   const pkg = parsePackage(HELLO);
   assert.equal(pkg.manifest.key, 'hello');
   assert.equal(pkg.manifest.description, '');
   assert.equal(pkg.manifest.hooks.length, 2);
   assert.equal(pkg.files.length, 1);
});

test('unknown manifest fields and bad keys are refused with their path', () => {
   assert.deepEqual(fields(() => parsePackage({ manifest: { ...HELLO.manifest, extra: 1 } })), ['/manifest']);
   assert.ok(fields(() => parsePackage({ manifest: { ...HELLO.manifest, key: 'Bad Key' } })).includes('/manifest/key'));
   assert.ok(fields(() => parsePackage({ manifest: { ...HELLO.manifest, scopes: ['admin'] } })).includes('/manifest/scopes/0'));
});

test('duplicate hook keys and path traversal are refused', () => {
   const hooks = [HELLO.manifest.hooks[0], HELLO.manifest.hooks[0]];
   assert.ok(fields(() => parsePackage({ manifest: { ...HELLO.manifest, hooks } })).includes('/manifest/hooks/1/key'));
   assert.ok(fields(() => parsePackage({ ...HELLO, files: [{ path: '../x', content: '' }] })).includes('/files/0/path'));
   const surfaces = [{ key: 'panel', title: 'P', path: '/a/../b' }];
   assert.ok(fields(() => parsePackage({ manifest: { ...HELLO.manifest, surfaces } })).includes('/manifest/surfaces/0/path'));
});

test('an array field stores one of its options', () => {
   const { manifest } = parsePackage({
      manifest: {
         ...HELLO.manifest,
         config: [
            { key: 'greeting', label: 'Greeting', type: 'string', required: true },
            { key: 'REGION', name: 'Region', label: 'Customer.io region (us or eu)', type: 'array', options: ['us', 'eu'], required: true },
         ],
      },
   });
   assert.deepEqual(validateConfig(manifest, { greeting: 'hi', REGION: 'eu' }), { greeting: 'hi', REGION: 'eu' });
   assert.ok(fields(() => validateConfig(manifest, { greeting: 'hi', REGION: 'ap' })).includes('/config/REGION'));
   const missing = { ...HELLO.manifest, config: [{ key: 'REGION', label: 'Region', type: 'array', required: true }] };
   assert.ok(fields(() => parsePackage({ manifest: missing })).includes('/manifest/config/0/options'));
});

test('config is checked against the manifest', () => {
   const { manifest } = parsePackage(HELLO);
   assert.deepEqual(validateConfig(manifest, { greeting: 'hi' }), { greeting: 'hi' });
   assert.deepEqual(fields(() => validateConfig(manifest, {})), ['/config/greeting']);
   assert.deepEqual(fields(() => validateConfig(manifest, { greeting: 1 })), ['/config/greeting']);
   assert.deepEqual(fields(() => validateConfig(manifest, { greeting: 'hi', other: 'x' })), ['/config/other']);
});

test('the preview names everything the admin is agreeing to', () => {
   const preview = describePackage(parsePackage(HELLO));
   assert.deepEqual(preview.scopes, ['issues:read', 'comments:write']);
   assert.deepEqual(preview.events, ['comment.created']);
   assert.deepEqual(preview.schedules, [{ key: 'nightly', everyMinutes: 1440 }]);
   assert.equal(preview.mcpOffer, 'declared');
   assert.equal(preview.mcpAuth, 'bearer');
   assert.equal(preview.available, false);
   assert.deepEqual(preview.mcpTools, ['say_hello']);
   assert.deepEqual(preview.files, [{ path: 'README.md', size: 7 }]);
});

test('a container plugin may omit the base URL; hooks and remote MCP may not', () => {
   const { baseUrl: _baseUrl, hooks: _hooks, surfaces: _surfaces, ...rest } = HELLO.manifest;
   const hosted = parsePackage({
      manifest: {
         ...rest,
         key: 'hosted',
         port: 8787,
         hooks: [],
         surfaces: [],
         mcp: { path: '/mcp', offer: 'all', tools: [] },
      },
   });
   assert.equal(hosted.manifest.baseUrl, undefined);
   assert.equal(describePackage(hosted).baseUrl, null);
   const assigned = parsePackage(
      {
         manifest: {
            ...rest,
            key: 'assigned',
            hooks: [],
            surfaces: [],
            mcp: { path: '/mcp', offer: 'all', tools: [] },
         },
      },
      { container: true }
   );
   assert.equal(assigned.manifest.port, undefined);
   assert.equal(assigned.manifest.baseUrl, undefined);
   assert.ok(fields(() => parsePackage({ manifest: { ...HELLO.manifest, baseUrl: undefined } })).includes('/manifest/baseUrl'));
   const remote = { ...rest, key: 'remote', hooks: [], surfaces: [], mcp: { path: '/mcp', offer: 'all', tools: [] } };
   assert.ok(fields(() => parsePackage({ manifest: remote })).includes('/manifest/baseUrl'));
});

test('an MCP server URL may carry a query; a plugin base URL may not', () => {
   const { baseUrl: _baseUrl, hooks: _hooks, surfaces: _surfaces, ...rest } = HELLO.manifest;
   const pkg = parsePackage({
      manifest: {
         ...rest,
         key: 'queried',
         hooks: [],
         surfaces: [],
         mcp: {
            path: '/mcp',
            offer: 'all',
            tools: [],
            servers: { default: 'https://mcp.example.com/mcp?mode=tools' },
         },
      },
   }, { container: true });
   assert.equal(pkg.manifest.mcp?.servers?.default, 'https://mcp.example.com/mcp?mode=tools');
   assert.equal(pkg.manifest.mcp?.auth, 'bearer');
   const gmail = parsePackage({
      manifest: {
         ...rest,
         key: 'gmail-scopes',
         hooks: [],
         surfaces: [],
         mcp: {
            path: '/mcp',
            offer: 'all',
            auth: 'oauth',
            tools: [],
            scopes: [
               'https://www.googleapis.com/auth/gmail.readonly',
               'https://www.googleapis.com/auth/gmail.compose',
            ],
            servers: { default: 'https://gmailmcp.googleapis.com/mcp/v1' },
         },
      },
   }, { container: true });
   assert.deepEqual(gmail.manifest.mcp?.scopes, [
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/gmail.compose',
   ]);
   assert.ok(fields(() => parsePackage({
      manifest: { ...HELLO.manifest, baseUrl: 'https://plugins.example.com/?x=1' },
   })).includes('/manifest/baseUrl'));
   assert.ok(fields(() => parsePackage({
      manifest: {
         ...rest,
         key: 'fragment',
         hooks: [],
         surfaces: [],
         mcp: { path: '/mcp', offer: 'all', tools: [], servers: { default: 'https://mcp.example.com/mcp#tools' } },
      },
   }, { container: true })).includes('/manifest/mcp/servers/default'));
});

test('oauth secret helpers prefer the token names a plugin declares', () => {
   const { manifest } = parsePackage({
      manifest: {
         ...HELLO.manifest,
         key: 'oauth-names',
         hooks: [],
         surfaces: [],
         secrets: [],
         config: [
            { key: 'CLIENT_ID', name: 'Client ID', label: 'Id', type: 'string', required: true },
            { key: 'CLIENT_SECRET', name: 'Client secret', label: 'Secret', type: 'secret', required: true },
            { key: 'API_KEY', name: 'Access token', label: 'Token', type: 'secret', required: false },
            { key: 'REFRESH_TOKEN', name: 'Refresh token', label: 'Refresh', type: 'secret', required: false },
         ],
      },
   }, { container: true });
   assert.equal(oauthTokenSecretName(manifest), 'API_KEY');
   assert.equal(oauthClientSecretName(manifest), 'CLIENT_SECRET');
   assert.equal(oauthRefreshSecretName(manifest), 'REFRESH_TOKEN');
   assert.equal(oauthClientId({ CLIENT_ID: ' google-client ' }), 'google-client');
   const authorized = parsePackage({
      manifest: {
         ...HELLO.manifest,
         key: 'oauth-extra',
         hooks: [],
         surfaces: [],
         secrets: [],
         config: [],
         mcp: {
            path: '/mcp',
            offer: 'all',
            auth: 'oauth',
            tools: [],
            authorize: { access_type: 'offline', prompt: 'consent' },
            servers: { default: 'https://mcp.example.com/mcp' },
         },
      },
   }, { container: true });
   assert.deepEqual(oauthAuthorizeParams(authorized.manifest), { access_type: 'offline', prompt: 'consent' });
   assert.equal(oauthScopeList(authorized.manifest), '');
   assert.equal(oauthScopeList({ ...authorized.manifest, mcp: { ...authorized.manifest.mcp, scopes: ['read', 'write'] } }), 'read write');
});
