import {
   AfterInvocationEvent,
   AfterToolCallEvent,
   BeforeToolCallEvent,
   MessageAddedEvent,
   ModelContentBlockDeltaEvent,
   ModelContentBlockStartEvent,
   ModelStreamUpdateEvent,
   type LocalAgent,
   type Plugin,
} from '@strands-agents/sdk';
import type { ToolDetail } from '../../../runtime/lifecycle.ts';
import { RunTerminal } from '../terminal.ts';
import { OutputBuffer } from '../output-buffer.ts';

/**
 * The run ledger, written from the agent's own lifecycle.
 *
 * This used to be a loop in the executor that read every SDK event, matched
 * its type as a string and decided what the ledger should hear. It is now the
 * SDK telling Berry, through typed hooks, exactly when a tool starts, when it
 * ends, and what the model said in between. The executor no longer reads
 * events at all.
 *
 * A tool call and its result are two rows here as they are in Berry: the pair
 * is what lets a run stream show a tool as running rather than only as having
 * run. Neither carries arguments or output — the ledger is public to everyone
 * who can see the task, and a tool's input is not.
 */

/** The slice of the ledger this plugin writes. Structural, so tests can fake it. */
export interface LedgerSink {
   appendToolStarted(runId: string, toolCallId: string, name: string): Promise<void>;
   appendToolCompleted(runId: string, toolCallId: string, succeeded: boolean, extra?: ToolCompletion): Promise<void>;
   appendOutput(runId: string, channel: string, text: string): Promise<void>;
}

/** What a finished tool call adds to its row: how long it took, and what a file tool touched. */
export interface ToolCompletion {
   durationMs?: number;
   detail?: ToolDetail;
}

/** The result a tool returned, as an object, when it returned one. */
function resultObject(result: unknown): Record<string, unknown> | null {
   const content = (result as { content?: unknown } | null)?.content;
   if (!Array.isArray(content)) return null;
   for (const block of content) {
      const json = (block as { json?: unknown }).json;
      if (json && typeof json === 'object' && !Array.isArray(json)) return json as Record<string, unknown>;
      const text = (block as { text?: unknown }).text;
      if (typeof text === 'string' && text.trimStart().startsWith('{')) {
         try {
            const parsed: unknown = JSON.parse(text);
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
         } catch {
            // Not JSON: nothing to read.
         }
      }
   }
   return null;
}

/**
 * The public facts of a file tool call, for the run transcript: the file a
 * read or write touched and its size, and how many files a listing returned.
 * Null for every other tool, and for a call whose result does not say.
 */
export function toolDetail(name: string, input: unknown, result: unknown): ToolDetail | null {
   const args = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
   const out = resultObject(result);
   const path = typeof args.path === 'string' ? args.path.slice(0, 1024) : undefined;
   const size = (value: unknown) =>
      typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined;
   let detail: ToolDetail | null = null;
   switch (name) {
      case 'list_files':
         if (Array.isArray(out?.files)) detail = { count: out.files.length };
         break;
      case 'read_file':
         detail = { ...(path ? { path } : {}), ...(size(out?.sizeBytes) !== undefined ? { bytes: size(out?.sizeBytes)! } : {}) };
         break;
      case 'write_file':
         detail = {
            ...(path ? { path } : {}),
            ...(typeof args.content === 'string' ? { bytes: Buffer.byteLength(args.content) } : {}),
         };
         break;
      case 'attach_file':
         detail = { ...(path ? { path } : {}), ...(size(out?.sizeBytes) !== undefined ? { bytes: size(out?.sizeBytes)! } : {}) };
         break;
   }
   return detail && Object.keys(detail).length > 0 ? detail : null;
}

export class LedgerPlugin implements Plugin {
   readonly name = 'berry:ledger';
   readonly #ledger: LedgerSink;
   readonly #runId: string;
   readonly #output: OutputBuffer;
   /** Tools the model has called and not yet heard back from. */
   readonly #open = new Map<string, string>();
   /** When each open tool call started, for its duration. */
   readonly #startedAt = new Map<string, number>();
   /** Tool calls whose start row is already written. */
   readonly #announced = new Set<string>();
   /**
    * Set once the ledger refuses a write because the run ended — cancelled
    * while a tool was draining. The run's own ending is already recorded, and
    * nothing that happens after it belongs in the record.
    */
   #terminal = false;

