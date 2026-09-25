import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { LifecycleEvent } from '../../../runtime/lifecycle.ts';
import { emitModelUsage } from './usage.ts';

/**
 * A task's usage is reported per serving model: a routed model is billed as
 * what it resolved to, a plain one as what the task asked for.
 */

const zero = { cacheReadTokens: 0, cacheWriteTokens: 0 };

test('one usage event per serving model, named for the model that served it', () => {
   const events: LifecycleEvent[] = [];
   emitModelUsage((event) => events.push(event), 'kilo-auto/efficient', [
      { model: 'z-ai/glm-5.3-flash', inputTokens: 11, outputTokens: 3, ...zero, reportedCostMicros: 35 },
      { model: 'anthropic/claude-sonnet-5', inputTokens: 20, outputTokens: 4, ...zero, reportedCostMicros: 900 },
   ]);
   assert.deepEqual(
      events.map((e) => (e.type === 'task.usage' ? [e.usage.model, e.usage.reportedCostMicros] : null)),
      [
         ['z-ai/glm-5.3-flash', 35],
         ['anthropic/claude-sonnet-5', 900],
      ]
   );
});

test('a plain model is reported as asked for; an entry with nothing to bill is skipped', () => {
   const events: LifecycleEvent[] = [];
   emitModelUsage((event) => events.push(event), 'us.anthropic.claude-haiku-4-5-20251001-v1:0', [
      { model: null, inputTokens: 5, outputTokens: 1, ...zero, reportedCostMicros: undefined },
      { model: 'x', inputTokens: 0, outputTokens: 0, ...zero, reportedCostMicros: 0 },
   ]);
   assert.equal(events.length, 1);
   const [only] = events;
   assert.ok(only?.type === 'task.usage');
   assert.equal(only.usage.model, 'us.anthropic.claude-haiku-4-5-20251001-v1:0');
   assert.equal('reportedCostMicros' in only.usage, false);
});
