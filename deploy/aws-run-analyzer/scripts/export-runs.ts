#!/usr/bin/env node
/**
 * Uploads finished Berry runs to the analyzer's bucket, one JSON per run.
 *
 *    npm run export                       every run finished since the last export
 *    npm run export -- --since 2026-10-01 runs finished after a date
 *    npm run export -- --run <id> --run <id>
 *    npm run export -- --dry-run          write the bundles to ./out instead
 *
 * Reads Berry's database read-only (DATABASE_URL, or the repository's .env)
 * and writes to S3 with your own AWS credentials. Each upload triggers the
 * analysis. Where it got to is kept in the bucket (state/exporter.json), so
 * the next export continues from there on any machine.
 */
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, parseEnv } from 'node:util';
import { CloudFormationClient, DescribeStacksCommand } from '@aws-sdk/client-cloudformation';
import { GetObjectCommand, NoSuchKey, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import postgres from 'postgres';
import { BUNDLE_VERSION, transcriptKey, type RunBundle, type RunEvent } from '../src/bundle.ts';
import { redact } from '../src/redact.ts';

const here = dirname(fileURLToPath(import.meta.url));
const STATE_KEY = 'state/exporter.json';
const COMMAND_OUTPUT_LIMIT = 16_000;
const EPOCH = { completedAt: '1970-01-01T00:00:00.000Z', runId: '00000000-0000-0000-0000-000000000000' };

const { values } = parseArgs({
   options: {
      run: { type: 'string', multiple: true },
      since: { type: 'string' },
      limit: { type: 'string', default: '200' },
      bucket: { type: 'string' },
      stack: { type: 'string', default: 'BerryRunAnalyzer' },
      region: { type: 'string' },
      'env-file': { type: 'string' },
      'dry-run': { type: 'boolean', default: false },
   },
});

/** Only the two names this script needs, so the rest of Berry's .env never enters this process. */
function berryEnv(): { databaseUrl: string; modelProvider: string | null } {
   const file = values['env-file'] ?? join(here, '../../../.env');
   const fromFile = existsSync(file) ? parseEnv(readFileSync(file, 'utf8')) : {};
   const databaseUrl = process.env.DATABASE_URL ?? fromFile.DATABASE_URL;
   if (!databaseUrl) throw new Error(`DATABASE_URL is not set and ${file} does not define it`);
   if (databaseUrl.startsWith('pglite:')) throw new Error('A PGlite database cannot be read from another process; point DATABASE_URL at PostgreSQL');
   return { databaseUrl, modelProvider: process.env.BERRY_MODEL_PROVIDER ?? fromFile.BERRY_MODEL_PROVIDER ?? null };
}

async function bucketName(): Promise<string> {
   const named = values.bucket ?? process.env.BERRY_RUN_ANALYZER_BUCKET;
   if (named) return named;
   const cloudformation = new CloudFormationClient(values.region ? { region: values.region } : {});
   const { Stacks: stacks } = await cloudformation.send(new DescribeStacksCommand({ StackName: values.stack }));
   const output = stacks?.[0]?.Outputs?.find((entry) => entry.OutputKey === 'TranscriptBucketName')?.OutputValue;
   if (!output) throw new Error(`Stack ${values.stack} has no TranscriptBucketName output; pass --bucket`);
   return output;
}

type Mark = typeof EPOCH;

async function readMark(s3: S3Client, bucket: string): Promise<Mark> {
   try {
      const object = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: STATE_KEY }));
      const parsed = JSON.parse((await object.Body?.transformToString()) ?? '{}') as Partial<Mark>;
      return typeof parsed.completedAt === 'string' && typeof parsed.runId === 'string' ? { completedAt: parsed.completedAt, runId: parsed.runId } : EPOCH;
   } catch (error) {
      if (error instanceof NoSuchKey) return EPOCH;
      throw error;
   }
}

const iso = (value: unknown): string | null => (value instanceof Date ? value.toISOString() : typeof value === 'string' ? value : null);
const num = (value: unknown): number => (value === null || value === undefined ? 0 : Number(value));
const str = (value: unknown): string | null => (typeof value === 'string' && value !== '' ? value : null);

function identifier(prefix: unknown, number: unknown): string | null {
   if (number === null || number === undefined) return null;
   const head = str(prefix);
   return head ? `${head}-${number}` : `#${number}`;
}

function capOutput(type: string, payload: unknown): unknown {
   if (type !== 'run.command.output' || !payload || typeof payload !== 'object') return payload;
   const text = (payload as { text?: unknown }).text;
   if (typeof text !== 'string' || text.length <= COMMAND_OUTPUT_LIMIT) return payload;
   return { ...payload, text: `${text.slice(0, COMMAND_OUTPUT_LIMIT)}\n[…${text.length - COMMAND_OUTPUT_LIMIT} more characters]` };
}

