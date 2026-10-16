import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runtimeChatNote, runtimeCompletionNote, runtimeToolNote, runtimeTurnNote, runtimeTurnNoteFor } from './tool-note.ts';

test('every runtime is told the same sandbox commands', () => {
   const claude = runtimeToolNote('mcp__berry__list_run_tools');
   const kiro = runtimeToolNote('@berry/list_run_tools');
   assert.equal(claude, kiro);
   assert.match(claude, /Commands in the sandbox/);
   assert.match(claude, /Run one with run_command/);
   assert.match(claude, /Call list_run_tools to list every tool you may use/);
   assert.match(claude, /The reply contains the native tool names Berry serves on this runtime, each with the Berry tool it runs, plus the sandbox commands/);
   assert.doesNotMatch(claude, /shell and file tools are refused/);
   assert.doesNotMatch(claude, /mcp__berry__list_run_tools/);
   assert.doesNotMatch(kiro, /@berry\/list_run_tools/);
});

test('a completion is told it has no tools, and how to inspect when the schema has read', () => {
   const bare = runtimeCompletionNote();
   assert.match(bare, /no Berry tool server/);
   assert.match(bare, /This completion cannot call tools/);
   assert.match(bare, /They are not available and will fail/);
   assert.doesNotMatch(bare, /Call list_run_tools to list every tool/);
   assert.doesNotMatch(bare, /shell or file tools/);
   assert.equal(bare.includes('`read`'), false);

   const review = runtimeCompletionNote({ properties: { read: { type: 'array' }, approved: { type: 'boolean' } } });
   assert.match(review, /list paths in `read`/);
   assert.match(review, /`read` empty/);

   assert.match(runtimeTurnNote('agent', '@berry/list_run_tools'), /Run one with run_command/);
   assert.equal(runtimeTurnNote('agent', 'mcp__berry__list_run_tools'), runtimeTurnNote('agent', '@berry/list_run_tools'));
   assert.match(runtimeTurnNote('completion', '@berry/list_run_tools'), /no Berry tool server/);
   assert.equal(runtimeTurnNote('completion', '@berry/list_run_tools').includes('list_run_tools first'), false);
});

test('a chat is told not to list tools or the workspace before answering', () => {
   const note = runtimeChatNote();
   assert.match(note, /Open work is already in this turn/);
   assert.match(note, /Do not call list_run_tools or list the workspace first/);
   assert.match(note, /To create a project, call create_project/);
   assert.match(note, /Write markdown \(headings, lists, tables\)/);
   assert.match(note, /Do not emit HTML/);
   assert.doesNotMatch(note, /Call list_run_tools to list every tool you may use/);
   assert.equal(
      runtimeTurnNote('agent', 'list_run_tools', undefined, true),
      note
   );
   assert.match(
      runtimeTurnNoteFor({ kind: 'agent', task: { issue: null }, completion: null }, 'list_run_tools'),
      /Do not call list_run_tools/
   );
   assert.match(
      runtimeTurnNoteFor(
         {
            kind: 'agent',
            task: { issue: { id: '1', identifier: 'ABC-1', title: 'Work', description: null } },
            completion: null,
         },
         'list_run_tools'
      ),
      /Call list_run_tools to list every tool you may use/
   );
});
