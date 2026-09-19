import type { Sql } from '../db/pool.ts';
import { redactEnvelope, type TaskEnvelope } from './envelope.ts';
import type { LifecycleEvent } from './lifecycle.ts';
import type { ExchangeObserver, WireRequest, WireResponse } from './transport.ts';

/**
 * Keeps what a model call sent the runtime and what came back, in
 * `run_exchanges`, for the Logs page: the request line and headers, the
 * envelope, the response status and headers, and each lifecycle event with the
 * time it arrived.
 *
 * Nothing secret is written. The envelope goes through `redactEnvelope`, and
 * a header whose name says it carries a credential keeps its name and loses
 * its value. Every write is best-effort and ordered: a log that could not be
 * kept is reported, never allowed to fail or slow the task it describes.
 */

const REDACTED = '[redacted]';

/** Header names that carry credentials: SigV4, bearer tokens, cookies, API keys. */
const SECRET_HEADER = /authorization|token|secret|cookie|api-key|apikey|password|credential|signature/i;

export function redactHeaders(headers: Record<string, string>): Record<string, string> {
   return Object.fromEntries(
      Object.entries(headers).map(([name, value]) => [name, SECRET_HEADER.test(name) ? REDACTED : value])
   );
}

/**
 * What of an agent run's stream the log keeps.
 *
 * An agent run is a loop, not one call: it streams its output text and each
 * command's output in many small deltas, which the run's own transcript
 * already holds in full. The log keeps the shape of the run instead — start,
 * each tool and command with its outcome, token use per model call, and the
 * end — and a delivery keeps the paths it wrote, not the file bytes.
 */
export function agentLogEvent(event: LifecycleEvent): LifecycleEvent | null {
   if (event.type === 'task.message') {
      const kind = event.message.kind;
      if (kind === 'output' || kind === 'command.output') return null;
      return event;
   }
   if (event.type === 'task.completed' && event.result.delivery?.candidate) {
      const { candidate, ...delivery } = event.result.delivery;
      return {
         ...event,
         result: {
            ...event.result,
            delivery: {
               ...delivery,
               candidate: candidate.map((file) => ({
                  path: file.path,
                  mode: file.mode,
                  // The bytes stay out of the log; their size says what was written.
                  content: file.content === null ? null : `[${Buffer.byteLength(file.content, 'utf8')} bytes]`,
               })),
            },
         },
      };
   }
   return event;
}

export interface ExchangeLog {
   observer: ExchangeObserver;
   event(event: LifecycleEvent): void;
   /** The invoke never got an answer: why, in the response's place. */
   failed(message: string): void;
   /** Resolves once every queued write has landed or been given up on. */
   flush(): Promise<void>;
}

export function exchangeLog(
   sql: Sql,
   input: { runId: string; workspaceId: string; envelope: TaskEnvelope },
   options: {
      clock?: () => Date;
      onError?: (error: unknown) => void;
      /** Which events to keep, and in what form; null drops one. Every event by default. */
      keep?: (event: LifecycleEvent) => LifecycleEvent | null;
   } = {}
): ExchangeLog {
   const now = () => (options.clock ?? (() => new Date()))().toISOString();
   let chain: Promise<void> = Promise.resolve();
   const queue = (write: () => Promise<unknown>) => {
      chain = chain.then(write).then(
         () => undefined,
         (error: unknown) => options.onError?.(error)
      );
   };

   const payload = redactEnvelope(input.envelope);
   queue(
      () => sql`
         INSERT INTO run_exchanges (run_id, workspace_id, payload)
         VALUES (${input.runId}, ${input.workspaceId}, ${sql.json(payload as never)})
         ON CONFLICT (run_id) DO UPDATE
            SET payload = EXCLUDED.payload, request = NULL, response = NULL, events = '[]'::jsonb, updated_at = now()`
   );

   const set = (column: 'request' | 'response', value: unknown) =>
      queue(
         () => sql`
            UPDATE run_exchanges SET ${sql(column)} = ${sql.json(value as never)}, updated_at = now()
             WHERE run_id = ${input.runId}`
      );

   return {
      observer: {
         request: (request: WireRequest) => set('request', { ...request, headers: redactHeaders(request.headers) }),
         response: (response: WireResponse) =>
            set('response', { ...response, headers: redactHeaders(response.headers) }),
      },
      event(raw) {
         const event = options.keep ? options.keep(raw) : raw;
         if (!event) return;
         const entry = [{ at: now(), event }];
         queue(
            () => sql`
               UPDATE run_exchanges SET events = events || ${sql.json(entry as never)}, updated_at = now()
                WHERE run_id = ${input.runId}`
         );
      },
      failed(message) {
         queue(
            () => sql`
               UPDATE run_exchanges SET response = ${sql.json({ error: message } as never)}, updated_at = now()
                WHERE run_id = ${input.runId} AND response IS NULL`
         );
      },
      flush: () => chain,
   };
}