async function main(): Promise<void> {
   const env = berryEnv();
   const dryRun = values['dry-run'] === true;
   const limit = Math.max(1, Math.min(5_000, Number(values.limit) || 200));
   const s3 = new S3Client(values.region ? { region: values.region } : {});
   const bucket = dryRun ? null : await bucketName();
   const explicit = values.run && values.run.length > 0 ? values.run : null;
   const since = values.since ? new Date(values.since) : null;
   if (since && Number.isNaN(since.getTime())) throw new Error(`--since ${values.since} is not a date`);
   const mark = since ? { completedAt: since.toISOString(), runId: EPOCH.runId } : bucket && !explicit ? await readMark(s3, bucket) : EPOCH;

   const sql = postgres(env.databaseUrl, {
      max: 1,
      prepare: false,
      onnotice: () => undefined,
      connection: { application_name: 'berry-run-analyzer-export', default_transaction_read_only: true },
   });
   try {
      const window = explicit
         ? sql`AND r.id IN ${sql(explicit)}`
         : sql`AND (r.completed_at, r.id) > (${mark.completedAt}::timestamptz, ${mark.runId}::uuid)`;
      const runs = await sql`
         SELECT r.id::text, r.kind, r.source, r.status::text AS status, r.created_at, r.started_at, r.completed_at,
                r.failure_code, r.failure_message, r.failure_retryable, r.summary,
                r.input_tokens, r.output_tokens, r.total_tokens, r.cost_micros, r.currency,
                r.ai_runtime_key, r.ai_model_id, r.agent_id::text AS agent_id,
                i.id::text AS issue_id, i.title, i.description, i.number,
                b.name AS board_name, w.name AS workspace_name, w.settings->>'issuePrefix' AS issue_prefix,
                a.name AS agent_name, a.role_key, a.model_provider, a.model_name,
                COALESCE(a.model_tier, a.role_contract->>'tier') AS tier,
                COALESCE(a.role_contract->'allowed_tools', '[]'::jsonb) AS allowed_tools
           FROM runs r
           LEFT JOIN issues i ON i.id = r.issue_id
           LEFT JOIN boards b ON b.id = COALESCE(r.board_id, i.board_id)
           LEFT JOIN workspaces w ON w.id = COALESCE(r.workspace_id, b.workspace_id)
           LEFT JOIN agents a ON a.id = r.agent_id
          WHERE r.status IN ('succeeded', 'failed', 'cancelled')
            ${window}
          ORDER BY r.completed_at, r.id
          LIMIT ${limit}`;
      if (runs.length === 0) {
         console.log('No finished runs to export.');
         return;
      }

      let exported = 0;
      for (const row of runs) {
         const completedAt = iso(row.completed_at) ?? new Date().toISOString();
         const events = await sql`
            SELECT sequence, event_type, occurred_at, payload
              FROM run_events
             WHERE run_id = ${row.id}::uuid
             ORDER BY sequence`;
         const allowed = Array.isArray(row.allowed_tools) ? row.allowed_tools.filter((tool): tool is string => typeof tool === 'string') : [];
         const bundle: RunBundle = redact({
            version: BUNDLE_VERSION,
            exportedAt: new Date().toISOString(),
            run: {
               id: row.id,
               kind: row.kind,
               source: str(row.source),
               status: row.status,
               createdAt: iso(row.created_at) ?? completedAt,
               startedAt: iso(row.started_at),
               completedAt,
               failure: row.failure_code
                  ? { code: row.failure_code, message: row.failure_message ?? '', retryable: row.failure_retryable ?? null }
                  : null,
               summary: str(row.summary),
               usage: {
                  inputTokens: num(row.input_tokens),
                  outputTokens: num(row.output_tokens),
                  totalTokens: num(row.total_tokens),
                  costMicros: row.cost_micros === null ? null : num(row.cost_micros),
                  currency: str(row.currency),
               },
            },
            task: {
               id: str(row.issue_id),
               identifier: identifier(row.issue_prefix, row.number),
               title: str(row.title),
               description: str(row.description),
               workspace: str(row.workspace_name),
               board: str(row.board_name),
            },
            agent: {
               id: row.agent_id,
               name: str(row.agent_name),
               role: str(row.role_key),
               tier: str(row.tier),
               provider: str(row.ai_runtime_key) ?? str(row.model_provider) ?? env.modelProvider ?? 'bedrock',
               model: str(row.ai_model_id) ?? str(row.model_name),
               allowedTools: allowed,
            },
            events: events.map(
               (event): RunEvent => ({
                  sequence: num(event.sequence),
                  type: String(event.event_type),
                  at: iso(event.occurred_at) ?? completedAt,
                  payload: capOutput(String(event.event_type), event.payload),
               })
            ),
         });

         const key = transcriptKey(bundle.run.id, completedAt);
         const body = JSON.stringify(bundle);
         if (dryRun || !bucket) {
            const path = join(here, '../out', key);
            await mkdir(dirname(path), { recursive: true });
            await writeFile(path, body);
            console.log(`wrote ${path}`);
         } else {
            await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: 'application/json' }));
            if (!explicit) {
               await s3.send(
                  new PutObjectCommand({
                     Bucket: bucket,
                     Key: STATE_KEY,
                     Body: JSON.stringify({ completedAt, runId: bundle.run.id }),
                     ContentType: 'application/json',
                  })
               );
            }
            console.log(`uploaded s3://${bucket}/${key} (${bundle.run.status}, ${bundle.events.length} events)`);
         }
         exported += 1;
      }
      console.log(`${exported} run${exported === 1 ? '' : 's'} exported${runs.length === limit ? `; more remain, run again or raise --limit` : ''}.`);
   } finally {
      await sql.end({ timeout: 5 });
   }
}

main().catch((error: unknown) => {
   console.error(error instanceof Error ? error.message : error);
   process.exitCode = 1;
});
