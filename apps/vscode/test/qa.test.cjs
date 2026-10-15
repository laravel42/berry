const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { activate } = require('../dist/extension');
const { Client } = require('../dist/client');
const tick = () => new Promise(resolve => setImmediate(resolve));
const token = 'berry_pat_QA_SENTINEL_NOT_A_CREDENTIAL';
const page = nodes => ({ nodes, pageInfo: { hasNextPage: false } });

// Test-only contract recording, authored from gateway-v1; not a live account capture.
const recording = {
   '/api/v1/auth/me': { id: 'person' },
   '/api/v1/boards': page([{ id: 'board', workspaceId: 'workspace' }]),
   '/api/v1/workspaces': page([{ id: 'workspace', slug: 'my-team' }]),
   '/api/v1/projects': page([{ id: 'project', name: 'Folder project', githubRepo: 'Owner/Repo' }]),
   '/api/v1/issues': page([{ id: 'issue-uuid', identifier: 'BER-101', title: 'Assigned task', status: 'inProgress' }])
};
function hostFixture(stored, answers = []) {
   const commands = new Map(), opened = [], visible = [], prompts = [], writes = [];
   let provider;
   const secrets = new Map(stored ? [['berry.connection', stored]] : []);
   const host = {
      EventEmitter: class { event = () => {}; fire() {} dispose() {} },
      commands: { registerCommand(id, fn) { commands.set(id, fn); return { dispose() {} }; } },
      workspace: { getConfiguration: () => ({ update: (...args) => writes.push(args) }) },
      window: {
         registerTreeDataProvider(_, value) { provider = value; return { dispose() {} }; },
         async showInputBox(options) { prompts.push(options); return answers.shift(); },
         showErrorMessage: message => visible.push(message)
      },
      extensions: { getExtension: () => ({ activate: async () => ({ getAPI: () => ({ repositories: [{ state: { remotes: [{ fetchUrl: 'git@github.com:Owner/Repo.git' }] } }] }) }) }) },
      Uri: { parse: value => value },
      env: { openExternal: async value => { opened.push(value); return true; } }
   };
   const context = {
      subscriptions: [], globalState: { update: (...args) => writes.push(args) },
      workspaceState: { update: (...args) => writes.push(args) },
      secrets: { get: async key => secrets.get(key), store: async (key, value) => secrets.set(key, value), delete: async key => secrets.delete(key) }
   };
   activate(context, host);
   return { commands, opened, visible, prompts, writes, secrets, items: () => provider.getChildren() };
}

test('recorded Connect/Refresh/Open/Disconnect journey confines PAT to SecretStorage and Bearer', async t => {
   const calls = [], logs = [];
   for (const method of ['log', 'error', 'warn', 'info', 'debug']) t.mock.method(console, method, (...args) => logs.push(args));
   let mode = 'tasks';
   t.mock.method(global, 'fetch', async (value, options) => {
      const url = new URL(value);
      calls.push({ url, options });
      assert.equal(url.origin, 'https://berry.example');
      assert.ok(url.pathname.startsWith('/api/v1/'));
      assert.equal(options.headers.Authorization, 'Bearer ' + token);
      assert.equal(options.redirect, 'error');
      assert.equal(options.credentials, 'omit');
      assert.ok(options.signal);
      assert.ok(!value.includes(token));
      if (mode === 'denied') return { ok: false, status: 401, json: async () => ({ message: token }) };
      if (url.pathname.endsWith('/issues')) {
         assert.equal(url.searchParams.get('assigneeId'), 'person');
         assert.equal(url.searchParams.get('assigneeType'), 'user');
         assert.equal(url.searchParams.get('status'), 'backlog,todo,inProgress,inReview,blocked');
         assert.equal(url.searchParams.get('boardId'), 'board');
         return { ok: true, json: async () => mode === 'empty' ? page([]) : recording[url.pathname] };
      }
      assert.ok(recording[url.pathname], 'unexpected route');
      return { ok: true, json: async () => recording[url.pathname] };
   });
   const app = hostFixture(undefined, ['https://berry.example', token]);
   await tick();
   assert.equal(calls.length, 0);
   assert.equal(app.items()[0].command.command, 'berry.connect');
   await app.commands.get('berry.connect')();
   assert.equal(app.prompts[1].password, true);
   assert.deepEqual(JSON.parse(app.secrets.get('berry.connection')), { origin: 'https://berry.example', pat: token });
   assert.equal(app.items()[0].label, 'Folder projects: Folder project');
   assert.equal(app.items()[1].label, 'BER-101 Assigned task');
   await app.commands.get('berry.openTask')(...app.items()[1].command.arguments);
   assert.deepEqual(app.opened, ['https://berry.example/my-team/issue/BER-101']);
   mode = 'empty';
   await app.commands.get('berry.refresh')();
   assert.equal(app.items()[1].label, 'You have no open tasks.');
   mode = 'denied';
   await app.commands.get('berry.refresh')();
   assert.match(app.items()[0].label, /Reconnect/);
   mode = 'tasks';
   await app.commands.get('berry.refresh')();
   assert.equal(app.items()[1].label, 'BER-101 Assigned task');
   await app.commands.get('berry.disconnect')();
   assert.equal(app.secrets.size, 0);
   assert.equal(app.items()[0].label, 'Connect to Berry');
   assert.deepEqual(app.writes, []);
   assert.ok(!JSON.stringify([logs, app.items(), app.visible, app.opened, app.prompts]).includes(token));
   const source = fs.readFileSync(require.resolve('../dist/extension'), 'utf8');
   assert.doesNotMatch(source, /console\.|settings\.json|writeFile|appendFile/);
});

