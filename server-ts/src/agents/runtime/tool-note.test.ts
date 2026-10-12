import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runtimeCompletionNote, runtimeToolNote, runtimeTurnNote } from './tool-note.ts';

test('a runtime note names its first call and refuses the wrappers', () => {
   const note = runtimeToolNote('mcp__berry__list_run_tools');
   assert.match(note, /Call mcp__berry__list_run_tools first/);
   assert.match(note, /already loaded/);
   assert.match(note, /Do not call tool_load, tool_call, or a powers interface/);
});

test('a completion is told it has no tools, and how to inspect when the schema has read', () => {
   const bare = runtimeCompletionNote();
   assert.match(bare, /no Berry tool server/);
   assert.match(bare, /Do not call list_run_tools/);
   assert.equal(bare.includes('`read`'), false);

   const review = runtimeCompletionNote({ properties: { read: { type: 'array' }, approved: { type: 'boolean' } } });
   assert.match(review, /list paths in `read`/);
   assert.match(review, /`read` empty/);

   assert.match(runtimeTurnNote('agent', '@berry/list_run_tools'), /Call @berry\/list_run_tools first/);
   assert.match(runtimeTurnNote('completion', '@berry/list_run_tools'), /no Berry tool server/);
   assert.equal(runtimeTurnNote('completion', '@berry/list_run_tools').includes('list_run_tools first'), false);
});
