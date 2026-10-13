import assert from 'node:assert/strict';
import { test } from 'node:test';
import { tool, type Tool } from '@strands-agents/sdk';
import { z } from 'zod';
import { kiroAgentNote, kiroCallAllowed, withKiroAliases } from './kiro-aliases.ts';

function asInvokable(entry: Tool | undefined): (input: unknown) => Promise<unknown> {
   assert.ok(entry);
   const invoke = (entry as unknown as { invoke?: (input: unknown) => Promise<unknown> }).invoke;
   if (typeof invoke !== 'function') throw new Error('alias has no invoke');
   return (input) => invoke.call(entry, input);
}

function berry(name: string, seen: unknown[]): Tool {
   return tool({
      name,
      description: name,
      inputSchema: z.record(z.string(), z.unknown()),
      callback: async (input: unknown) => {
         seen.push({ name, input });
         return { ok: true, name };
      },
   });
}

test('a Kiro session registers an alias for every built-in that has a Berry tool', async () => {
   const seen: unknown[] = [];
   const aliased = withKiroAliases([
      berry('write_file', seen),
      berry('edit_file', seen),
      berry('run_command', seen),
      berry('read_repository_file', seen),
      berry('browse_repository', seen),
      berry('fetch_url', seen),
   ]);
   const names = aliased.map((entry) => entry.name);
   for (const name of ['fs_write', 'str_replace', 'execute_bash', 'read', 'read_files', 'list_directory', 'file_search', 'grep', 'delete_file', 'control_bash_process', 'web_fetch']) {
      assert.equal(names.includes(name), true, name);
   }
   assert.equal(names.includes('code'), false);
   assert.equal(names.includes('web_search'), false);
   assert.equal(names.filter((name) => name === 'fs_write').length, 1);

   const write = asInvokable(aliased.find((entry) => entry.name === 'fs_write'));
   await write({ path: 'src/maze.ts', file_text: 'export {}' });
   assert.deepEqual(seen[0], { name: 'write_file', input: { path: 'src/maze.ts', content: 'export {}' } });

   const replace = asInvokable(aliased.find((entry) => entry.name === 'str_replace'));
   await replace({ path: 'src/maze.ts', old_str: 'a', new_str: 'b' });
   assert.deepEqual(seen[1], { name: 'edit_file', input: { path: 'src/maze.ts', old: 'a', new: 'b' } });

   const shell = asInvokable(aliased.find((entry) => entry.name === 'execute_bash'));
   await shell({ command: 'pnpm typecheck' });
   assert.deepEqual(seen[2], { name: 'run_command', input: { command: 'pnpm typecheck' } });

   const remove = asInvokable(aliased.find((entry) => entry.name === 'delete_file'));
   const refused = await remove({ path: '../secrets' });
   assert.equal(seen.length, 3);
   assert.match(JSON.stringify(refused), /outside the workspace/);
});

test('aliases are omitted when the Berry tool is not on the run', () => {
   const names = withKiroAliases([]).map((entry) => entry.name);
   assert.deepEqual(names, []);
   const readOnly = withKiroAliases([
      tool({
         name: 'read_file',
         description: 'read',
         inputSchema: z.object({ path: z.string() }),
         callback: () => ({ found: true }),
      }),
   ]).map((entry) => entry.name);
   assert.equal(readOnly.includes('read'), true);
   assert.equal(readOnly.includes('fs_write'), false);
   assert.equal(readOnly.includes('execute_bash'), false);
   assert.equal(readOnly.includes('grep'), false);
});

test('native Kiro tools are allowed only through their Berry tool', () => {
   assert.equal(
      kiroCallAllowed({ toolCall: { name: 'fs_write' } }, new Set(['write_file'])),
      true
   );
   assert.equal(
      kiroCallAllowed({ _meta: { kiro: { consent: { capability: 'shell' } } }, toolCall: { title: 'git status' } }, new Set(['read_issue'])),
      false
   );
   assert.equal(
      kiroCallAllowed({ _meta: { kiro: { consent: { capability: 'shell' } } } }, new Set(['run_command'])),
      true
   );
   assert.equal(
      kiroCallAllowed({ _meta: { kiro: { consent: { capability: 'subagent' } } } }, new Set(['run_command', 'write_file'])),
      false
   );
   assert.equal(
      kiroCallAllowed({ _meta: { kiro: { mcpTool: { identity: { serverName: 'berry', toolName: 'read_issue' } } } } }, new Set(['read_issue'])),
      true
   );
   const note = kiroAgentNote(new Set(['write_file', 'run_command']));
   assert.match(note, /Call list_run_tools to list every tool you may use/);
   assert.match(note, /native commands for this runtime plus the sandbox commands/);
   assert.match(note, /Do not delegate to a subagent/);
   assert.doesNotMatch(note, /shell and file tools are refused/);
});
