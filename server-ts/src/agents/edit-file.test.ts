import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyFileEdit } from './edit-file.ts';

test('one exact span is replaced and the rest of the file stays', () => {
   const edited = applyFileEdit('alpha\nbeta\ngamma\n', 'beta', 'BETA');
   assert.deepEqual(edited, { content: 'alpha\nBETA\ngamma\n' });
});

test('an empty, missing, or repeated span is refused', () => {
   const empty = applyFileEdit('a', '', 'b');
   const missing = applyFileEdit('alpha', 'missing', 'x');
   const repeated = applyFileEdit('aa', 'a', 'b');
   assert.equal('error' in empty, true);
   assert.equal('error' in missing && /not found/.test(missing.error), true);
   assert.equal('error' in repeated && /more than once/.test(repeated.error), true);
});
