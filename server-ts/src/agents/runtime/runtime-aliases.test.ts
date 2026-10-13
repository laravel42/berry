import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { tool, type Tool } from '@strands-agents/sdk';
import { z } from 'zod';
import {
   acpToolName,
   isNativeToolName,
   ledgerToolName,
   stripBerryQualifier,
   withRuntimeAliases,
} from './runtime-aliases.ts';

type Call = { name: string; input: Record<string, unknown> };

function berry(name: string, calls: Call[], reply: (input: Record<string, unknown>) => unknown = () => ({ ok: true })): Tool {
   return tool({
      name,
      description: name,
      inputSchema: z.record(z.string(), z.unknown()),
      callback: async (input: Record<string, unknown>) => {
         calls.push({ name, input });
         return reply(input);
      },
   });
}

function invoke(tools: readonly Tool[], name: string, input: unknown): Promise<unknown> {
   const entry = tools.find((candidate) => candidate.name === name);
   assert.ok(entry, `${name} is registered`);
   const run = (entry as unknown as { invoke?: (value: unknown) => Promise<unknown> }).invoke;
   if (typeof run !== 'function') throw new Error(`${name} has no invoke`);
   return run.call(entry, input);
}

const WORKER = ['run_command', 'read_repository_file', 'browse_repository', 'write_file', 'edit_file', 'delete_file', 'move_file', 'fetch_url'];

function session(runtimeId: string, names: readonly string[] = WORKER, files: Record<string, string> = {}) {
   const calls: Call[] = [];
   const replies: Record<string, (input: Record<string, unknown>) => unknown> = {
      read_repository_file: (input) => {
         const content = files[String(input.path)];
         return content === undefined ? { found: false } : { found: true, content };
      },
      browse_repository: () => ({
         entries: [
            { path: 'src/a.ts', type: 'file' },
            { path: 'src/b.md', type: 'file' },
            { path: 'src/deep/c.ts', type: 'file' },
            { path: 'src/deep', type: 'directory' },
         ],
         truncated: false,
      }),
   };
   const tools = withRuntimeAliases(runtimeId, names.map((name) => berry(name, calls, replies[name])));
   return { tools, calls };
}

