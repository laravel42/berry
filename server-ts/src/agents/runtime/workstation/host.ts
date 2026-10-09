import { mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { ModelFactory } from '../model.ts';
import { snapshotRepository } from '../container/snapshot-repository.ts';
import { handleInvocation } from '../container/handler.ts';
import { SessionRegistry } from '../container/sessions.ts';
import { handleRuntimeControl } from '../adapters/control.ts';
import { KiroAgentAdapter } from '../adapters/kiro.ts';
import { RuntimeAdapterRegistry } from '../adapters/registry.ts';
import { runtimeControlRequestSchema, taskEnvelopeSchema } from '../../../runtime/envelope.ts';

/**
 * Kiro on the machine the person is using.
 *
 * The product server starts this process and writes one JSON document on
 * stdin: a runtime control request, or a task envelope. Lifecycle events come
 * back as one JSON object per line. `kiro-cli` is a child of this process,
 * found on the workstation PATH. Nothing here listens on a port, and the
 * runtime container is not involved.
 */

const workRoot = (process.env.BERRY_WORKSTATION_WORK_ROOT ?? '').trim() || join(homedir(), '.berry', 'workstation');
await mkdir(workRoot, { recursive: true });

const adapters = new RuntimeAdapterRegistry([new KiroAgentAdapter({ principalIsolation: 'workstation' })]);
const modelFactory = (() => {
   throw new Error('Kiro runs on this workstation and does not call a Berry model provider.');
}) as ModelFactory;

const chunks: Buffer[] = [];
for await (const chunk of process.stdin) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));

let body: unknown;
try {
   body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
} catch {
   fail('RUNTIME_PROTOCOL', 'The workstation process received a request it could not read.', false);
}

const control = runtimeControlRequestSchema.safeParse(body);
if (control.success) {
   const response = await handleRuntimeControl(adapters, control.data.control);
   process.stdout.write(`${JSON.stringify(response)}\n`);
   process.exit(0);
}

const envelope = taskEnvelopeSchema.safeParse(body);
if (!envelope.success) {
   fail('RUNTIME_PROTOCOL', 'The workstation process received a request it could not read.', false);
}

const caller = new AbortController();
process.once('SIGTERM', () => caller.abort());
try {
   await handleInvocation(
      envelope.data,
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
   fail('RUNTIME_FAULT', message, true);
}
process.exit(0);

function fail(code: string, message: string, retryable: boolean): never {
   process.stdout.write(
      `${JSON.stringify({ type: 'task.failed', failure: { code, message, retryable } })}\n`
   );
   process.exit(1);
}
