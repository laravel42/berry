import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AnalysisRejected, analysisPrompt, parseAnalysis } from './analysis.ts';
import { digestRun } from './digest.ts';
import { sampleBundle } from './fixture.ts';
import { findingItems, summaryItem } from './items.ts';

const answer = {
   summary: 'The agent tried to edit a file with a refused built-in, then gave up when tests failed.',
   failureCause: 'tool_unavailable',
   failureExplanation: 'Replace in File is refused on Kiro, and the agent never switched to edit_file.',
   findings: [
      { category: 'unavailable_tool', severity: 'high', title: 'Replace in File refused 3 times', detail: 'Kiro built-in.', toolName: 'Replace in File', eventSequence: 4 },
      { category: 'long_iteration', severity: 'medium', title: 'npm test took 3 minutes', detail: 'Slow suite.', eventSequence: 12, evidence: 'exit 1' },
   ],
};

test('a well-formed answer is kept, with absent fields as null', () => {
   const analysis = parseAnalysis(answer);
   assert.equal(analysis.findings.length, 2);
   assert.equal(analysis.findings[0]?.evidence, null);
   assert.equal(analysis.findings[1]?.toolName, null);
});

test('an answer outside the schema is rejected, not stored', () => {
   assert.throws(() => parseAnalysis({ ...answer, failureCause: 'bad luck' }), AnalysisRejected);
   assert.throws(() => parseAnalysis({ summary: 'x', failureCause: 'none', findings: [{ category: 'vibes' }] }), AnalysisRejected);
});

test('the prompt carries the measured facts and fences the transcript', () => {
   const bundle = sampleBundle();
   const prompt = analysisPrompt(bundle, digestRun(bundle));
   assert.match(prompt, /"tier": "berry_mid"/);
   assert.match(prompt, /"repeatedFailures"/);
   assert.match(prompt, /<transcript>\n#1 /);
   assert.match(prompt, /<\/transcript>/);
});

test('every finding item names its run, task and agent, and indexes by category', () => {
   const bundle = sampleBundle();
   const digest = digestRun(bundle);
   const analysis = parseAnalysis(answer);
   const meta = {
      analyzedAt: '2026-10-12T13:00:00.000Z',
      analyzerModel: 'm',
      transcriptKey: 'runs/2026/10/12/run-1.json',
      transcriptETag: 'e',
      inputTokens: 1,
      outputTokens: 1,
      truncated: false,
   };
   const items = findingItems(bundle, analysis, meta);
   assert.deepEqual(
      items.map((item) => [item.sk, item.gsi1pk, item.taskTitle, item.agentTier, item.agentProvider, item.agentModel]),
      [
         ['FINDING#000', 'CATEGORY#unavailable_tool', 'Fix the score', 'berry_mid', 'kiro', 'auto'],
         ['FINDING#001', 'CATEGORY#long_iteration', 'Fix the score', 'berry_mid', 'kiro', 'auto'],
      ]
   );
   const summary = summaryItem(bundle, digest.metrics, analysis, meta);
   assert.equal(summary.pk, 'RUN#run-1');
   assert.equal(summary.gsi1pk, 'STATUS#failed');
   assert.equal(summary.gsi2pk, 'MODEL#auto');
   assert.equal(summary.taskDescription, 'The score doubles.');
   assert.deepEqual(summary.findingCounts, { unavailable_tool: 1, long_iteration: 1 });

   const unexplained = parseAnalysis({
      ...answer,
      failureExplanation: undefined,
      findings: [{ category: 'run_failure', severity: 'high', title: 'Abandoned', detail: 'The process stopped mid-edit.' }],
   });
   assert.equal(summaryItem(bundle, digest.metrics, unexplained, meta).failureExplanation, 'The process stopped mid-edit.');
});
