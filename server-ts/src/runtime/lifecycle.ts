import { z } from 'zod';

/**
 * What a runtime says back about one task, as an SSE stream.
 *
 * Shipped in the runtime image beside the loop, so it imports nothing but zod:
 * the image carries `src/agents/runtime/**` and these two contract files, and a
 * wider import here would drag the server into the container.
 *
 * `task.message` carries exactly what the ledger records today — output text,
 * tool start/stop, command start/output/stop, repository readiness and the
 * verification report — so the server maps each kind onto one ledger method.
 */

/**
 * How long something took, as the runtime measured it.
 *
 * A fact for the reader and never a reason to end a run: a container's wall
 * clock steps back under a 40 ms command, the duration comes out negative, and
 * refusing that frame failed a run whose work was fine. A duration that is not
 * a non-negative number is read as zero.
 */
const durationMs = z.number().nonnegative().catch(0);

export const taskUsageSchema = z.object({
   eventId: z.string().min(1).max(200).optional(),
   model: z.string(),
   inputTokens: z.number().int().nonnegative(),
   outputTokens: z.number().int().nonnegative(),
   cacheReadTokens: z.number().int().nonnegative(),
   cacheWriteTokens: z.number().int().nonnegative(),
});

/**
 * The public facts about a file tool call: which file, how big, how many. The
 * same standing as a command line, which the ledger records in full; a file's
 * contents and a tool's other arguments stay out.
 */
export const toolDetailSchema = z.object({
   path: z.string().max(1024).optional(),
   bytes: z.number().int().nonnegative().optional(),
   count: z.number().int().nonnegative().optional(),
});

export const taskMessageSchema = z.discriminatedUnion('kind', [
   z.object({ kind: z.literal('output'), channel: z.string(), text: z.string() }),
   z.object({ kind: z.literal('tool.started'), toolCallId: z.string(), name: z.string() }),
   z.object({
      kind: z.literal('tool.completed'),
      toolCallId: z.string(),
      succeeded: z.boolean(),
      /** How long the tool took, measured in the runtime. */
      durationMs: durationMs.optional(),
      /** What a file tool touched; see `toolDetail`. Never the tool's content. */
      detail: toolDetailSchema.optional(),
   }),
   z.object({
      kind: z.literal('command.started'),
      commandId: z.string(),
      command: z.string(),
      cwd: z.string().nullable(),
   }),
   z.object({
      kind: z.literal('command.output'),
      commandId: z.string(),
      stream: z.enum(['stdout', 'stderr']),
      text: z.string(),
   }),
   z.object({
      kind: z.literal('command.completed'),
      commandId: z.string(),
      exitCode: z.number().int().nullable(),
      durationMs,
      truncated: z.boolean(),
   }),
   z.object({
      kind: z.literal('repository.ready'),
      repository: z.string(),
      branch: z.string(),
      baseCommit: z.string(),
   }),
   z.object({
      kind: z.literal('verified'),
      passed: z.boolean(),
      complete: z.boolean(),
      durationMs,
      results: z.array(
         z.object({
            command: z.string(),
            exitCode: z.number().int().nullable(),
            passed: z.boolean(),
            durationMs,
            error: z.string().nullable(),
         })
      ),
   }),
]);

export const taskDeliverySchema = z.object({
   /** Untrusted candidate bytes; the control plane alone authorizes and publishes them. */
   candidate: z.array(z.object({
      path: z.string().min(1).max(4096).refine((path) => !path.startsWith('/') && !path.includes('\\') && !path.includes('\0') && path.split('/').every((part) => part !== '' && part !== '.' && part !== '..' && part.toLowerCase() !== '.git')),
      mode: z.enum(['100644', '100755', '120000']),
      content: z.string().max(8 * 1024 * 1024).nullable(),
   })).max(2000).optional(),
   /**
    * True when the runtime laid the task branch over the default branch head
    * before the agent worked (a conflict-resolution run). The candidate is
    * then the whole difference from the default branch. A runtime image that
    * predates such runs never says so, and the control plane refuses to
    * publish its candidate as a merge: it would drop the branch's work.
    */
   merged: z.boolean().optional(),
   committed: z.boolean(),
   commit: z.string().nullable(),
   branch: z.string(),
   filesChanged: z.number().int().nonnegative(),
   insertions: z.number().int().nonnegative(),
   deletions: z.number().int().nonnegative(),
   files: z.array(z.string()),
});

export const taskResultSchema = z.object({
   text: z.string(),
   truncated: z.boolean(),
   /** The structured answer of a completion task, already validated by the model's schema. */
   structured: z.unknown().optional(),
   delivery: taskDeliverySchema.nullable(),
});