describe('routed aliases per runtime', () => {
   test('Claude: Bash, Read, Edit, Write, Grep, Glob and WebFetch run their Berry tools', async () => {
      const { tools, calls } = session('claude');
      await invoke(tools, 'Bash', { command: 'pnpm test', timeout: 120_000 });
      await invoke(tools, 'Read', { file_path: 'src/a.ts' });
      await invoke(tools, 'Edit', { file_path: 'src/a.ts', old_string: 'a', new_string: 'b' });
      await invoke(tools, 'Write', { file_path: 'src/a.ts', content: '' });
      await invoke(tools, 'Grep', { pattern: 'TODO', path: 'src', glob: '**/*.ts', '-i': true });
      await invoke(tools, 'WebFetch', { url: 'https://example.com' });
      assert.deepEqual(calls, [
         { name: 'run_command', input: { command: 'pnpm test', timeoutMinutes: 2 } },
         { name: 'read_repository_file', input: { path: 'src/a.ts' } },
         { name: 'edit_file', input: { path: 'src/a.ts', old: 'a', new: 'b' } },
         { name: 'write_file', input: { path: 'src/a.ts', content: '' } },
         {
            name: 'run_command',
            input: { command: "grep -n -R -E -i --exclude-dir=.git --exclude-dir=node_modules --include='*.ts' -- 'TODO' 'src'" },
         },
         { name: 'fetch_url', input: { url: 'https://example.com' } },
      ]);
      const globbed = await invoke(tools, 'Glob', { pattern: 'src/**/*.ts' });
      assert.deepEqual(globbed, { pattern: 'src/**/*.ts', files: ['src/a.ts', 'src/deep/c.ts'], truncated: false });
      assert.deepEqual(calls.at(-1), { name: 'browse_repository', input: { path: 'src', depth: 6 } });
   });

   test('Codex: the shell names run run_command and apply_patch applies through the file tools', async () => {
      const { tools, calls } = session('codex', WORKER, { 'src/a.ts': 'const a = 1;\n', 'old.ts': 'x\n' });
      await invoke(tools, 'exec_command', { cmd: ['bash', '-lc', 'git status'], workdir: 'src' });
      await invoke(tools, 'shell', { command: ['ls', '-la', 'my dir'] });
      assert.deepEqual(calls.splice(0), [
         { name: 'run_command', input: { command: 'git status', cwd: 'src' } },
         { name: 'run_command', input: { command: "'ls' '-la' 'my dir'" } },
      ]);
      const result = await invoke(tools, 'apply_patch', {
         input: [
            '*** Begin Patch',
            '*** Update File: src/a.ts',
            '*** Move to: src/b.ts',
            '-const a = 1;',
            '+const a = 2;',
            '*** Delete File: old.ts',
            '*** Add File: new.ts',
            '+export {};',
            '*** End Patch',
         ].join('\n'),
      });
      assert.deepEqual(result, {
         applied: true,
         changes: [
            { tool: 'move_file', path: 'src/a.ts' },
            { tool: 'edit_file', path: 'src/b.ts' },
            { tool: 'delete_file', path: 'old.ts' },
            { tool: 'write_file', path: 'new.ts' },
         ],
      });
      assert.deepEqual(
         calls.filter((call) => call.name !== 'read_repository_file').map((call) => call.name),
         ['move_file', 'edit_file', 'delete_file', 'write_file']
      );
   });

   test('Codex: a patch that does not apply writes nothing', async () => {
      const { tools, calls } = session('codex', WORKER, { 'a.txt': 'one\n' });
      const result = await invoke(tools, 'apply_patch', {
         input: ['*** Begin Patch', '*** Add File: b.txt', '+two', '*** Update File: a.txt', '-missing', '+x', '*** End Patch'].join('\n'),
      }) as { error: string };
      assert.match(result.error, /^patch not applied: a\.txt, hunk 1: these lines are not in the file/);
      assert.equal(calls.some((call) => call.name !== 'read_repository_file'), false);
   });

   test('Cursor: Shell, Ls and Delete run their Berry tools', async () => {
      const { tools, calls } = session('cursor');
      await invoke(tools, 'Shell', { command: 'git log -1' });
      await invoke(tools, 'Ls', { target_directory: 'src', depth: 2 });
      await invoke(tools, 'Delete', { target_file: 'src/a.ts' });
      assert.deepEqual(calls, [
         { name: 'run_command', input: { command: 'git log -1' } },
         { name: 'browse_repository', input: { path: 'src', depth: 2 } },
         { name: 'delete_file', input: { path: 'src/a.ts' } },
      ]);
   });

   test('Grok: search_replace, write and run_terminal_command run their Berry tools; its delete_file is Berry\'s own', async () => {
      const { tools, calls } = session('grok');
      await invoke(tools, 'search_replace', { file_path: 'a.ts', old_string: 'x', new_string: 'y' });
      await invoke(tools, 'write', { path: 'a.ts', content: 'z' });
      await invoke(tools, 'run_terminal_command', { command: 'ls' });
      assert.deepEqual(calls.map((call) => call.name), ['edit_file', 'write_file', 'run_command']);
      assert.equal(tools.filter((entry) => entry.name === 'delete_file').length, 1);
   });

   test('Kimi, Qoder and Kiro: their shell and file names run Berry tools', async () => {
      const kimi = session('kimi');
      await invoke(kimi.tools, 'Bash', { command: 'pwd' });
      await invoke(kimi.tools, 'Write', { path: 'a', content: 'b' });
      const qoder = session('qoder');
      await invoke(qoder.tools, 'Bash', { command: 'pwd' });
      await invoke(qoder.tools, 'Edit', { file_path: 'a', old_string: 'b', new_string: 'c' });
      const kiro = session('kiro');
      await invoke(kiro.tools, 'execute_bash', { command: 'pwd' });
      await invoke(kiro.tools, 'fs_write', { command: 'create', path: 'a', file_text: 'b' });
      await invoke(kiro.tools, 'fs_write', { command: 'str_replace', path: 'a', old_str: 'b', new_str: 'c' });
      assert.deepEqual(kimi.calls.map((call) => call.name), ['run_command', 'write_file']);
      assert.deepEqual(qoder.calls.map((call) => call.name), ['run_command', 'edit_file']);
      assert.deepEqual(kiro.calls, [
         { name: 'run_command', input: { command: 'pwd' } },
         { name: 'write_file', input: { path: 'a', content: 'b' } },
         { name: 'edit_file', input: { path: 'a', old: 'b', new: 'c' } },
      ]);
   });
});

