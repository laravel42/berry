import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyFileEdit } from '../edit-file.ts';
import { parsePatch, patchTools, planPatch, type PatchStep } from './apply-patch.ts';

const ALL = new Set(['write_file', 'edit_file', 'delete_file', 'move_file']);

function patch(...lines: string[]): string {
   return ['*** Begin Patch', ...lines, '*** End Patch'].join('\n');
}

async function plan(text: string, files: Record<string, string>, available: ReadonlySet<string> = ALL) {
   const parsed = parsePatch(text);
   if ('error' in parsed) return parsed;
   return planPatch(parsed.operations, async (path) => files[path] ?? null, available);
}

/** Runs the planned steps against an in-memory tree, the way the tools would. */
function apply(files: Record<string, string>, steps: readonly PatchStep[]): Record<string, string> {
   const tree = { ...files };
   for (const step of steps) {
      if (step.tool === 'write_file') tree[step.input.path!] = step.input.content!;
      else if (step.tool === 'delete_file') delete tree[step.input.path!];
      else if (step.tool === 'move_file') {
         tree[step.input.to!] = tree[step.input.from!]!;
         delete tree[step.input.from!];
      } else {
         const edited = applyFileEdit(tree[step.input.path!]!, step.input.old!, step.input.new!);
         assert.ok(!('error' in edited), JSON.stringify(edited));
         tree[step.input.path!] = edited.content;
      }
   }
   return tree;
}

test('an added file is one write_file with the + lines', async () => {
   const planned = await plan(patch('*** Add File: src/new.ts', '+export const a = 1;', '+'), {});
   assert.ok('steps' in planned);
   assert.deepEqual(planned.steps, [
      { tool: 'write_file', input: { path: 'src/new.ts', content: 'export const a = 1;\n\n' }, path: 'src/new.ts' },
   ]);
});

test('an update becomes one edit_file per hunk, below its anchor', async () => {
   const files = {
      'src/maze.ts': 'function a() {\n   return 1;\n}\n\nfunction b() {\n   return 1;\n}\n',
   };
   const planned = await plan(
      patch('*** Update File: src/maze.ts', '@@ function b() {', '-   return 1;', '+   return 2;'),
      files
   );
   assert.ok('steps' in planned);
   assert.equal(planned.steps.length, 1);
   assert.equal(planned.steps[0]!.tool, 'edit_file');
   assert.deepEqual(apply(files, planned.steps), {
      'src/maze.ts': 'function a() {\n   return 1;\n}\n\nfunction b() {\n   return 2;\n}\n',
   });
});

test('a delete is delete_file, and a move is move_file followed by its hunks', async () => {
   const files = { 'old.ts': 'gone\n', 'src/a.ts': 'const x = 1;\nconst y = 2;\n' };
   const planned = await plan(
      patch(
         '*** Delete File: old.ts',
         '*** Update File: src/a.ts',
         '*** Move to: src/b.ts',
         '@@',
         ' const x = 1;',
         '-const y = 2;',
         '+const y = 3;'
      ),
      files
   );
   assert.ok('steps' in planned);
   assert.deepEqual(planned.steps.map((step) => step.tool), ['delete_file', 'move_file', 'edit_file']);
   assert.deepEqual(planned.steps[1]!.input, { from: 'src/a.ts', to: 'src/b.ts' });
   assert.deepEqual(apply(files, planned.steps), { 'src/b.ts': 'const x = 1;\nconst y = 3;\n' });
});

test('a multi-file patch applies every change in order, including an insertion at the end', async () => {
   const files = { 'a.txt': 'one\ntwo\nthree\n', 'b.txt': 'alpha\n' };
   const text = patch(
      '*** Update File: a.txt',
      '@@',
      ' one',
      '-two',
      '+TWO',
      '@@',
      ' three',
      '+four',
      '*** End of File',
      '*** Update File: b.txt',
      '-alpha',
      '+beta',
      '*** Add File: c.txt',
      '+gamma'
   );
   assert.deepEqual(patchTools(text), ['edit_file', 'write_file']);
   const planned = await plan(text, files);
   assert.ok('steps' in planned, JSON.stringify(planned));
   assert.deepEqual(apply(files, planned.steps), {
      'a.txt': 'one\nTWO\nthree\nfour\n',
      'b.txt': 'beta\n',
      'c.txt': 'gamma\n',
   });
});

test('a hunk whose lines repeat is widened until edit_file can find it once', async () => {
   const files = { 'x.ts': 'a\nsame\nb\nsame\n' };
   const planned = await plan(patch('*** Update File: x.ts', '@@ b', '-same', '+changed'), files);
   assert.ok('steps' in planned);
   assert.deepEqual(apply(files, planned.steps), { 'x.ts': 'a\nsame\nb\nchanged\n' });
});

test('a patch that fails anywhere plans nothing, and names the file and hunk', async () => {
   const files = { 'a.txt': 'one\n', 'b.txt': 'two\n' };
   const missing = await plan(
      patch('*** Update File: a.txt', '-one', '+ONE', '*** Update File: b.txt', '@@ two', '-nope', '+yes'),
      files
   );
   assert.deepEqual(Object.keys(missing), ['error']);
   assert.match((missing as { error: string }).error, /^b\.txt, hunk 1 \(@@ two\): /);

   const deleted = await plan(patch('*** Add File: ok.txt', '+ok', '*** Delete File: absent.txt'), files);
   assert.match((deleted as { error: string }).error, /absent\.txt: there is no file to delete/);

   const taken = await plan(patch('*** Update File: a.txt', '*** Move to: b.txt'), files);
   assert.match((taken as { error: string }).error, /cannot move to b\.txt, which already exists/);
});

test('paths outside the checkout, .git and .handoffs are refused before anything is planned', async () => {
   const files = { '.handoffs/BER-1 - task': 'note\n', 'a.txt': 'one\n' };
   for (const text of [
      patch('*** Add File: ../escape.txt', '+x'),
      patch('*** Delete File: .handoffs/BER-1 - task'),
      patch('*** Update File: a.txt', '*** Move to: .git/config'),
   ]) {
      const planned = await plan(text, files);
      assert.ok('error' in planned, text);
   }
});

test('a patch needs the Berry tools it would call', async () => {
   const planned = await plan(patch('*** Delete File: a.txt'), { 'a.txt': 'x\n' }, new Set(['write_file', 'edit_file']));
   assert.match((planned as { error: string }).error, /needs delete_file, which is not on this run/);
});

test('malformed patches are refused with the reason', () => {
   assert.match((parsePatch('*** Add File: a\n+x') as { error: string }).error, /starts with/);
   assert.match((parsePatch(patch('*** Add File: a', 'x')) as { error: string }).error, /starts with "\+"/);
   assert.match((parsePatch(patch('*** Update File: a', ' same')) as { error: string }).error, /at least one hunk/);
   assert.match((parsePatch(patch()) as { error: string }).error, /changes no file/);
   assert.deepEqual(patchTools('not a patch'), []);
});
