import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Agent, tool, type Message } from '@strands-agents/sdk';
import { z } from 'zod';
import { ScriptedModel, call, say } from '../scripted-model.ts';
import { StepBudgetPlugin, budgetContract, summarizeTool, wrapUpAt, type Handoff } from './step-budget.ts';

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
   assert.match(budgetContract(80), /call summarize/);
   assert.equal(budgetContract(undefined), '');
});

test('the wrap-up point scales with the limit and never vanishes', () => {
   assert.deepEqual([4, 20, 40, 80, 200].map(wrapUpAt), [3, 3, 6, 10, 10]);
});

test('a run well inside its limit is told nothing', async () => {
   assert.deepEqual(notices(await run(80, 5)), []);
});

test('near the limit the agent is told once to summarize, then once that only summarize is accepted', async () => {
   const messages = await run(12, 11);
   const told = notices(messages);
   assert.equal(told.length, 2);
   assert.match(told[0]!, /^Berry: 3 steps are left/);
   assert.match(told[0]!, /Call summarize/);
   assert.match(told[1]!, /^Berry: 2 steps are left\. Only summarize is accepted/);
   // The call after that notice did not run.
   assert.match(JSON.stringify(messages), /only summarize is accepted now/);
});

test('in the last steps a summarize still goes through, and ends the run', async () => {
   const handoff: Handoff = { open: false, summary: null };
   const agent = new Agent({
      model: new ScriptedModel([
         ...Array.from({ length: 10 }, () => call('echo', {})),
         call('echo', {}),
         call('summarize', { summary: 'Done: the shell. Left: the drawer.' }),
      ]),
      tools: [echo, summarizeTool(handoff)],
      plugins: [new StepBudgetPlugin({ maxTurns: 12, handoff })],
      printer: false,
   });
   await agent.invoke('go');
   assert.equal(handoff.summary, 'Done: the shell. Left: the drawer.');
});

test('summarize is refused until the wrap-up notice, and then it ends the run', async () => {
   const early: Handoff = { open: false, summary: null };
   const keptGoing = new Agent({
      model: new ScriptedModel([call('summarize', { summary: 'too soon' }), say('still going')]),
      tools: [echo, summarizeTool(early)],
      plugins: [new StepBudgetPlugin({ maxTurns: 80, handoff: early })],
      printer: false,
   });
   assert.equal((await keptGoing.invoke('go')).stopReason, 'endTurn');
   assert.equal(early.summary, null);
   assert.match(JSON.stringify(keptGoing.messages), /still going/);

   const handoff: Handoff = { open: false, summary: null };
   const agent = new Agent({
      model: new ScriptedModel([
         ...Array.from({ length: 9 }, () => call('echo', {})),
         call('summarize', { summary: 'The shell is in. The drawer still needs a close button.' }),
      ]),
      tools: [echo, summarizeTool(handoff)],
      plugins: [new StepBudgetPlugin({ maxTurns: 12, handoff })],
      printer: false,
   });
   const result = await agent.invoke('go');
   assert.equal(result.stopReason, 'endTurn');
   assert.equal(handoff.summary, 'The shell is in. The drawer still needs a close button.');
});

test('a run with no step limit is left alone', async () => {
   assert.deepEqual(notices(await run(undefined, 6)), []);
});
