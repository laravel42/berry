import { goJSON } from '../http/app.ts';
import type { RunRepository } from './repository.ts';

/**
 * One run's events, followed over SSE.
 *
 * Replayed from `run_events` rather than subscribed to, for the same reason the
 * workspace stream is: the rows are the record, so a reader that missed a
 * second gets the second rather than a gap. Two mounts serve this — a run under
 * its task, and a chat task under its conversation — and they differ only in
 * how they authorize, so the pump itself lives here.
 */

/** One page of events per read; a long log arrives in order rather than at once. */
const PAGE = 200;
/**
 * Tighter than the workspace stream's 500ms, because this one is read while a
 * person waits on the words. The runtime already coalesces prose into roughly
 * quarter-second deltas, so a slower poll would simply add to that wait; the
 * query behind it is an indexed `sequence >` on one run.
 */
const POLL_MS = 120;
const HEARTBEAT_MS = 10_000;
/**
 * A ceiling on one connection, so a run that never reaches a terminal event — a
 * dispatcher that died mid-task — cannot hold a stream open forever. The client
 * reconnects with its cursor and loses nothing.
 */
const MAX_MS = 30 * 60 * 1000;

const TERMINAL_EVENTS = new Set(['run.completed', 'run.failed', 'run.cancelled']);

/** The headers a followed run stream answers with. */
export const RUN_STREAM_HEADERS: Readonly<Record<string, string>> = {
   'Content-Type': 'text/event-stream; charset=utf-8',
   'Cache-Control': 'no-cache, no-transform',
   Connection: 'keep-alive',
   // Nginx buffers a body by default, which turns a live stream into one long
   // silence followed by everything at once.
   'X-Accel-Buffering': 'no',
};

/** Whether the caller asked for a stream rather than a page. */
export function wantsEventStream(accept: string | undefined): boolean {
   return (accept ?? '').toLowerCase().includes('text/event-stream');
}

/**
 * The cursor a reader resumes from: a sequence, exclusive.
 *
 * A sequence rather than an event id, because `RunRepository.events` pages on
 * `sequence > after`. Anything unparseable is treated as no cursor, which
 * replays the run from its start — the safe direction, since a stream that
 * silently skipped ahead would drop the very text it exists to deliver.
 */
export function streamCursor(after: string | null, lastEventId: string | undefined): number | null {
   const raw = (after ?? lastEventId ?? '').trim();
   if (raw === '' || !/^\d+$/.test(raw)) return null;
   const parsed = Number(raw);
   return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

/**
 * Follows one run's events until it ends, the client leaves, or the ceiling.
 *
 * `id` on each frame is the event's sequence, which is what a reconnecting
 * client sends back as `Last-Event-ID`, and `event` is the type so a listener
 * can switch without parsing every payload.
 */
export async function followRunEvents(options: {
   controller: ReadableStreamDefaultController<Uint8Array>;
   runs: Pick<RunRepository, 'events'>;
   runId: string;
   after: number | null;
   signal: AbortSignal;
}): Promise<void> {
   const encoder = new TextEncoder();
   const started = Date.now();
   let after = options.after;
   let closed = false;

   const send = (text: string): boolean => {
      if (closed) return false;
      try {
         options.controller.enqueue(encoder.encode(text));
         return true;
      } catch {
         // The client hung up between the read and the write.
         closed = true;
         return false;
      }
   };

   /** Sends everything after the cursor. 'done' once a terminal event is out. */
   const drain = async (): Promise<'following' | 'done' | 'gone'> => {
      for (;;) {
         const found = await options.runs.events(options.runId, after, PAGE);
         for (const event of found) {
            const body = {
               id: event.id,
               type: event.type,
               occurredAt: event.occurredAt,
               boardId: event.boardId,
               issueId: event.issueId,
               runId: event.runId,
               sequence: event.sequence,
               payload: event.payload,
            };
            if (!send(`id: ${event.sequence}\nevent: ${event.type}\ndata: ${goJSON(body)}\n\n`)) {
               return 'gone';
            }
            after = event.sequence;
            // Sent first, then stop: the reader needs to see how the run ended.
            if (TERMINAL_EVENTS.has(event.type)) return 'done';
         }
         // A short page means the log is drained; a full one means there is more
         // behind it, and stopping here would strand the rest.
         if (found.length < PAGE) return 'following';
      }
   };

   try {
      // Tells the browser how long to wait before reconnecting.
      if (!send('retry: 3000\n\n')) return;
      let lastSent = Date.now();
      while (!options.signal.aborted && !closed) {
         const before = after;
         const outcome = await drain();
         if (outcome !== 'following') break;
         if (after !== before) lastSent = Date.now();
         else if (Date.now() - lastSent >= HEARTBEAT_MS) {
            // A comment frame, so a proxy that would close an idle connection
            // sees traffic and the client learns the stream is alive.
            if (!send(': heartbeat\n\n')) break;
            lastSent = Date.now();
         }
         if (Date.now() - started >= MAX_MS) break;
         await sleep(POLL_MS);
      }
   } catch {
      // Any failure ends the stream. The client reconnects with its last id and
      // resumes where it stopped, which is what the cursor is for.
   } finally {
      if (!closed) {
         try {
            options.controller.close();
         } catch {
            // Already closed by the runtime when the socket went.
         }
      }
   }
}

/** The stream a mount returns once it has authorized the run. */
export function runEventStream(options: {
   runs: Pick<RunRepository, 'events'>;
   runId: string;
   after: number | null;
   signal: AbortSignal;
}): Response {
   const stream = new ReadableStream<Uint8Array>({
      start: (controller) => {
         void followRunEvents({ ...options, controller });
      },
   });
   return new Response(stream, { status: 200, headers: { ...RUN_STREAM_HEADERS } });
}

function sleep(ms: number): Promise<void> {
   return new Promise((resolve) => setTimeout(resolve, ms).unref?.());
}
