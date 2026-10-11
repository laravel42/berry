import assert from 'node:assert/strict';
import { test } from 'node:test';
import { handoffDocument, withHandoffFile } from './handoff.ts';

test('a finished run becomes a handoff any later task can find', () => {
   const text = handoffDocument({
      identifier: 'BER-12',
      title: 'Add the clock',
      summary: 'The loop lives in src/clock.ts.',
      files: ['src/clock.ts', 'src/clock.test.ts'],
      repository: 'acme/game',
      branch: 'engineer/ber-12-clock',
      commit: 'abc1234',
      pullRequest: 4,
   });
   assert.match(text, /^HANDOFF\.md\n/);
   assert.match(text, /# Handoff from BER-12/);
   assert.match(text, /src\/clock\.ts/);
   assert.match(text, /Repository: acme\/game/);
   assert.match(text, /Pull request: 4/);
});

test('the handoff is one of the files the run commits', () => {
   const files = withHandoffFile(
      [{ path: 'src/clock.ts', mode: '100644' as const, content: 'eA==' }, { path: 'HANDOFF.md', mode: '100644' as const, content: 'b2xk' }],
      'HANDOFF.md\n\n# Handoff from BER-12\n'
   );
   assert.equal(files.length, 2);
   assert.equal(files[0]?.path, 'src/clock.ts');
   const handoff = files[1];
   assert.equal(handoff?.path, 'HANDOFF.md');
   assert.equal(Buffer.from(handoff && 'content' in handoff ? handoff.content : '', 'base64').toString('utf8'), 'HANDOFF.md\n\n# Handoff from BER-12\n');
});
