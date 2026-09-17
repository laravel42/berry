import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { branchNameFor, pullRequestBodyFor } from './publish-artifacts.ts';

/**
 * The pure halves of publishing a run's saved files.
 *
 * The commit itself needs a provider and a database, so what is checked here is
 * the naming and the body — the parts that end up in front of a person on
 * GitHub, and the parts a wrong answer makes permanent.
 */

describe('the branch a run publishes to', () => {
   test('carries the task identifier and a readable slug', () => {
      assert.equal(
         branchNameFor('L42-197', 'Implement provenance metadata writer'),
         'berry/l42-197-implement-provenance-metadata-writer'
      );
   });

   test('a title of punctuation still yields a legal branch', () => {
      // A slug of nothing must not leave a trailing dash: `berry/l42-1-` is
      // refused by git, and the failure would arrive as a 422 from the provider
      // long after the work was done.
      assert.equal(branchNameFor('L42-1', '???'), 'berry/l42-1');
      assert.equal(branchNameFor('L42-2', '  spaces  '), 'berry/l42-2-spaces');
   });

   test('a long title is cut without ending on a dash', () => {
      const branch = branchNameFor('L42-3', 'a'.repeat(20) + ' ' + 'b'.repeat(60));
      assert.ok(branch.length <= 'berry/l42-3-'.length + 48);
      assert.ok(!branch.endsWith('-'));
   });
});

describe('the pull request body', () => {
   test('names the task, the summary and every file', () => {
      const body = pullRequestBodyFor('L42-197', 'Wrote the writer.', ['src/a.ts', 'docs/b.md']);
      assert.match(body, /Berry task L42-197\./);
      assert.match(body, /Wrote the writer\./);
      assert.match(body, /- `src\/a\.ts`/);
      assert.match(body, /- `docs\/b\.md`/);
   });

   test('says so when the run left no summary, rather than showing an empty section', () => {
      assert.match(pullRequestBodyFor('L42-9', null, ['x']), /left no summary/);
      assert.match(pullRequestBodyFor('L42-9', '   ', ['x']), /left no summary/);
   });
});
