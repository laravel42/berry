import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Agent, tool, type Message } from '@strands-agents/sdk';
import { z } from 'zod';
import { ScriptedModel, call, say } from '../scripted-model.ts';
import { RepetitionPlugin, repetitionKey } from './repetition.ts';

const runCommand = tool({
   name: 'run_command',
   description: 'run',
   inputSchema: z.object({ command: z.string() }),
   callback: async () => 'ok',
});

function notices(messages: Message[]): string[] {
   return messages
      .flatMap((message) => message.content)
      .flatMap((block) => (block.type === 'toolResultBlock' ? block.content : []))
      .flatMap((block) => (block.type === 'textBlock' && block.text.startsWith('Berry:') ? [block.text] : []));
}

async function run(commands: string[]): Promise<Message[]> {
   const agent = new Agent({
      model: new ScriptedModel([...commands.map((command) => call('run_command', { command })), say('Done.')]),
      tools: [runCommand],
      plugins: [new RepetitionPlugin()],
      printer: false,
   });
   await agent.invoke('go');
   return agent.messages;
}

test('a heredoc into a file counts as writing that file, whatever its body', () => {
   assert.deepEqual(repetitionKey('run_command', { command: "cat > __tests__/zz-bisect.test.tsx <<'EOF'\nimport a\nEOF" }), {
      kind: 'write',
      key: '__tests__/zz-bisect.test.tsx',
   });
   assert.deepEqual(repetitionKey('write_file', { path: './src/App.tsx', content: 'x' }), { kind: 'write', key: 'src/App.tsx' });
   assert.deepEqual(repetitionKey('run_command', { command: 'npm   test' }), { kind: 'command', key: 'npm test' });
   assert.equal(repetitionKey('read_file', { path: 'a' }), null);
});

test('the same command four times is told once', async () => {
   const told = notices(await run(['npm test', 'npm test', 'npm test', 'npm test', 'npm test', 'ls']));
   assert.equal(told.length, 1);
   assert.match(told[0]!, /same command 4 times/);
});

test('the same file rewritten five times is told, and different commands are not', async () => {
   const body = (n: number) => `cat > t.test.tsx <<'EOF'\ncase ${n}\nEOF`;
   const told = notices(await run([1, 2, 3, 4, 5].map(body)));
   assert.equal(told.length, 1);
   assert.match(told[0]!, /written t\.test\.tsx 5 times/);
   assert.deepEqual(notices(await run(['ls', 'git status', 'npm test', 'cat a'])), []);
});
