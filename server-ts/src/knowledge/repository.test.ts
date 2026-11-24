import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { closeDatabase, openDatabase, type Sql } from '../db/pool.ts';
import { cleanupWorld, seedWorld, type World } from '../work/fixture.ts';
import { excerptAround, KnowledgeCycle, KnowledgeRepository } from './repository.ts';

const url = process.env.BERRY_TEST_DATABASE_URL;

describe('knowledge base', { skip: url ? false : 'BERRY_TEST_DATABASE_URL is not set' }, () => {
   let sql: Sql;
   let world: World;
   let other: World;
   let knowledge: KnowledgeRepository;
   before(async () => {
      sql = openDatabase({ url: url as string });
      world = await seedWorld(sql, 'knowledge');
      other = await seedWorld(sql, 'knowledge-other');
      knowledge = new KnowledgeRepository(sql);
   });
   after(async () => {
      await sql`DELETE FROM knowledge_pages WHERE workspace_id IN (${world.workspaceId}, ${other.workspaceId})`;
      await cleanupWorld(sql, world);
      await cleanupWorld(sql, other);
      await closeDatabase(sql);
   });

   const create = (title: string, parentId: string | null = null, body = '') =>
      knowledge.create({ workspaceId: world.workspaceId, parentId, title, icon: null, body, userId: world.ownerId });

   test('pages nest, land last among their siblings, and stay in their workspace', async () => {
      const guide = await create('Guide');
      const first = await create('First', guide.id);
      const second = await create('Second', guide.id);
      assert.ok(second.sortOrder > first.sortOrder);

      const tree = await knowledge.tree(world.workspaceId);
      assert.deepEqual(
         tree.filter((page) => page.parentId === guide.id).map((page) => page.title),
         ['First', 'Second']
      );
      await assert.rejects(knowledge.get(other.workspaceId, guide.id));
      await assert.rejects(
         knowledge.create({ workspaceId: other.workspaceId, parentId: guide.id, title: 'x', icon: null, body: '', userId: other.ownerId })
      );
   });

   test('a page moves anywhere except under itself', async () => {
      const top = await create('Top');
      const child = await create('Child', top.id);
      const grandchild = await create('Grandchild', child.id);

      await assert.rejects(knowledge.update(world.workspaceId, top.id, { parentId: grandchild.id }, world.ownerId), KnowledgeCycle);
      await assert.rejects(knowledge.update(world.workspaceId, top.id, { parentId: top.id }, world.ownerId), KnowledgeCycle);

      const moved = await knowledge.update(world.workspaceId, grandchild.id, { parentId: null, title: 'Lifted' }, world.ownerId);
      assert.equal(moved.parentId, null);
      assert.equal(moved.title, 'Lifted');
   });

   test('delete trashes the subtree; restore brings back exactly that, at the top if its parent is gone', async () => {
      const root = await create('Root');
      const branch = await create('Branch', root.id);
      const leaf = await create('Leaf', branch.id);

      // The leaf goes on its own first, then the root takes the rest.
      await knowledge.trash(world.workspaceId, leaf.id, world.ownerId);
      await new Promise((resolve) => setTimeout(resolve, 5));
      await knowledge.trash(world.workspaceId, root.id, world.ownerId);
      const live = new Set((await knowledge.tree(world.workspaceId)).map((page) => page.id));
      assert.ok(![root.id, branch.id, leaf.id].some((id) => live.has(id)));

      const trash = await knowledge.trashed(world.workspaceId);
      const listed = new Map(trash.map((page) => [page.id, page]));
      assert.equal(listed.get(root.id)?.descendants, 1, 'the root went with its branch only');
      assert.ok(listed.has(leaf.id), 'the leaf was deleted on its own account');
      assert.ok(!listed.has(branch.id), 'the branch is shown under its root');

      await knowledge.restore(world.workspaceId, root.id);
      const after = new Set((await knowledge.tree(world.workspaceId)).map((page) => page.id));
      assert.ok(after.has(root.id) && after.has(branch.id));
      assert.ok(!after.has(leaf.id), 'the leaf stays in the Trash');

      // Restoring a page whose parent is in the Trash brings it to the top.
      await knowledge.trash(world.workspaceId, root.id, world.ownerId);
      const restoredLeaf = await knowledge.restore(world.workspaceId, leaf.id);
      assert.equal(restoredLeaf.parentId, null);
   });

   test('a cover is stored, read back and removed', async () => {
      const page = await create('Covered');
      assert.equal(page.cover, null);
      const withPreset = await knowledge.update(world.workspaceId, page.id, { cover: 'preset:dusk' }, world.ownerId);
      assert.equal(withPreset.cover, 'preset:dusk');
      assert.equal(await knowledge.cover(world.workspaceId, page.id), 'preset:dusk');
      await assert.rejects(
         knowledge.update(world.workspaceId, page.id, { cover: 'upload:../../etc/passwd' }, world.ownerId),
         /knowledge_pages_cover_ck/
      );
      const cleared = await knowledge.update(world.workspaceId, page.id, { cover: null }, world.ownerId);
      assert.equal(cleared.cover, null);
      await assert.rejects(knowledge.cover(other.workspaceId, page.id));
   });

   test('purge removes only what is in the Trash', async () => {
      const page = await create('Gone');
      await assert.rejects(knowledge.purge(world.workspaceId, page.id));
      await knowledge.trash(world.workspaceId, page.id, world.ownerId);
      await knowledge.purge(world.workspaceId, page.id);
      const [row] = await sql`SELECT id FROM knowledge_pages WHERE id = ${page.id}`;
      assert.equal(row, undefined);
   });

   test('search matches title or body, titles first, and treats % literally', async () => {
      await create('Deploy checklist', null, 'Run the smoke tests.');
      await create('Release notes', null, 'Before you deploy, tag the build.');
      await create('Discounts', null, 'Up to 50% off.');
      const hits = await knowledge.search(world.workspaceId, 'deploy');
      assert.deepEqual(hits.slice(0, 2).map((hit) => hit.title), ['Deploy checklist', 'Release notes']);
      assert.match(hits[1]!.excerpt, /deploy/i);
      assert.deepEqual((await knowledge.search(world.workspaceId, '50%')).map((hit) => hit.title), ['Discounts']);
      assert.deepEqual(await knowledge.search(world.workspaceId, '   '), []);
   });
});

test('an excerpt centres on the first match and marks what was cut', () => {
   const body = `${'a '.repeat(200)}needle ${'b '.repeat(200)}`;
   const excerpt = excerptAround(body, 'needle');
   assert.ok(excerpt.startsWith('…') && excerpt.endsWith('…'));
   assert.ok(excerpt.includes('needle'));
   assert.equal(excerptAround('short text', 'missing'), 'short text');
});
