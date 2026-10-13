import assert from 'node:assert/strict';
import { test } from 'node:test';
import { artifactPathSchema, removablePath, savedOnTask, textSlice } from './core-tools.ts';

test('a relative file path is accepted, nested or not', () => {
   for (const path of ['report.md', 'epg/start.js', 'src/main/index.ts', '.env.example', 'user:preferences.json']) {
      assert.equal(artifactPathSchema.safeParse(path).success, true, path);
   }
});

test('a path the run_artifacts column would refuse is refused first, with what to send instead', () => {
   for (const path of [
      '/tmp/epg/start.js',
      'epg/',
      'epg//start.js',
      '../start.js',
      'epg/./start.js',
      'epg/..',
      'epg\\start.js',
      ' start.js',
      'start.js\n',
      'user:/preferences.json',
      'a'.repeat(1025),
   ]) {
      const parsed = artifactPathSchema.safeParse(path);
      assert.equal(parsed.success, false, JSON.stringify(path));
   }
   const refused = artifactPathSchema.safeParse('/tmp/epg/start.js');
   assert.match(refused.error?.issues[0]?.message ?? '', /relative to the task/);
});

test('a long fetched text comes a slice at a time, with where the next one starts', () => {
   const text = 'a'.repeat(25);
   assert.deepEqual(textSlice(text, 0, 10), { text: `${'a'.repeat(10)}\n[truncated]`, nextFrom: 10 });
   assert.deepEqual(textSlice(text, 20, 10), { text: 'a'.repeat(5) });
   assert.deepEqual(textSlice('short', 0, 10), { text: 'short' });
   assert.deepEqual(textSlice(text, 0, 10, false), { text: 'a'.repeat(10), nextFrom: 10 });
});

test('a file saved on the task is reported with the artifact row that stores it', () => {
   assert.deepEqual(savedOnTask({ id: 'art-1', path: 'docs/brief.md', version: 2 }), {
      path: 'docs/brief.md',
      version: 2,
      saved: true,
      artifact: { id: 'art-1', path: 'docs/brief.md', version: 2 },
   });
});

test('delete_file and move_file refuse .git, .handoffs and paths outside the workspace', () => {
   assert.deepEqual(removablePath('src/./maze.ts'), { path: 'src/maze.ts' });
   assert.deepEqual(removablePath('docs/.handoffs-notes.md'), { path: 'docs/.handoffs-notes.md' });
   for (const path of ['.git/config', 'vendor/.git/HEAD', '.handoffs/BER-1 - task', './.handoffs/x', '../escape.ts', 'a/../../escape.ts']) {
      assert.ok('error' in removablePath(path), path);
   }
});
