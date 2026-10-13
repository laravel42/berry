import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RunBundleSchema } from './bundle.ts';
import { digestRun } from './digest.ts';
import { sampleBundle } from './fixture.ts';

test('the sample bundle is a valid bundle', () => {
   assert.equal(RunBundleSchema.safeParse(sampleBundle()).success, true);
});

test('tool calls are paired, counted and grouped by name', () => {
   const { metrics } = digestRun(sampleBundle());
   assert.equal(metrics.toolCalls, 3);
   assert.equal(metrics.failedToolCalls, 3);
   assert.deepEqual(metrics.failedToolsByName, { 'Replace in File': 3 });
   assert.deepEqual(metrics.repeatedFailures, [{ name: 'Replace in File', count: 3 }]);
   assert.equal(metrics.commands, 1);
   assert.equal(metrics.failedCommands, 1);
   assert.equal(metrics.durationMs, 501_000);
});

test('slow commands and long silences are measured, slowest first', () => {
   const { metrics } = digestRun(sampleBundle());
   assert.deepEqual(
      metrics.slowSteps.map((step) => [step.kind, step.durationMs]),
      [
         ['idle', 315_000],
         ['command', 180_000],
         ['idle', 179_000],
      ]
   );
});

test('streamed deltas become one assistant line, and a failed command keeps its output', () => {
   const { transcript, metrics } = digestRun(sampleBundle());
   assert.equal(metrics.assistantTurns, 2);
   assert.match(transcript, /#2 \+00:00:01 assistant: I will edit the file\./);
   assert.match(transcript, /tool Replace in File -> failed/);
   assert.match(transcript, /\$ npm test -> exit 1 \(3\.0 min\)\n {4}output: FAIL src\/a\.test\.ts/);
   assert.match(transcript, /RUN FAILED RUNTIME_ERROR: gave up/);
});

test('a transcript over budget keeps its start and its end', () => {
   const bundle = sampleBundle();
   const filler = Array.from({ length: 400 }, (_, index) => ({
      sequence: 100 + index,
      type: 'run.tool.started',
      at: bundle.run.completedAt,
      payload: { name: `tool-${index}`, toolCallId: `f${index}`, inputSummary: null },
   }));
   bundle.events.splice(13, 0, ...filler);
   const { transcript, truncated } = digestRun(bundle, { slowStepMs: 120_000, maxChars: 4_000 });
   assert.equal(truncated, true);
   assert.ok(transcript.length < 4_200);
   assert.match(transcript, /steps omitted/);
   assert.match(transcript, /assistant: I will edit the file/);
   assert.match(transcript, /RUN FAILED/);
});