   constructor(options: { ledger: LedgerSink; runId: string }) {
      this.#ledger = options.ledger;
      this.#runId = options.runId;
      this.#output = new OutputBuffer((text) => this.#ledger.appendOutput(this.#runId, 'progress', text));
   }

   initAgent(agent: LocalAgent): void {
      // Text, as it is generated. This is what makes a run readable while it
      // runs rather than only once it is over.
      agent.addHook(ModelStreamUpdateEvent, async (event) => {
         const inner = event.event;
         if (inner instanceof ModelContentBlockDeltaEvent && inner.delta.type === 'textDelta') {
            const text = inner.delta.text;
            await this.#write(() => this.#output.add(text));
         }
         // The tool row, as soon as the model names the tool. A call's input is
         // generated before it runs — sixteen whole files took 54 s — and with
         // the row written only at the call, the run looked stopped for all of it.
         if (inner instanceof ModelContentBlockStartEvent && inner.start?.type === 'toolUseStart') {
            await this.#announce(inner.start.toolUseId, inner.start.name);
         }
      });

      agent.addHook(BeforeToolCallEvent, async (event) => {
         // Usually announced already, from the stream; a model that does not
         // stream its tool calls is announced here.
         await this.#announce(event.toolUse.toolUseId, event.toolUse.name);
         // The duration is the tool's own, not the time the model took to write its input.
         this.#startedAt.set(event.toolUse.toolUseId, Date.now());
      });

      agent.addHook(AfterToolCallEvent, async (event) => {
         const id = event.toolUse.toolUseId;
         this.#open.delete(id);
         const started = this.#startedAt.get(id);
         this.#startedAt.delete(id);
         // A thrown tool and a denied tool both arrive as an error result;
         // the ledger only learns by looking.
         const ok = !event.error && event.result.status !== 'error';
         const detail = ok ? toolDetail(event.toolUse.name, event.toolUse.input, event.result) : null;
         const extra: ToolCompletion = {
            ...(started === undefined ? {} : { durationMs: Math.max(0, Date.now() - started) }),
            ...(detail ? { detail } : {}),
         };
         await this.#write(() => this.#ledger.appendToolCompleted(this.#runId, id, ok, extra));
      });

      // The end of one model message, which the SDK adds after its tools have
      // run. Flushed here so the ledger never shows a turn ending before the
      // text that ended it.
      agent.addHook(MessageAddedEvent, async (event) => {
         if (event.message.role === 'assistant') await this.#write(() => this.#output.flush());
      });

      agent.addHook(AfterInvocationEvent, async () => {
         await this.#write(() => this.#output.flush());
         // Every tool the agent left open failed by omission: the loop ended
         // without a result for it. Recording nothing would leave the run
         // stream showing a tool that never stops running.
         for (const id of this.#open.keys()) {
            await this.#write(() => this.#ledger.appendToolCompleted(this.#runId, id, false));
         }
         this.#open.clear();
         this.#startedAt.clear();
         this.#announced.clear();
      });
   }

   async #announce(id: string, name: string): Promise<void> {
      if (this.#announced.has(id)) return;
      this.#announced.add(id);
      // Before the tool row, so the ledger reads in the order things
      // happened: the agent said something, then called something.
      await this.#write(() => this.#output.flush());
      this.#open.set(id, name);
      await this.#write(() => this.#ledger.appendToolStarted(this.#runId, id, name));
   }

   /** Whatever is buffered, written now. For the executor's error path. */
   async flush(): Promise<void> {
      await this.#write(() => this.#output.flush());
   }

   async #write(operation: () => Promise<void>): Promise<void> {
      if (this.#terminal) return;
      try {
         await operation();
      } catch (error) {
         if (error instanceof RunTerminal) {
            this.#terminal = true;
            return;
         }
         throw error;
      }
   }
}
