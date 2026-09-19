import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CallerGone, SessionRegistry } from './sessions.ts';

/**
 * One session runs one invocation at a time, and an invocation lives only as
 * long as its caller. The case this guards: the API restarted mid-run, its
 * loop kept going in the runtime with nobody listening, and the next run on
 * the same task waited behind it in silence.
 */

function deferred() {
   let resolve!: () => void;
   const promise = new Promise<void>((done) => (resolve = done));
   return { promise, resolve };
}

test('an orphaned loop keeps running until another invocation needs the session', async () => {
   const registry = new SessionRegistry();
   const caller = new AbortController();
   const started = deferred();
   let aborted = false;
   const finish = deferred();
   const orphan = registry.exclusive(
      's',
      (signal) =>
         new Promise<string>((resolve) => {
            started.resolve();
            signal.addEventListener('abort', () => {
               aborted = true;
               resolve('stopped');
            });
            void finish.promise.then(() => resolve('finished'));
         }),
      caller.signal
   );
   await started.promise;
   caller.abort();
   await new Promise((resolve) => setTimeout(resolve, 10));
   // Nobody else wants the session: the loop is left to finish and stay warm.
   assert.equal(aborted, false);
   assert.equal(registry.busy, true);

   // A newcomer does not wait out the orphan's budget: it stops it.
   const next = registry.exclusive('s', async () => 'next ran');
   assert.equal(await orphan, 'stopped');
   assert.equal(await next, 'next ran');
});

test('a loop whose caller is still there is never stopped by a newcomer', async () => {
   const registry = new SessionRegistry();
   const release = deferred();
   let aborted = false;
   const first = registry.exclusive(
      's',
      async (signal) => {
         signal.addEventListener('abort', () => (aborted = true));
         await release.promise;
         return 'first';
      },
      new AbortController().signal
   );
   const second = registry.exclusive('s', async () => 'second');
   release.resolve();
   assert.equal(await first, 'first');
   assert.equal(await second, 'second');
   assert.equal(aborted, false);
});

test('a queued invocation whose caller left never starts, and the next one does', async () => {
   const registry = new SessionRegistry();
   const first = deferred();
   const holding = registry.exclusive('s', () => first.promise);

   const gone = new AbortController();
   let ranOrphan = false;
   const orphan = registry.exclusive(
      's',
      async () => {
         ranOrphan = true;
      },
      gone.signal
   );
   gone.abort();

   const next = registry.exclusive('s', async () => 'next ran');
   first.resolve();
   await holding;
   await assert.rejects(orphan, CallerGone);
   assert.equal(await next, 'next ran');
   assert.equal(ranOrphan, false);
});

test('an invocation whose caller stays is untouched', async () => {
   const registry = new SessionRegistry();
   const caller = new AbortController();
   assert.equal(await registry.exclusive('s', async (signal) => signal.aborted, caller.signal), false);
});
