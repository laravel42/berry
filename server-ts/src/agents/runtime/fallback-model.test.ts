import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Agent } from '@strands-agents/sdk';
import { withFallback } from './agent.ts';
import { FallbackModel } from './fallback-model.ts';
import { ScriptedModel, say, throwing } from './scripted-model.ts';
import { UsageByModel } from './plugins/accounting.ts';
import { ModelMetadataEvent, ModelStreamUpdateEvent } from '@strands-agents/sdk';

/**
 * The run's model with its fallback (ADR-0017): a failure before any output
 * moves the run to the fallback for good; a content refusal does not.
 */

const usage = { inputTokens: 10, outputTokens: 2, totalTokens: 12 };

function agentOn(model: FallbackModel) {
   const byModel = new UsageByModel();
   const agent = new Agent({ model, printer: false });
   agent.addHook(ModelStreamUpdateEvent, (event) => {
      if (event.event instanceof ModelMetadataEvent && event.event.usage) byModel.add(event.event.usage);
   });
   return { agent, byModel };
}

test('a failure before any output is answered by the fallback, which the run then stays on', async () => {
   const seen: unknown[] = [];
   const primary = new ScriptedModel([throwing(Object.assign(new Error('402 Insufficient balance'), { status: 402 }))]);
   let made = 0;
   const fallback = new ScriptedModel([say('from the fallback', usage), say('still the fallback', usage)]);
   const model = new FallbackModel(primary, { id: 'openai/gpt-6-luna', make: () => ((made += 1), fallback) }, (error) => seen.push(error));
   const { agent, byModel } = agentOn(model);

   assert.match(String(await agent.invoke('first')), /from the fallback/);
   assert.match(String(await agent.invoke('second')), /still the fallback/);
   assert.equal(model.fellBack, true);
   assert.equal(made, 1, 'the fallback is built once');
   assert.equal(seen.length, 1);
   assert.deepEqual(byModel.entries().map((e) => [e.model, e.inputTokens, e.fellBack]), [['openai/gpt-6-luna', 20, true]]);
});

test('a content refusal does not fall back: another model would refuse it too', async () => {
   const primary = new ScriptedModel([throwing(new Error('blocked by the content filter'))]);
   const model = new FallbackModel(primary, { id: 'x/y', make: () => new ScriptedModel([say('should not run')]) });
   await assert.rejects(new Agent({ model, printer: false }).invoke('go'), /content filter/);
   assert.equal(model.fellBack, false);
});

test('a model that works is used as is, and no fallback is built', async () => {
   let made = 0;
   const model = new FallbackModel(new ScriptedModel([say('fine', usage)]), { id: 'x/y', make: () => ((made += 1), new ScriptedModel([])) });
   const { agent, byModel } = agentOn(model);
   assert.match(String(await agent.invoke('go')), /fine/);
   assert.equal(made, 0);
   assert.deepEqual(byModel.entries().map((e) => [e.model, e.fellBack]), [[null, false]]);
});

test('no wrapper without a fallback, or with a fallback that is the model itself', () => {
   const factory = () => new ScriptedModel([]);
   assert.ok(!(withFallback(factory, { model: 'a/b', region: 'r' }, null) instanceof FallbackModel));
   assert.ok(!(withFallback(factory, { model: 'a/b', region: 'r' }, 'a/b') instanceof FallbackModel));
   assert.ok(withFallback(factory, { model: 'a/b', region: 'r' }, 'c/d') instanceof FallbackModel);
});
