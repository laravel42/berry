import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Agent, tool, type Message } from '@strands-agents/sdk';
import { z } from 'zod';
import { ScriptedModel, call, say } from '../scripted-model.ts';
import { StepBudgetPlugin, budgetContract, wrapUpAt } from './step-budget.ts';

const echo = tool({
   name: 'echo',
   description: 'echoes',
   inputSchema: z.object({}),
   callback: async () => 'ok',
});

/** Every Berry notice the model was shown, in the order it read them. */
function notices(messages: Message[]): string[] {
   return messages
      .flatMap((message) => message.content)
      .flatMap((block) => (block.type === 'toolResultBlock' ? block.content : []))
      .flatMap((block) => (block.type === 'textBlock' && block.text.startsWith('Berry:') ? [block.text] : []));
}

async function run(maxTurns: number | undefined, toolSteps: number): Promise<Message[]> {
   const agent = new Agent({
      model: new ScriptedModel([...Array.from({ length: toolSteps }, () => call('echo', {})), say('Report.')]),
      tools: [echo],
      plugins: [new StepBudgetPlugin({ maxTurns })],
      printer: false,
   });
   await agent.invoke('go');
   return agent.messages;
}

test('the contract names the limit, and is absent without one', () => {
   assert.match(budgetContract(80), /ends after 80 steps/);
   assert.match(budgetContract(80), /about 10 steps are left/);
   assert.equal(budgetContract(undefined), '');
});

test('the wrap-up point scales with the limit and never vanishes', () => {
   assert.deepEqual([4, 20, 40, 80, 200].map(wrapUpAt), [3, 3, 6, 10, 10]);
});

test('a run well inside its limit is told nothing', async () => {
   assert.deepEqual(notices(await run(80, 5)), []);
});

test('near the limit the agent is told once to wrap up, then once that its next reply is the last', async () => {
   const told = notices(await run(12, 11));
   assert.equal(told.length, 2);
   assert.match(told[0]!, /^Berry: 3 steps are left/);
   assert.match(told[1]!, /next reply is the last step/);
});

test('a run with no step limit is left alone', async () => {
   assert.deepEqual(notices(await run(undefined, 6)), []);
});
