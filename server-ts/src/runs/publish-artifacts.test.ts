import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { Sql } from '../db/pool.ts';
import { branchNameFor, publishRunArtifacts, pullRequestBodyFor } from './publish-artifacts.ts';

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

describe('which runs are published', () => {
   /** Answers each query by what it reads; anything past the snapshot check is recorded. */
   function database(snapshot: { read_only: boolean } | undefined, reached: string[]): Sql {
      const sql = (strings: TemplateStringsArray) => {
         const text = strings.join('?');
         if (text.includes('FROM runs AS run')) {
            return Promise.resolve([{ issue_id: 'issue-1', branch: null, workspace_id: 'ws', number: 1, title: 'Brief', summary: null, identifier: 'ABC-1' }]);
         }
         if (text.includes('FROM run_events')) return Promise.resolve([]);
         if (text.includes('FROM run_repository_snapshots')) return Promise.resolve(snapshot ? [snapshot] : []);
         reached.push(text);
         return Promise.resolve([]);
      };
      return sql as unknown as Sql;
   }

   for (const [label, snapshot] of [
      ['a read-only run', { read_only: true }],
      ['a run with no checkout', undefined],
   ] as const) {
      test(`${label} keeps its documents on the task instead of opening a pull request`, async () => {
         const reached: string[] = [];
         const published = await publishRunArtifacts(
            {
               sql: database(snapshot, reached),
               github: async () => assert.fail('no provider call'),
               openArtifact: async () => assert.fail('no artifact read'),
            },
            'run-1'
         );
         assert.equal(published, null);
         assert.deepEqual(reached, []);
      });
   }

   test('a run that could change the repository goes on to look for its files', async () => {
      const reached: string[] = [];
      await publishRunArtifacts(
         { sql: database({ read_only: false }, reached), github: async () => assert.fail('no files, no provider call'), openArtifact: async () => new Uint8Array() },
         'run-1'
      ).catch(() => null);
      assert.ok(reached.length > 0);
   });
});
