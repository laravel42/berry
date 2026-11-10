import assert from 'node:assert/strict';
import { test } from 'node:test';
import { countProducedFiles, handoffDocument, handoffPath, handoffSlug, withHandoffFile } from './handoff.ts';

test('produced files omit the handoff and count each path once', () => {
   assert.equal(
      countProducedFiles(['src/clock.ts', '.handoffs/BER-12 - add-the-clock', 'HANDOFF.md', 'src/clock.ts']),
      1
   );
   assert.equal(countProducedFiles(['.handoffs/BER-12 - add-the-clock', 'HANDOFF.md', '.handoffs']), 0);
});

test('a title becomes a hyphenated filename piece', () => {
   assert.equal(handoffSlug('GitLab OAuth2 integration'), 'gitlab-oauth2-integration');
   assert.equal(handoffSlug('  Add the clock! '), 'add-the-clock');
   assert.equal(handoffPath('BER-12', 'Add the clock'), '.handoffs/BER-12 - add-the-clock');
});

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
   assert.match(text, /^\.handoffs\/BER-12 - add-the-clock\n/);
   assert.match(text, /# Handoff from BER-12/);
   assert.match(text, /src\/clock\.ts/);
   assert.match(text, /Repository: acme\/game/);
   assert.match(text, /Pull request: 4/);
});

test('the handoff is one of the files the run commits', () => {
   const document = '.handoffs/BER-12 - add-the-clock\n\n# Handoff from BER-12\n';
   const files = withHandoffFile(
      [{ path: 'src/clock.ts', mode: '100644' as const, content: 'eA==' }, { path: 'HANDOFF.md', mode: '100644' as const, content: 'b2xk' }],
      document
   );
   assert.equal(files.length, 2);
   assert.equal(files[0]?.path, 'src/clock.ts');
   const handoff = files[1];
   assert.equal(handoff?.path, '.handoffs/BER-12 - add-the-clock');
   assert.equal(Buffer.from(handoff && 'content' in handoff ? handoff.content : '', 'base64').toString('utf8'), document);
});

test('a deletion under .handoffs is left out of the commit', () => {
   const document = '.handoffs/BER-12 - add-the-clock\n\n# Handoff from BER-12\n';
   const files = withHandoffFile(
      [
         { path: 'src/clock.ts', mode: '100644' as const, content: 'eA==' },
         { path: '.handoffs/BER-9 - older-note', mode: '100644' as const, content: null },
      ],
      document
   );
   assert.deepEqual(files.map((file) => file.path), ['src/clock.ts', '.handoffs/BER-12 - add-the-clock']);
});