test('malformed saved state and cancelled PAT do not disclose or persist input', async () => {
   const app = hostFixture(token, ['https://berry.example', undefined]);
   await tick();
   assert.ok(!JSON.stringify(app.items()).includes(token));
   await app.commands.get('berry.connect')();
   assert.equal(app.secrets.get('berry.connection'), token);
   assert.deepEqual(app.writes, []);
});

test('late responses cannot repopulate a disconnected tree', async t => {
   let resolve;
   t.mock.method(global, 'fetch', () => new Promise(done => { resolve = done; }));
   const app = hostFixture(JSON.stringify({ origin: 'https://berry.example', pat: token }));
   await tick();
   await app.commands.get('berry.disconnect')();
   resolve({ ok: false, status: 401 });
   await tick();
   assert.equal(app.items()[0].label, 'Connect to Berry');
});

test('task pagination keeps every board and opaque cursor scoped to the signed-in person', async () => {
   const calls = [];
   const client = new Client({ origin: 'https://berry.example', pat: token }, async value => {
      const url = new URL(value);
      calls.push(url);
      let data = recording[url.pathname];
      if (url.pathname.endsWith('/boards')) data = page([{ id: 'board', workspaceId: 'workspace' }, { id: 'second', workspaceId: 'workspace' }]);
      if (url.pathname.endsWith('/issues')) {
         const board = url.searchParams.get('boardId');
         const after = url.searchParams.get('after');
         assert.equal(url.searchParams.get('assigneeId'), 'person');
         assert.equal(url.searchParams.get('assigneeType'), 'user');
         assert.equal(url.searchParams.get('first'), '100');
         data = board === 'board' && !after
            ? { nodes: [{ identifier: 'BER-1' }], pageInfo: { hasNextPage: true, endCursor: 'opaque+/=' } }
            : page([{ identifier: board === 'second' ? 'BER-3' : 'BER-2' }]);
      }
      return { ok: true, json: async () => data };
   });
   const tasks = await client.tasks();
   assert.deepEqual(tasks.map(task => task.identifier), ['BER-1', 'BER-2', 'BER-3']);
   assert.ok(tasks.every(task => task.workspaceSlug === 'my-team'));
   const issues = calls.filter(url => url.pathname.endsWith('/issues'));
   assert.equal(issues[1].searchParams.get('after'), 'opaque+/=');
   assert.equal(issues[2].searchParams.has('after'), false);
});

test('HTTP failures and malformed JSON redact response bodies and transport exceptions', async () => {
   for (const status of [401, 403, 429, 500]) {
      const client = new Client({ origin: 'https://berry.example', pat: token }, async () => ({ ok: false, status, json: async () => ({ message: token }) }));
      await assert.rejects(client.tasks(), error => !error.message.includes(token));
   }
   const client = new Client({ origin: 'https://berry.example', pat: token }, async () => ({ ok: true, json: async () => { throw new Error(token); } }));
   await assert.rejects(client.tasks(), /Cannot reach Berry/);
});
