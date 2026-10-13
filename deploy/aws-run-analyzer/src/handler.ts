import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import type { S3EventRecord, SQSBatchResponse, SQSEvent } from 'aws-lambda';
import { analysisPrompt } from './analysis.ts';
import { askModel, bedrockClient } from './bedrock.ts';
import { RunBundleSchema } from './bundle.ts';
import { digestRun } from './digest.ts';
import { findingItems, summaryItem } from './items.ts';
import { documentClient, previousAnalysis, replaceRun } from './store.ts';

/**
 * S3 → SQS → here: one uploaded run bundle per message.
 *
 * Each message is handled on its own and reported back individually, so one
 * bad transcript is retried (and after three tries parked on the dead-letter
 * queue) without holding back the others.
 */

function required(name: string): string {
   const value = process.env[name];
   if (!value) throw new Error(`${name} is not set`);
   return value;
}

function positive(name: string, fallback: number): number {
   const value = Number(process.env[name] ?? fallback);
   return Number.isFinite(value) && value > 0 ? value : fallback;
}

const config = {
   table: required('TABLE_NAME'),
   modelId: required('MODEL_ID'),
   bedrockRegion: process.env.BEDROCK_REGION ?? process.env.AWS_REGION ?? 'us-east-1',
   maxTokens: positive('MAX_OUTPUT_TOKENS', 4_096),
   slowStepMs: positive('SLOW_STEP_SECONDS', 120) * 1_000,
   maxChars: positive('MAX_TRANSCRIPT_CHARS', 120_000),
};

const s3 = new S3Client({ maxAttempts: 5 });
const db = documentClient();
const bedrock = bedrockClient(config.bedrockRegion);

function log(level: 'info' | 'warn' | 'error', message: string, fields: Record<string, unknown> = {}): void {
   const line = JSON.stringify({ level, message, ...fields });
   if (level === 'error') console.error(line);
   else if (level === 'warn') console.warn(line);
   else console.log(line);
}

async function analyzeObject(bucket: string, key: string): Promise<void> {
   const object = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
   const etag = (object.ETag ?? '').replaceAll('"', '');
   const body = await object.Body?.transformToString('utf-8');
   if (!body) throw new Error(`${key} is empty`);

   let json: unknown;
   try {
      json = JSON.parse(body);
   } catch {
      log('error', 'transcript is not JSON; skipped', { key });
      return;
   }
   const parsed = RunBundleSchema.safeParse(json);
   if (!parsed.success) {
      // Retrying cannot change what the file says. It is logged and dropped.
      log('error', 'transcript does not match the bundle schema; skipped', { key, issues: parsed.error.issues.slice(0, 5) });
      return;
   }
   const bundle = parsed.data;

   const previous = await previousAnalysis(db, config.table, bundle.run.id);
   if (previous && previous.transcriptETag === etag && previous.analyzerModel === config.modelId) {
      log('info', 'already analyzed from this transcript', { runId: bundle.run.id, key });
      return;
   }

   const digest = digestRun(bundle, { slowStepMs: config.slowStepMs, maxChars: config.maxChars });
   const answer = await askModel(bedrock, { modelId: config.modelId, maxTokens: config.maxTokens }, analysisPrompt(bundle, digest));
   const meta = {
      analyzedAt: new Date().toISOString(),
      analyzerModel: config.modelId,
      transcriptKey: key,
      transcriptETag: etag,
      inputTokens: answer.inputTokens,
      outputTokens: answer.outputTokens,
      truncated: digest.truncated,
   };
   await replaceRun(db, config.table, summaryItem(bundle, digest.metrics, answer.analysis, meta), findingItems(bundle, answer.analysis, meta));
   log('info', 'run analyzed', {
      runId: bundle.run.id,
      status: bundle.run.status,
      findings: answer.analysis.findings.length,
      failureCause: answer.analysis.failureCause,
      inputTokens: answer.inputTokens,
      outputTokens: answer.outputTokens,
   });
}

function s3Records(body: string): S3EventRecord[] {
   const message = JSON.parse(body) as { Event?: string; Records?: S3EventRecord[] };
   if (message.Event === 's3:TestEvent') return [];
   return (message.Records ?? []).filter((record) => record.eventName?.startsWith('ObjectCreated:'));
}

export async function handler(event: SQSEvent): Promise<SQSBatchResponse> {
   const batchItemFailures: SQSBatchResponse['batchItemFailures'] = [];
   for (const message of event.Records) {
      try {
         for (const record of s3Records(message.body)) {
            const key = decodeURIComponent(record.s3.object.key.replaceAll('+', ' '));
            await analyzeObject(record.s3.bucket.name, key);
         }
      } catch (error) {
         log('error', 'analysis failed; the message will be retried', {
            messageId: message.messageId,
            error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
         });
         batchItemFailures.push({ itemIdentifier: message.messageId });
      }
   }
   return { batchItemFailures };
}
