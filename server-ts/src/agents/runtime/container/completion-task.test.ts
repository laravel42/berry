import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { z } from 'zod';
import type { TaskEnvelope } from '../../../runtime/envelope.ts';
import type { LifecycleEvent } from '../../../runtime/lifecycle.ts';
import { ScriptedModel, call, say } from '../scripted-model.ts';
import { mergedStructuredOutput, runCompletionTask } from './completion-task.ts';

function completion(jsonSchema: Record<string, unknown> | null, transcript: TaskEnvelope['transcript'] = []): TaskEnvelope {
   return {
      kind: 'completion', runId: 'c1', sessionKey: 'completion:c1', runtimeSessionId: `berry-${'c'.repeat(64)}`,
      agent: { name: 'Orchestrator', instructions: '', model: 'scripted', skills: [], mcpServers: [], permissions: [], tools: null, maxTokens: null, temperature: null },
      task: { prompt: 'Classify this', issue: null, comments: [], dependencies: [], projectResources: [], priorWork: null },
      transcript, repo: null,
      completion: { system: 'You classify.', jsonSchema },
      env: {}, berry: { apiUrl: 'https://berry.test', token: 't' },
   };
}

async function run(envelope: TaskEnvelope, model: ScriptedModel): Promise<LifecycleEvent[]> {
   const events: LifecycleEvent[] = [];
   await runCompletionTask(envelope, (event) => events.push(event), { modelFactory: () => model, region: 'us-east-1' });
   return events;
}

test('free text comes back as the result text', async () => {
   const events = await run(completion(null), new ScriptedModel([say('a tidy answer')]));
   const last = events.at(-1);
   assert.ok(last?.type === 'task.completed');
   assert.equal(last.result.text, 'a tidy answer');
});

test('a schema is enforced by the model and returned as structured', async () => {
   const schema = z.toJSONSchema(z.object({ label: z.enum(['bug', 'feature']) })) as Record<string, unknown>;
   // Strands asks for structured output through its own tool,
   // STRUCTURED_OUTPUT_TOOL_NAME in the SDK's tools/structured-output-tool.js.
   const model = new ScriptedModel([call('strands_structured_output', { label: 'bug' }), say('done')]);
   const events = await run(completion(schema), model);
   const last = events.at(-1);
   assert.ok(last?.type === 'task.completed', JSON.stringify(last));
   assert.deepEqual(last.result.structured, { label: 'bug' });
});

test('a conversation in the transcript is the history before the prompt', async () => {
   const model = new ScriptedModel([say('reply')]);
   await run(completion(null, [{ role: 'user', text: 'hi' }, { role: 'assistant', text: 'hello' }]), model);
   assert.equal(model.received[0]!.length, 3);
});

function modelEvent(events: LifecycleEvent[]) {
   const found = events.find((event) => event.type === 'task.model');
   assert.ok(found?.type === 'task.model', 'a task.model event was emitted');
   return found.response;
}

test('the model’s own answer is reported, with a structured reply’s raw toolUse', async () => {
   const schema = z.toJSONSchema(z.object({ label: z.enum(['bug', 'feature']) })) as Record<string, unknown>;
   const events = await run(completion(schema), new ScriptedModel([call('strands_structured_output', { label: 'bug' }), say('done')]));
   const response = modelEvent(events);
   assert.equal(response.truncated, false);
   assert.equal(response.messages[0]?.role, 'user');
   const toolUse = response.messages
      .filter((message) => message.role === 'assistant')
      .flatMap((message) => message.content)
      .find((block) => 'toolUse' in block)?.toolUse as { name: string; input: unknown } | undefined;
   assert.equal(toolUse?.name, 'strands_structured_output');
   assert.deepEqual(toolUse?.input, { label: 'bug' });
   // Reported before the verdict, so the stream reads in the order it happened.
   assert.ok(events.findIndex((event) => event.type === 'task.model') < events.findIndex((event) => event.type === 'task.completed'));
});

test('a free-text reply is reported as the model’s text and stop reason', async () => {
   const response = modelEvent(await run(completion(null), new ScriptedModel([say('a tidy answer')])));
   assert.equal(response.stopReason, 'endTurn');
   const last = response.messages.at(-1);
   assert.equal(last?.role, 'assistant');
   assert.deepEqual(last?.content, [{ text: 'a tidy answer' }]);
});

test('an answer that never fits the schema still shows what the model said', async () => {
   const schema = z.toJSONSchema(z.object({ label: z.enum(['bug', 'feature']) })) as Record<string, unknown>;
   const events = await run(completion(schema), new ScriptedModel([say('I refuse to use the tool'), say('still no')]));
   assert.equal(events.at(-1)?.type, 'task.failed');
   const said = JSON.stringify(modelEvent(events).messages);
   assert.ok(said.includes('I refuse to use the tool'), said);
});

describe('a structured answer split across calls', () => {
   const planSchema = z.object({
      goal: z.object({ title: z.string() }),
      milestones: z.array(z.object({ title: z.string() })).default([]),
      issues: z.array(z.object({ title: z.string() })).default([]),
   });
   const turn = (role: string, content: Array<Record<string, unknown>>) => ({ role, toJSON: () => ({ role, content }) });
   const structuredCall = (input: unknown) => ({ toolUse: { name: 'strands_structured_output', toolUseId: 'x', input } });

   test('is merged when the model sends one call per field, as the planner did', () => {
      const merged = mergedStructuredOutput(
         [
            turn('user', [{ text: 'Plan the landing site' }]),
            turn('assistant', [
               { text: "I'll create the plan." },
               structuredCall({ goal: { title: 'Launch PageBuilder landing' } }),
               structuredCall({ milestones: [{ title: 'Strategy' }] }),
               structuredCall({ issues: [{ title: 'Write copy' }, { title: 'Build hero' }] }),
            ]),
         ],
         planSchema
      );
      assert.deepEqual(merged, {
         goal: { title: 'Launch PageBuilder landing' },
         milestones: [{ title: 'Strategy' }],
         issues: [{ title: 'Write copy' }, { title: 'Build hero' }],
      });
   });

   test("leaves Strands' own answer for a single call, or a merge the schema refuses", () => {
      assert.equal(mergedStructuredOutput([turn('assistant', [structuredCall({ goal: { title: 'A' } })])], planSchema), undefined);
      assert.equal(
         mergedStructuredOutput([turn('assistant', [structuredCall({ milestones: [] }), structuredCall({ issues: [] })])], planSchema),
         undefined,
         'no goal anywhere: not a plan'
      );
      assert.equal(mergedStructuredOutput([turn('assistant', [{ text: 'no tool' }])], planSchema), undefined);
   });
});
