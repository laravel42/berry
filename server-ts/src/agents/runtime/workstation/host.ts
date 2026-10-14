import { mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { ModelFactory } from '../model.ts';
import { snapshotRepository } from '../container/snapshot-repository.ts';
import { handleInvocation } from '../container/handler.ts';
import { SessionRegistry } from '../container/sessions.ts';
import { handleRuntimeControl } from '../adapters/control.ts';
import { ClaudeAgentAdapter } from '../adapters/claude.ts';
import { CodexAgentAdapter } from '../adapters/codex.ts';
import { CursorAgentAdapter } from '../adapters/cursor.ts';
import { GrokAgentAdapter } from '../adapters/grok.ts';
import { KimiAgentAdapter } from '../adapters/kimi.ts';
import { KiroAgentAdapter } from '../adapters/kiro.ts';
import { QoderAgentAdapter } from '../adapters/qoder.ts';
import { RuntimeAdapterRegistry } from '../adapters/registry.ts';
import {
   runtimeControlRequestSchema,
   taskEnvelopeSchema,
   type RuntimeControlRequest,
   type RuntimeControlResponse,
   type TaskEnvelope,
} from '../../../runtime/envelope.ts';
import type { LifecycleEvent } from '../../../runtime/lifecycle.ts';

/**
 * Kiro, Claude Code, Codex, Cursor, Kimi, Grok, and Qoder on the machine the
 * person is using. `apps/bridge` is the process that calls this: one JSON
 * document on stdin, or one job claimed from a remote Berry. Lifecycle events
 * come back as one JSON object per line (stdin host) or as posted events
 * (companion). The named CLI is a child of this process, found on the
 * workstation PATH. Nothing here listens on a port, and the runtime container
 * is not involved.
 */
export async function runHost(): Promise<void> {
   const chunks: Buffer[] = [];
   for await (const chunk of process.stdin) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));

   let body: unknown;
   try {
      body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
   } catch {
      await fail('RUNTIME_PROTOCOL', 'The workstation process received a request it could not read.', false);
   }

   const control = runtimeControlRequestSchema.safeParse(body);
   if (control.success) {
      const response = await runWorkstationControl(control.data.control);
      process.stdout.write(`${JSON.stringify(response)}\n`);
      await exitWhenFlushed(0);
   }

   const envelope = taskEnvelopeSchema.safeParse(body);
   const task = envelope.success
      ? envelope.data
      : await fail('RUNTIME_PROTOCOL', 'The workstation process received a request it could not read.', false);

   const caller = new AbortController();
   process.once('SIGTERM', () => caller.abort());
   try {
      await runWorkstationTask(task, (event) => {
         process.stdout.write(`${JSON.stringify(event)}\n`);
      }, caller.signal);
   } catch (error) {
      const message = error instanceof Error ? error.message : 'The workstation process failed.';
      await fail('RUNTIME_FAULT', message, true);
   }
   await exitWhenFlushed(0);
}

export async function runWorkstationControl(
   request: RuntimeControlRequest
): Promise<RuntimeControlResponse> {
   const { adapters } = await workstationRuntime();
   return handleRuntimeControl(adapters, request);
}

export async function runWorkstationTask(
   envelope: TaskEnvelope,
   emit: (event: LifecycleEvent) => void,
   signal?: AbortSignal
): Promise<void> {
   const { adapters, workRoot, modelFactory } = await workstationRuntime();
   await handleInvocation(
      envelope,
      emit,
      {
         registry: new SessionRegistry(),
         modelFactory,
         region: 'us-east-1',
         credentials: null,
         workRoot,
         repository: snapshotRepository(),
         adapters,
      },
      signal
   );
}

type WorkstationRuntime = {
   adapters: RuntimeAdapterRegistry;
   workRoot: string;
   modelFactory: ModelFactory;
};

/** One registry for the life of berry-bridge, so Kiro's ACP process stays warm. */
let workstation: Promise<WorkstationRuntime> | null = null;

async function workstationRuntime(): Promise<WorkstationRuntime> {
   workstation ??= openWorkstationRuntime();
   return workstation;
}

async function openWorkstationRuntime(): Promise<WorkstationRuntime> {
   const workRoot = (process.env.BERRY_WORKSTATION_WORK_ROOT ?? '').trim() || join(homedir(), '.berry', 'workstation');
   await mkdir(workRoot, { recursive: true });
   return {
      workRoot,
      adapters: new RuntimeAdapterRegistry([
         new KiroAgentAdapter({ principalIsolation: 'workstation' }),
         new ClaudeAgentAdapter({ principalIsolation: 'workstation' }),
         new CodexAgentAdapter({ principalIsolation: 'workstation' }),
         new CursorAgentAdapter({ principalIsolation: 'workstation' }),
         new KimiAgentAdapter({ principalIsolation: 'workstation' }),
         new GrokAgentAdapter({ principalIsolation: 'workstation' }),
         new QoderAgentAdapter({ principalIsolation: 'workstation' }),
      ]),
      modelFactory: (() => {
         throw new Error('This workstation process does not call a Berry model provider.');
      }) as ModelFactory,
   };
}

/**
 * `process.exit` returns before a large write reaches the pipe. The last
 * event of a run is the delivery, and it is bigger than the buffer, so the
 * parent would read a cut-off line and reject it.
 */
async function exitWhenFlushed(code: number): Promise<never> {
   await new Promise<void>((resolve) => {
      const done = () => resolve();
      try {
         process.stdout.write('', done);
      } catch {
         done();
      }
   });
   process.exit(code);
}

async function fail(code: string, message: string, retryable: boolean): Promise<never> {
   process.stdout.write(
      `${JSON.stringify({ type: 'task.failed', failure: { code, message, retryable } })}\n`
   );
   return exitWhenFlushed(1);
}
