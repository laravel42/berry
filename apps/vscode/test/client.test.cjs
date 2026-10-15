const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Client, normalizeOrigin, repositoryName } = require('../dist/client');
test('rejects credential-bearing and non-origin URLs', () => {
   for (const url of ['http://host', 'https://user:pass@host', 'https://host/path', 'https://host?x=1']) assert.throws(() => normalizeOrigin(url));
   assert.equal(normalizeOrigin('https://berry.example/'), 'https://berry.example');
});
test('normalizes GitHub SSH and HTTPS remotes without GitHub authentication', () => {
   assert.equal(repositoryName('git@github.com:Owner/Repo.git'), 'owner/repo');
   assert.equal(repositoryName('https://github.com/Owner/Repo.git'), 'owner/repo');
   assert.equal(repositoryName('https://elsewhere/Owner/Repo'), undefined);
});
test('discovers boards, paginates and filters as the person', async () => {
   const calls = [];
   const fetcher = async (url, options) => {
      calls.push([url, options]);
      const path = new URL(url).pathname;
      const data = path.endsWith('/auth/me') ? { id: 'person' } : path.endsWith('/workspaces') ? { nodes: [{ id: 'workspace', slug: 'team' }], pageInfo: { hasNextPage: false } } : path.endsWith('/boards') ? { nodes: [{ id: 'board', workspaceId: 'workspace' }], pageInfo: { hasNextPage: false } } : { nodes: [{ id: 'task', title: 'Real task', identifier: 'BER-1', status: 'todo' }], pageInfo: { hasNextPage: false } };
      return { ok: true, json: async () => data };
   };
   const tasks = await new Client({ origin: 'https://berry.example', pat: 'secret' }, fetcher).tasks();
   assert.equal(tasks.length, 1);
   const url = new URL(calls[3][0]);
   assert.equal(url.searchParams.get('boardId'), 'board');
   assert.equal(url.searchParams.get('assigneeId'), 'person');
   assert.equal(url.searchParams.get('assigneeType'), 'user');
   for (const [, options] of calls) {
      assert.equal(options.headers.Authorization, 'Bearer secret');
      assert.equal(options.redirect, 'error');
      assert.equal(options.credentials, 'omit');
   }
});
test('error messages never include response bodies or token', async () => {
   await assert.rejects(new Client({ origin: 'https://berry.example', pat: 'secret' }, async () => ({ ok: false, status: 401 })).tasks(), /Reconnect/);
});
test('follows opaque cursors and rejects loops', async () => {
   const urls = [];
   const client = new Client({ origin: 'https://berry.example', pat: 'secret' }, async url => {
      urls.push(new URL(url));
      return { ok: true, json: async () => ({ nodes: [urls.length], pageInfo: { hasNextPage: urls.length === 1, endCursor: 'opaque+/=' } }) };
   });
   assert.deepEqual(await client.list('/boards'), [1, 2]);
   assert.equal(urls[1].searchParams.get('after'), 'opaque+/=');
   const looping = new Client({ origin: 'https://berry.example', pat: 'secret' }, async () => ({ ok: true, json: async () => ({ nodes: [], pageInfo: { hasNextPage: true, endCursor: 'same' } }) }));
   await assert.rejects(looping.list('/boards'), /pagination/);
});