describe('an alias grants nothing its Berry tool does not', () => {
   test('without the Berry tool on the run, its aliases are not registered', () => {
      const readOnly = session('claude', ['read_repository_file', 'browse_repository']).tools.map((entry) => entry.name);
      assert.deepEqual(readOnly.filter((name) => /^[A-Z]/.test(name)).sort(), ['Glob', 'Read']);
      const codex = session('codex', ['read_repository_file']).tools.map((entry) => entry.name);
      assert.equal(codex.includes('exec_command'), false);
      assert.equal(codex.includes('apply_patch'), false);
      for (const runtimeId of ['cursor', 'grok', 'kimi', 'qoder', 'kiro']) {
         const names = session(runtimeId, ['read_repository_file']).tools.map((entry) => entry.name);
         for (const name of ['Shell', 'Bash', 'execute_bash', 'run_terminal_command', 'Write', 'write', 'fs_write', 'Edit', 'Delete']) {
            assert.equal(names.includes(name), false, `${runtimeId} ${name}`);
         }
      }
      assert.deepEqual(withRuntimeAliases('not-a-runtime', []), []);
   });

   test('a patch that would delete a file needs delete_file on the run', async () => {
      const { tools, calls } = session('codex', ['read_repository_file', 'write_file', 'edit_file'], { 'a.txt': 'x\n' });
      const result = await invoke(tools, 'apply_patch', { input: '*** Begin Patch\n*** Delete File: a.txt\n*** End Patch' }) as { error: string };
      assert.match(result.error, /needs delete_file, which is not on this run/);
      assert.equal(calls.some((call) => call.name === 'delete_file'), false);
   });

   test('an alias that cannot be translated is refused without calling the Berry tool', async () => {
      const { tools, calls } = session('claude');
      assert.match(JSON.stringify(await invoke(tools, 'Bash', { command: 'sleep 100', run_in_background: true })), /background/);
      assert.match(JSON.stringify(await invoke(tools, 'Edit', { file_path: 'a', old_string: 'a', new_string: 'b', replace_all: true })), /replace_all/);
      assert.match(JSON.stringify(await invoke(tools, 'Grep', { pattern: 'x', path: '../etc' })), /outside the workspace/);
      const kiro = session('kiro');
      assert.match(JSON.stringify(await invoke(kiro.tools, 'fs_write', { command: 'append', path: 'a', file_text: 'b' })), /not served/);
      assert.deepEqual([...calls, ...kiro.calls], []);
   });
});

describe('ledger names', () => {
   test('Claude and Codex record the Berry tool an alias ran', () => {
      assert.equal(ledgerToolName('claude', 'Bash'), 'run_command');
      assert.equal(ledgerToolName('claude', 'mcp__berry__Edit'), 'edit_file');
      assert.equal(ledgerToolName('claude', 'mcp__berry__read_issue'), 'read_issue');
      assert.equal(ledgerToolName('claude', 'Read', {}, new Set(['read_file'])), 'read_file');
      assert.equal(ledgerToolName('codex', 'berry/exec_command'), 'run_command');
      assert.equal(ledgerToolName('codex', 'berry/apply_patch', { input: '*** Begin Patch\n*** Delete File: a\n*** End Patch' }), 'delete_file');
      assert.equal(ledgerToolName('codex', 'berry/apply_patch', { input: 'garbage' }), 'apply_patch');
      assert.equal(ledgerToolName('codex', 'docs/search'), 'docs/search');
   });

   test('elsewhere only a Berry-qualified name is recorded as the Berry tool', () => {
      assert.equal(ledgerToolName('kimi', 'Bash'), 'Bash');
      assert.equal(ledgerToolName('kimi', 'berry/Bash'), 'run_command');
      assert.equal(ledgerToolName('kiro', 'berry/fs_write', { command: 'str_replace' }), 'edit_file');
      assert.equal(ledgerToolName('kiro', 'berry/fs_write', { command: 'create' }), 'write_file');
      assert.equal(ledgerToolName('qoder', 'berry.Grep'), 'run_command');
      assert.equal(ledgerToolName('cursor', 'Shell'), 'Shell');
      assert.equal(ledgerToolName('grok', 'berry/read_issue'), 'read_issue');
   });

   test('an ACP update is named by its MCP identity or a bare name, never by a sentence title', () => {
      assert.equal(acpToolName({ _meta: { kiro: { mcpTool: { identity: { serverName: 'berry', toolName: 'execute_bash' } } } } }), 'berry/execute_bash');
      assert.equal(acpToolName({ toolCall: { name: 'fs_write' } }), 'fs_write');
      assert.equal(acpToolName({ title: 'berry/read_issue' }), 'berry/read_issue');
      assert.equal(acpToolName({ title: 'Running berry.Bash: git status' }), 'berry/Bash');
      assert.equal(acpToolName({ title: 'read_issue' }), 'read_issue');
      assert.equal(acpToolName({ title: 'Reading the README' }), null);
      assert.equal(acpToolName(null), null);
   });

   test('qualifiers and native names', () => {
      for (const name of ['mcp__berry__x', '@berry/x', 'berry__x', 'berry/x', 'berry.x', 'berry:x']) {
         assert.equal(stripBerryQualifier(name), 'x');
      }
      assert.equal(stripBerryQualifier('other/x'), 'other/x');
      assert.equal(isNativeToolName('kimi', 'Bash'), true);
      assert.equal(isNativeToolName('kimi', 'read_issue'), false);
      assert.equal(isNativeToolName('not-a-runtime', 'Bash'), false);
   });
});
