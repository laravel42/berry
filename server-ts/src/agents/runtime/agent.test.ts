import assert from 'node:assert/strict';
import { test } from 'node:test';
import { tool } from '@strands-agents/sdk';
import { z } from 'zod';
import { buildRunAgent, WINDOW_SIZE } from './agent.ts';
import { ScriptedModel, call, say } from './scripted-model.ts';

/**
 * The agent every run is built from. What is pinned is the shape a run
 * depends on: the model comes from the factory it was given, and the
 * conversation does not grow without bound.
 */

const echo = tool({
   name: 'echo',
   description: 'echo',
   inputSchema: z.object({ n: z.number() }),
   callback: async ({ n }) => ({ n }),
});

function spec(model: ScriptedModel) {
   return buildRunAgent(
      {
         agentName: 'Bot',
         model: 'm',
         region: 'r',
         credentials: null,
         systemPrompt: 's',
         tools: [echo],
         plugins: [],
         traceAttributes: { 'berry.run_id': 'run' },
      },
      () => model
   );
}

test('a long run is windowed so the context cannot grow without bound', async () => {
   // The SDK compresses proactively from the model's own usage numbers, so
   // the script reports a conversation that grows each call, against a small
   // window — the situation a real run reaches after enough tool calls.
   const turns = Array.from({ length: 150 }, (_, n) =>
      call('echo', { n }, { inputTokens: 40 * (n + 1), outputTokens: 5 })
   );
   const model = new ScriptedModel([...turns, say('done')], { contextWindowLimit: 3_000 });
   await spec(model).invoke('go');
   // The window plus the user turn that carries the latest tool result. The
   // conversation grows freely until the threshold and is clamped from then
   // on, so the guarantee is about where it ends, not every step.
   assert.ok((model.received.at(-1)?.length ?? 0) <= WINDOW_SIZE + 1);
   assert.equal(model.calls, 151);
});

test('windowing keeps toolUse/toolResult pairs intact for Bedrock', async () => {
   // Issue #7: trimming to the recent N must not sever a toolUse from its
   // toolResult, or the next Bedrock invoke fails ("tool_use ids must have
   // corresponding tool_result"). The SDK's sliding window is pair-aware; this
   // pins that by checking the clamped conversation the model was handed.
   const turns = Array.from({ length: 150 }, (_, n) =>
      call('echo', { n }, { inputTokens: 40 * (n + 1), outputTokens: 5 })
   );
   const model = new ScriptedModel([...turns, say('done')], { contextWindowLimit: 3_000 });
   await spec(model).invoke('go');

   // Inspect a batch from after the window clamped down (not the first few,
   // which are below the window and never trimmed).
   const batch = model.received.at(-1) ?? [];
   const blocks = (m: (typeof batch)[number]) => m.content as { type: string; toolUseId?: string }[];

   // Every toolResult resolves to a toolUse that appears earlier in the batch:
   // no leading orphan survived the trim.
   const seenToolUse = new Set<string>();
   for (const message of batch) {
      for (const block of blocks(message)) {
         if (block.type === 'toolUseBlock' && block.toolUseId) seenToolUse.add(block.toolUseId);
         if (block.type === 'toolResultBlock') {
            assert.ok(
               block.toolUseId && seenToolUse.has(block.toolUseId),
               `toolResult ${block.toolUseId} has no preceding toolUse in the window`
            );
         }
      }
   }

   // The batch does not end on a toolUse whose result was trimmed away.
   const last = batch.at(-1);
   const endsOnDanglingToolUse =
      last !== undefined && blocks(last).some((b) => b.type === 'toolUseBlock');
   assert.ok(!endsOnDanglingToolUse, 'window ended on a toolUse with no following toolResult');
});

test('the run is named after the agent, safely', async () => {
   const model = new ScriptedModel([say('hi')]);
   const agent = spec(model);
   assert.equal(agent.name, 'bot');
   assert.equal((await agent.invoke('go')).stopReason, 'endTurn');
});
