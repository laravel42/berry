import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { TreeEntry } from '../integrations/github.ts';
import { findMerge, mergePrompt, planMerge } from './merge-plan.ts';

/**
 * Which runs become conflict-resolution runs, and what each file's fate is.
 *
 * No database and no GitHub: three trees, as maps from path to blob id. The
 * archive and the runtime half are exercised end to end in
 * `agents/runtime/container/merge-overlay.test.ts`.
 */

type Tree = Record<string, string | TreeEntry>;

function client(trees: Record<string, Tree>, base: { commit: string; behindBy: number } | null = { commit: 'base', behindBy: 1 }) {
   const asked: string[] = [];
   return {
      asked,
      mergeBase: async () => base,
      treeEntries: async (_owner: string, _name: string, commit: string) => {
         asked.push(commit);
         return new Map(
            Object.entries(trees[commit] ?? {}).map(([path, value]) => [
               path,
               typeof value === 'string' ? { sha: value, mode: '100644', type: 'blob', size: 100 } : value,
            ])
         );
      },
   };
}

const commits = { owner: 'berry', name: 'app', base: 'base', ours: 'ours', theirs: 'theirs' };

test('each file goes where a three-way merge would put it', async () => {
   const plan = await planMerge(
      client({
         base: { 'both.md': 'b0', 'ours.ts': 'o0', 'theirs.ts': 't0', 'same.ts': 's0', 'ours-deleted.ts': 'd0', 'theirs-deleted.ts': 'e0', 'fight.ts': 'f0' },
         ours: { 'both.md': 'b1', 'ours.ts': 'o1', 'theirs.ts': 't0', 'same.ts': 's1', 'theirs-deleted.ts': 'e0', 'fight.ts': 'f1', 'new.ts': 'n1' },
         theirs: { 'both.md': 'b2', 'ours.ts': 'o0', 'theirs.ts': 't1', 'same.ts': 's1', 'ours-deleted.ts': 'd0', 'other-new.ts': 'x1' },
      }),
      commits
   );
   assert.ok(plan);
   // Only the branch changed them: its version, or its deletion.
   assert.deepEqual(plan.take.map((file) => file.path), ['new.ts', 'ours.ts']);
   assert.deepEqual(plan.remove, ['ours-deleted.ts']);
   // Changed on both sides, differently — including a file one side deleted.
   assert.deepEqual(plan.conflicts.map((conflict) => conflict.path), ['both.md', 'fight.ts']);
   assert.equal(plan.conflicts[1]?.theirs, null);
   // `theirs.ts`, `other-new.ts`, `theirs-deleted.ts` and `same.ts` are the
   // default branch's already, or identical on both sides: nothing to do.
});

test('nothing changed on both sides is not a merge for an agent', async () => {
   const plan = await planMerge(client({ base: { 'a.ts': 'a0', 'b.ts': 'b0' }, ours: { 'a.ts': 'a1', 'b.ts': 'b0' }, theirs: { 'a.ts': 'a0', 'b.ts': 'b1' } }), commits);
   assert.equal(plan, null);
});

test('a mode change alone is a change', async () => {
   const executable: TreeEntry = { sha: 'r0', mode: '100755', type: 'blob', size: 10 };
   const plan = await planMerge(client({ base: { run: 'r0', 'c.md': 'c0' }, ours: { run: executable, 'c.md': 'c1' }, theirs: { run: 'r0', 'c.md': 'c2' } }), commits);
   assert.deepEqual(plan?.take.map((file) => [file.path, file.entry.mode]), [['run', '100755']]);
});

test('a merge Berry does not attempt leaves the run an ordinary one', async () => {
   const conflict = { base: { 'c.md': 'c0' }, ours: { 'c.md': 'c1' }, theirs: { 'c.md': 'c2' } };
   // A submodule on a side that changed.
   const submodule: TreeEntry = { sha: 'm1', mode: '160000', type: 'commit', size: 0 };
   assert.equal(await planMerge(client({ ...conflict, ours: { ...conflict.ours, vendor: submodule } }), commits), null);
   // More than a candidate can carry back.
   const huge: TreeEntry = { sha: 'h1', mode: '100644', type: 'blob', size: 5 * 1024 * 1024 };
   assert.equal(await planMerge(client({ ...conflict, ours: { ...conflict.ours, 'big.bin': huge } }), commits), null);
   // A path that would land in the reserved directory.
   assert.equal(await planMerge(client({ ...conflict, ours: { ...conflict.ours, '.berry-merge/x': 'x1' } }), commits), null);
});

test('a branch that is not behind, or shares no history, reads no trees', async () => {
   const trees = { base: { 'c.md': 'c0' }, ours: { 'c.md': 'c1' }, theirs: { 'c.md': 'c2' } };
   const heads = { owner: 'berry', name: 'app', branchHead: 'ours', defaultHead: 'theirs' };
   const upToDate = client(trees, { commit: 'theirs', behindBy: 0 });
   assert.equal(await findMerge(upToDate, heads), null);
   assert.deepEqual(upToDate.asked, []);
   assert.equal(await findMerge(client(trees, null), heads), null);
   assert.equal(await findMerge(client(trees), { ...heads, branchHead: 'theirs' }), null);
   // Behind, with a file both changed: the merge, from the three commits.
   const plan = await findMerge(client(trees), heads);
   assert.deepEqual([plan?.base, plan?.ours, plan?.theirs], ['base', 'ours', 'theirs']);
});

test('the run is told which files, what to keep, and that nothing may be dropped', () => {
   const prompt = mergePrompt({ baseBranch: 'main', branch: 'ada/gif-5-readme', conflicts: ['server/README.md'] });
   assert.match(prompt, /- server\/README\.md/);
   assert.match(prompt, /\.berry-merge\/STATUS\.md/);
   assert.match(prompt, /keep what this task added and keep what main\s+added/);
   assert.match(prompt, /Remove nothing the other task contributed/);
   assert.match(prompt, /run the checks/);
   // A long list is cut, and says where the rest is.
   const many = mergePrompt({ baseBranch: 'main', branch: 'b', conflicts: Array.from({ length: 60 }, (_, index) => `src/${index}.ts`) });
   assert.match(many, /and 10 more/);
});
