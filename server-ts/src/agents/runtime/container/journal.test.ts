import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RunJournals } from './journal.ts';

function collector() {
   const frames: string[] = [];
   let ended = false;
   return { frames, ended: () => ended, follower: { frame: (frame: string) => frames.push(frame), end: () => (ended = true) } };
}

test('a follower gets the frames after the ones it read, then each new one, then the end', () => {
   const journals = new RunJournals();
   journals.open('run', 'session');
   journals.append('run', 'a');
   journals.append('run', 'b');
   const seen = collector();
   const followed = journals.follow('run', 'session', 1, seen.follower);
   assert.equal(followed.kind, 'following');
   journals.append('run', 'c');
   journals.end('run');
   assert.deepEqual(seen.frames, ['b', 'c']);
   assert.equal(seen.ended(), true);
});

test('another session cannot read a run, and a journal is forgotten some time after its run ends', () => {
   let now = 0;
   const journals = new RunJournals({ keepMs: 1000, clock: () => now });
   journals.open('run', 'session');
   journals.end('run');
   assert.equal(journals.follow('run', 'other', 0, collector().follower).kind, 'missing');
   assert.equal(journals.follow('run', 'session', 0, collector().follower).kind, 'following');
   now = 2000;
   assert.equal(journals.follow('run', 'session', 0, collector().follower).kind, 'missing');
});

test('a run over its size keeps its newest frames, and asking for dropped ones is refused', () => {
   const journals = new RunJournals({ maxBytes: 4 });
   journals.open('run', 'session');
   for (const frame of ['aa', 'bb', 'cc']) journals.append('run', frame);
   assert.equal(journals.follow('run', 'session', 0, collector().follower).kind, 'trimmed');
   const seen = collector();
   journals.follow('run', 'session', 1, seen.follower);
   assert.deepEqual(seen.frames, ['bb', 'cc']);
});
