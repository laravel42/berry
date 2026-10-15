/** Outbound-only companion child. No product server, credential stores or checkout creation. */
import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { ClaudeAgentAdapter } from '../adapters/claude.ts';
import { CodexAgentAdapter } from '../adapters/codex.ts';
import { KiroAgentAdapter } from '../adapters/kiro.ts';
import { CLAUDE_CLI_LOGIN, CODEX_CLI_LOGIN, KIRO_CLI_LOGIN, taskEnvelopeSchema } from '../../../runtime/envelope.ts';
import { lifecycleEventSchema, type LifecycleEvent } from '../../../runtime/lifecycle.ts';
import { handleInvocation } from '../container/handler.ts';
import { SessionRegistry } from '../container/sessions.ts';
import { RuntimeAdapterRegistry } from '../adapters/registry.ts';
import { RuntimeAdapterError } from '../adapters/types.ts';

const settingsSchema = z.object({ origin: z.url(), pat: z.string().startsWith('berry_pat_'), id: z.uuid(), workspaceId: z.uuid(), runtimeId: z.enum(['kiro', 'claude', 'codex']), folders: z.array(z.object({ path: z.string(), repositories: z.array(z.string()) })) });
const lines = createInterface({ input: process.stdin });
const first = await lines[Symbol.asyncIterator]().next();
const settings = settingsSchema.parse(JSON.parse(String(first.value)));
lines.close();
const origin = new URL(settings.origin);
if (!['http:', 'https:'].includes(origin.protocol) || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) throw new Error('Invalid Berry origin.');
const adapter = settings.runtimeId === 'claude' ? new ClaudeAgentAdapter({ principalIsolation: 'workstation' }) : settings.runtimeId === 'codex' ? new CodexAgentAdapter({ principalIsolation: 'workstation' }) : new KiroAgentAdapter({ principalIsolation: 'workstation' });
const token = settings.runtimeId === 'claude' ? CLAUDE_CLI_LOGIN : settings.runtimeId === 'codex' ? CODEX_CLI_LOGIN : KIRO_CLI_LOGIN;
const credential = { type: 'oauth' as const, token, accountId: null, accountName: null };
let stopping = false;
let active: AbortController | null = null;
const stop = () => { stopping = true; active?.abort(); };
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
async function post(path: string, body: unknown) {
   const response = await fetch(origin.origin + '/api/v1/companion' + path, {
      method: 'POST', headers: { authorization: `Bearer ${settings.pat}`, 'content-type': 'application/json', ...(path === '/connect' ? { 'Idempotency-Key': randomUUID() } : {}) },
      body: JSON.stringify(body), redirect: 'error', credentials: 'omit', signal: AbortSignal.timeout(10_000),
   });
   if (!response.ok) throw new Error('Companion request refused. Reconnect the companion.');
   return response.json() as Promise<unknown>;
}
const status = await adapter.connectionStatus(credential);
if (status.status !== 'connected') throw new Error('Sign in with the official subscription CLI before starting the bridge.');
await post('/connect', { id: settings.id, workspaceId: settings.workspaceId, runtimeId: settings.runtimeId, models: await adapter.discoverModels(credential), accountId: status.accountId, accountName: status.accountName });
const claimSchema = z.object({ run: z.object({ runId: z.uuid(), claim: z.uuid(), folder: z.string(), leaseMs: z.number(), envelope: taskEnvelopeSchema }).nullable() });
while (!stopping) {
   const { run } = claimSchema.parse(await post('/claim', { id: settings.id, folders: settings.folders }));
   if (stopping) {
      if (run) await post(`/${run.runId}/events`, { claim: run.claim, sequence: 0, event: { type: 'task.failed', failure: { code: 'COMPANION_STOPPED', message: 'The person stopped the workstation bridge.', retryable: false } } });
      break;
   }
   if (!run) { await new Promise(resolve => setTimeout(resolve, 2000)); continue; }
   const controller = new AbortController();
   active = controller;
   const registry = new SessionRegistry();
   // A caller disconnect alone deliberately leaves container sessions warm.
   // Here abort means explicit cancel/lease loss: stop the actual CLI loop.
   const stopSession = () => { registry.stop(run.envelope.runtimeSessionId); };
   controller.signal.addEventListener('abort', stopSession, { once: true });
   let lastBeat = Date.now();
   let beating = false;
   const heartbeat = setInterval(() => {
      if (beating) return;
      beating = true;
      void post(`/${run.runId}/heartbeat`, { claim: run.claim }).then(response => {
         const result = z.object({ cancel: z.boolean() }).parse(response);
         if (result.cancel) controller.abort();
         else lastBeat = Date.now();
      }).catch(() => { if (Date.now() - lastBeat > 30_000) controller.abort(); }).finally(() => { beating = false; });
   }, 5000);
   let sequence = 0;
   let writes = Promise.resolve();
   const send = (event: LifecycleEvent) => {
      const current = sequence++;
      writes = writes.then(async () => {
         // Retry the same sequence after a lost response; the server deduplicates it.
         for (let attempt = 0; ; attempt++) {
            try { await post(`/${run.runId}/events`, { claim: run.claim, sequence: current, event }); return; }
            catch (error) { if (attempt === 2) { controller.abort(); throw error; } }
         }
      });
      void writes.catch(() => controller.abort());
   };
   const directory = await mkdtemp(join(tmpdir(), 'berry-companion-'));
   try {
      if (!settings.folders.some(folder => folder.path === run.folder) || !(await stat(run.folder)).isDirectory()) throw new Error('Open the project folder before starting this run.');
      // The saved origin is the only outbound product endpoint, including when
      // the server's normal compute callback is a private container address.
      run.envelope.berry.apiUrl = origin.origin;
      if (run.envelope.runtime?.id !== settings.runtimeId || run.envelope.runtime.credential.token !== token) throw new Error('Unexpected runtime credential.');
      await handleInvocation(run.envelope, event => send(lifecycleEventSchema.parse(event)), {
         registry, adapters: new RuntimeAdapterRegistry([adapter]),
         modelFactory() { throw new Error('The companion does not call a model provider.'); },
         region: 'us-east-1', credentials: null, workRoot: directory,
         workspaceDirectory: run.folder, processStateDirectory: directory,
         loadMcp: async () => [],
         repository: { async prepare() { return run.folder; }, async deliver() { return null; } },
      }, controller.signal);
   } catch (error) {
      if (!controller.signal.aborted) send({ type: 'task.failed', failure: { code: error instanceof RuntimeAdapterError ? error.code : 'RUNTIME_FAULT', message: 'The subscription CLI failed. Check its official login and the open folder.', retryable: false } });
   } finally {
      await writes.catch(() => undefined);
      clearInterval(heartbeat);
      controller.signal.removeEventListener('abort', stopSession);
      if (controller.signal.aborted) await post(`/${run.runId}/heartbeat`, { claim: run.claim, cancelled: true }).catch(() => undefined);
      await rm(directory, { recursive: true, force: true });
      active = null;
   }
}
