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
import { GrokAgentAdapter } from '../adapters/grok.ts';
import { KiroAgentAdapter } from '../adapters/kiro.ts';
import { RuntimeAdapterRegistry } from '../adapters/registry.ts';
import { runtimeControlRequestSchema, taskEnvelopeSchema } from '../../../runtime/envelope.ts';

/**
 * Kiro, Claude Code, Codex, and Grok on the machine the person is using.
 *
 * The product server starts this process and writes one JSON document on
 * stdin: a runtime control request, or a task envelope. Lifecycle events come
 * back as one JSON object per line. `kiro-cli`, `claude`, `codex`, or `grok` is a child of this process,
 * found on the workstation PATH. Nothing here listens on a port, and the
 * runtime container is not involved.
 */

const workRoot = (process.env.BERRY_WORKSTATION_WORK_ROOT ?? '').trim() || join(homedir(), '.berry', 'workstation');
await mkdir(workRoot, { recursive: true });

const adapters = new RuntimeAdapterRegistry([
   new KiroAgentAdapter({ principalIsolation: 'workstation' }),
   new ClaudeAgentAdapter({ principalIsolation: 'workstation' }),
   new CodexAgentAdapter({ principalIsolation: 'workstation' }),
   new GrokAgentAdapter({ principalIsolation: 'workstation' }),
]);
const modelFactory = (() => {
   throw new Error('This workstation process does not call a Berry model provider.');
}) as ModelFactory;

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
   const response = await handleRuntimeControl(adapters, control.data.control);
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
   await handleInvocation(
      task,
      (event) => {
         process.stdout.write(`${JSON.stringify(event)}\n`);
      },
      {
         registry: new SessionRegistry(),
         modelFactory,
         region: 'us-east-1',
         credentials: null,
         workRoot,
         repository: snapshotRepository(),
         adapters,
      },
      caller.signal
   );
} catch (error) {
   const message = error instanceof Error ? error.message : 'The workstation process failed.';
   await fail('RUNTIME_FAULT', message, true);
}
await exitWhenFlushed(0);

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
