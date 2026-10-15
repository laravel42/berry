const { test } = require('node:test');
const assert = require('node:assert/strict');
const { activate } = require('../dist/extension');
const tick = () => new Promise(resolve => setImmediate(resolve));
function setup(stored, responses = [], git) {
   const commands = new Map();
   const opened = [];
   const errors = [];
   let provider;
   let saved = stored;
   const context = { subscriptions: [], secrets: { get: async () => saved, store: async (_, value) => { saved = value; }, delete: async () => { saved = undefined; } } };
   const host = {
      EventEmitter: class { event = () => {}; fire() {} dispose() {} },
      commands: { registerCommand: (id, fn) => { commands.set(id, fn); return { dispose() {} }; } },
      window: { registerTreeDataProvider: (_, p) => { provider = p; return { dispose() {} }; }, showInputBox: async () => responses.shift(), showErrorMessage: m => errors.push(m) },
      Uri: { parse: url => url }, env: { openExternal: async url => { opened.push(url); return true; } },
      extensions: { getExtension: () => git }
   };
   activate(context, host);
   return { commands, opened, errors, items: () => provider.getChildren(), saved: () => saved };
}
test('disconnected, cancelled connection and disconnect are usable', async () => {
   const app = setup();
   await tick();
   assert.equal(app.items()[0].command.command, 'berry.connect');
   await app.commands.get('berry.connect')();
   assert.equal(app.saved(), undefined);
   await app.commands.get('berry.disconnect')();
   assert.equal(app.items()[0].label, 'Connect to Berry');
});
test('connect stores both values in secrets; task opens hosted URL; empty and errors recover', async () => {
   const original = global.fetch;
   let fail = false;
   let empty = false;
   global.fetch = async url => {
      if (fail) throw new Error('secret must not leak');
      const path = new URL(url).pathname;
      const data = path.endsWith('/auth/me') ? { id: 'person' } : { nodes: path.endsWith('/boards') ? [{ id: 'board', workspaceId: 'workspace' }] : path.endsWith('/workspaces') ? [{ id: 'workspace', slug: 'team' }] : empty ? [] : [{ id: 'issue', identifier: 'BER-1', title: 'Task', status: 'todo' }], pageInfo: { hasNextPage: false } };
      return { ok: true, json: async () => data };
   };
   try {
      const app = setup(undefined, ['https://berry.example', 'berry_pat_secret']);
      await tick();
      await app.commands.get('berry.connect')();
      assert.deepEqual(JSON.parse(app.saved()), { origin: 'https://berry.example', pat: 'berry_pat_secret' });
      assert.match(app.items()[0].label, /No GitHub remote/);
      await app.commands.get('berry.openTask')(...app.items()[1].command.arguments);
      assert.deepEqual(app.opened, ['https://berry.example/team/issue/issue']);
      empty = true;
      await app.commands.get('berry.refresh')();
      assert.equal(app.items()[1].label, 'You have no open tasks.');
      fail = true;
      await app.commands.get('berry.refresh')();
      assert.match(app.items()[0].label, /Cannot reach Berry/);
      assert.doesNotMatch(JSON.stringify(app.items()), /secret/);
      await app.commands.get('berry.disconnect')();
      assert.equal(app.saved(), undefined);
   } finally { global.fetch = original; }
});

test('matches the wire githubRepo field even when the workspace has no open tasks', async () => {
   const original = global.fetch;
   global.fetch = async url => {
      const path = new URL(url).pathname;
      const data = path.endsWith('/auth/me') ? { id: 'person' } : { nodes: path.endsWith('/workspaces') ? [{ id: 'workspace', slug: 'team' }] : path.endsWith('/projects') ? [{ id: 'project', name: 'Matched project', githubRepo: 'Owner/Repo' }] : [], pageInfo: { hasNextPage: false } };
      return { ok: true, json: async () => data };
   };
   try {
      const git = { activate: async () => ({ getAPI: () => ({ repositories: [{ state: { remotes: [{ fetchUrl: 'git@github.com:owner/repo.git' }] } }] }) }) };
      const app = setup(JSON.stringify({ origin: 'https://berry.example', pat: 'berry_pat_secret' }), [], git);
      await tick();
      assert.equal(app.items()[0].label, 'Folder projects: Matched project');
      assert.equal(app.items()[1].label, 'You have no open tasks.');
   } finally { global.fetch = original; }
});