export const taskFailureSchema = z.object({
   code: z.string().min(1),
   message: z.string(),
   retryable: z.boolean(),
});

/**
 * What the model itself returned on a completion, before Berry reads it: every
 * message of this call in the provider's own block shape (`text`, `toolUse`
 * with its raw input, `reasoning`, ...) and why it stopped. A structured
 * answer arrives as a `toolUse`, so `task.completed.result.text` is empty and
 * only this shows what was actually said. Emitted for the prompt log; the
 * server keeps it and decides nothing from it.
 */
export const taskModelResponseSchema = z.object({
   stopReason: z.string(),
   messages: z.array(
      // Loose: the provider's per-message metadata (its token usage) rides along.
      z.looseObject({
         role: z.enum(['user', 'assistant']),
         content: z.array(z.record(z.string(), z.unknown())),
      })
   ),
   /** True when the messages were cut to stay inside one frame. */
   truncated: z.boolean(),
});

export const lifecycleEventSchema = z.discriminatedUnion('type', [
   z.object({ type: z.literal('task.started') }),
   z.object({ type: z.literal('task.model'), response: taskModelResponseSchema }),
   z.object({ type: z.literal('task.message'), message: taskMessageSchema }),
   z.object({ type: z.literal('task.usage'), usage: taskUsageSchema }),
   z.object({ type: z.literal('task.completed'), result: taskResultSchema }),
   z.object({
      type: z.literal('task.failed'),
      failure: taskFailureSchema,
      /**
       * Work a run stopped at a limit had already done, submitted as a
       * checkpoint: the control plane publishes it to the task's branch (no
       * pull request), and the next run on the task starts from there.
       */
      delivery: taskDeliverySchema.optional(),
   }),
]);

export type TaskUsage = z.infer<typeof taskUsageSchema>;
export type ToolDetail = z.infer<typeof toolDetailSchema>;
export type TaskMessage = z.infer<typeof taskMessageSchema>;
export type TaskDelivery = z.infer<typeof taskDeliverySchema>;
export type TaskResult = z.infer<typeof taskResultSchema>;
export type TaskFailure = z.infer<typeof taskFailureSchema>;
export type TaskModelResponse = z.infer<typeof taskModelResponseSchema>;
export type LifecycleEvent = z.infer<typeof lifecycleEventSchema>;

export class LifecycleStreamError extends Error {
   override readonly name = 'LifecycleStreamError';
}

/** One SSE frame. The payload is the whole event, so a frame stands alone. */
export function encodeLifecycle(event: LifecycleEvent): string {
   return `data: ${JSON.stringify(event)}\n\n`;
}

export function isTerminal(event: LifecycleEvent): boolean {
   return event.type === 'task.completed' || event.type === 'task.failed';
}

/**
 * Frames out of a byte stream, in order.
 *
 * A malformed frame throws rather than being skipped: a lost `task.completed`
 * would turn a finished run into `RUNTIME_STREAM_ENDED`, and a lost usage frame
 * would under-bill quietly. Comment frames (`: ping`) are keepalives.
 */
export async function* parseLifecycleStream(
   chunks: AsyncIterable<Uint8Array | string>
): AsyncGenerator<LifecycleEvent> {
   const decoder = new TextDecoder();
   let buffer = '';
   for await (const chunk of chunks) {
      buffer += typeof chunk === 'string' ? chunk : decoder.decode(chunk, { stream: true });
      buffer = buffer.replaceAll('\r\n', '\n');
      let boundary = buffer.indexOf('\n\n');
      while (boundary !== -1) {
         const frame = buffer.slice(0, boundary);
         buffer = buffer.slice(boundary + 2);
         const event = decodeFrame(frame);
         if (event) yield event;
         boundary = buffer.indexOf('\n\n');
      }
   }
   buffer = (buffer + decoder.decode()).replaceAll('\r\n', '\n');
   if (buffer.trim() !== '') {
      const event = decodeFrame(buffer);
      if (event) yield event;
   }
}

function decodeFrame(frame: string): LifecycleEvent | null {
   const data = frame
      .split('\n')
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).replace(/^ /, ''))
      .join('\n');
   if (data === '') return null;
   let parsed: unknown;
   try {
      parsed = JSON.parse(data);
   } catch {
      throw new LifecycleStreamError('the runtime sent a lifecycle frame that is not JSON');
   }
   const result = lifecycleEventSchema.safeParse(parsed);
   if (!result.success) {
      throw new LifecycleStreamError(
         `the runtime sent an unrecognised lifecycle frame: ${result.error.issues
            .map((issue) => issue.path.join('.') || issue.message)
            .join(', ')}`
      );
   }
   return result.data;
}
