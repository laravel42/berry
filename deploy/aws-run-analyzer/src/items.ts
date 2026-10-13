import type { Analysis } from './analysis.ts';
import type { RunBundle } from './bundle.ts';
import type { RunMetrics } from './digest.ts';

/**
 * The findings table, one partition per run.
 *
 *    pk RUN#<runId>   sk SUMMARY          the run: task, agent, outcome, measurements, the model's summary
 *    pk RUN#<runId>   sk FINDING#<nnn>    one finding, carrying the same task and agent fields
 *
 * Two indexes make the questions people ask each one Query, newest first:
 *
 *    byKind   gsi1pk STATUS#failed              every failed run
 *    byKind   gsi1pk CATEGORY#unavailable_tool  every refused or unknown tool call, across runs
 *    byModel  gsi2pk MODEL#<model>              every run of one model (summaries only)
 *
 * A finding is self-describing on purpose: the task title, the tier, the
 * provider and the model are copied onto it, so a list of findings needs no
 * second read to say whose they are.
 */

export const SUMMARY_SK = 'SUMMARY';
export const FINDING_SK_PREFIX = 'FINDING#';
export const KIND_INDEX = 'byKind';
export const MODEL_INDEX = 'byModel';

const DESCRIPTION_LIMIT = 8_000;

export interface AnalysisMeta {
   analyzedAt: string;
   analyzerModel: string;
   transcriptKey: string;
   transcriptETag: string;
   inputTokens: number;
   outputTokens: number;
   truncated: boolean;
}

export type Item = Record<string, string | number | boolean | null | string[] | Record<string, unknown> | Array<Record<string, unknown>>>;

export const runPk = (runId: string) => `RUN#${runId}`;

function context(bundle: RunBundle) {
   const { run, task, agent } = bundle;
   return {
      runId: run.id,
      runKind: run.kind,
      runStatus: run.status,
      completedAt: run.completedAt,
      taskId: task.id,
      taskIdentifier: task.identifier,
      taskTitle: task.title,
      workspace: task.workspace,
      board: task.board,
      agentId: agent.id,
      agentName: agent.name,
      agentRole: agent.role,
      agentTier: agent.tier ?? 'default',
      agentProvider: agent.provider ?? 'unknown',
      agentModel: agent.model ?? 'default',
   };
}

export function summaryItem(bundle: RunBundle, metrics: RunMetrics, analysis: Analysis, meta: AnalysisMeta): Item {
   const { run, task } = bundle;
   const shared = context(bundle);
   const counts: Record<string, number> = {};
   for (const finding of analysis.findings) counts[finding.category] = (counts[finding.category] ?? 0) + 1;
   return {
      pk: runPk(run.id),
      sk: SUMMARY_SK,
      gsi1pk: `STATUS#${run.status}`,
      gsi1sk: `${run.completedAt}#${run.id}`,
      gsi2pk: `MODEL#${shared.agentModel}`,
      gsi2sk: `${run.completedAt}#${run.id}`,
      ...shared,
      taskDescription: task.description ? task.description.slice(0, DESCRIPTION_LIMIT) : null,
      source: run.source,
      createdAt: run.createdAt,
      startedAt: run.startedAt,
      failureCode: run.failure?.code ?? null,
      failureMessage: run.failure?.message ?? null,
      failureCause: analysis.failureCause,
      failureExplanation:
         analysis.failureExplanation ?? analysis.findings.find((finding) => finding.category === 'run_failure')?.detail ?? null,
      summary: analysis.summary,
      findingCount: analysis.findings.length,
      findingCounts: counts,
      durationMs: metrics.durationMs,
      totalTokens: run.usage.totalTokens,
      toolCalls: metrics.toolCalls,
      failedToolCalls: metrics.failedToolCalls,
      failedToolsByName: metrics.failedToolsByName,
      commands: metrics.commands,
      failedCommands: metrics.failedCommands,
      assistantTurns: metrics.assistantTurns,
      slowSteps: metrics.slowSteps.map((step) => ({ ...step })),
      repeatedFailures: metrics.repeatedFailures.map((entry) => ({ ...entry })),
      ...meta,
   };
}

export function findingItems(bundle: RunBundle, analysis: Analysis, meta: AnalysisMeta): Item[] {
   const shared = context(bundle);
   return analysis.findings.map((finding, index) => {
      const ordinal = String(index).padStart(3, '0');
      return {
         pk: runPk(bundle.run.id),
         sk: `${FINDING_SK_PREFIX}${ordinal}`,
         gsi1pk: `CATEGORY#${finding.category}`,
         gsi1sk: `${bundle.run.completedAt}#${bundle.run.id}#${ordinal}`,
         ...shared,
         category: finding.category,
         severity: finding.severity,
         title: finding.title,
         detail: finding.detail,
         toolName: finding.toolName,
         eventSequence: finding.eventSequence,
         evidence: finding.evidence,
         analyzedAt: meta.analyzedAt,
         analyzerModel: meta.analyzerModel,
      };
   });
}
