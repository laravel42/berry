import assert from 'node:assert/strict';
import { test } from 'node:test';
import { artifactPathSchema } from './core-tools.ts';

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
