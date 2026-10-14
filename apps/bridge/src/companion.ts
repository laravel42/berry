import type { RuntimeControlRequest, RuntimeControlResponse, TaskEnvelope } from '../../../server-ts/src/runtime/envelope.ts';
import { isTerminal, type LifecycleEvent } from '../../../server-ts/src/runtime/lifecycle.ts';
import { runWorkstationControl, runWorkstationTask } from '../../../server-ts/src/agents/runtime/workstation/host.ts';

const WAIT_MS = 25_000;
const RETRY_MS = 500;
const HEARTBEAT_MS = 15_000;
const EVENT_FLUSH_MS = 25;
const EVENT_BATCH = 50;

export type UpOptions = {
   url: string;
   token: string;
};

export async function runCompanion(options: UpOptions, signal?: AbortSignal): Promise<void> {
   await loop({
      ...options,
      control: runWorkstationControl,
      invoke: runWorkstationTask,
      ...(signal ? { signal } : {}),
   });
}

export async function loop(options: {
   url: string;
   token: string;
   control: (request: RuntimeControlRequest) => Promise<RuntimeControlResponse>;
   invoke: (
      envelope: TaskEnvelope,
      emit: (event: LifecycleEvent) => void,
      signal?: AbortSignal
   ) => Promise<void>;
   fetch?: typeof fetch;
   sleep?: (ms: number) => Promise<void>;
   signal?: AbortSignal;
}): Promise<void> {
   const base = options.url.replace(/\/+$/, '');
   const fetchImpl = options.fetch ?? fetch;
   const sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
   const headers = {
      authorization: `Bearer ${options.token}`,
      accept: 'application/json',
      'content-type': 'application/json',
   };
   const local = new AbortController();
   const stopLocal = () => local.abort();
   options.signal?.addEventListener('abort', stopLocal, { once: true });
   const signal = local.signal;

   const call = async (path: string, init: RequestInit = {}): Promise<Response> => {
      return fetchImpl(`${base}${path}`, {
         ...init,
         headers: { ...headers, ...(init.headers ?? {}) },
         ...(signal.aborted ? {} : { signal }),
      });
   };

   const beat = async (): Promise<void> => {
      try {
         await call('/api/v1/workstation-bridge/heartbeat', { method: 'POST', body: '' });
      } catch {
         // The jobs poll retries; a missed beat is not a stop.
      }
   };

   const heart = setInterval(() => {
      void beat();
   }, HEARTBEAT_MS);
   if (typeof heart.unref === 'function') heart.unref();

   process.stderr.write('berry-bridge is paired and waiting for work.\n');

   const inbox: Claim[] = [];
   let wake: (() => void) | null = null;
   const pushInbox = (job: Claim): void => {
      inbox.push(job);
      const notify = wake;
      wake = null;
      notify?.();
   };
   const takeInbox = (): Promise<Claim | null> => {
      const ready = inbox.shift();
      if (ready) return Promise.resolve(ready);
      if (signal.aborted) return Promise.resolve(null);
      return new Promise((resolve) => {
         wake = () => resolve(inbox.shift() ?? null);
      });
   };
   signal.addEventListener(
      'abort',
      () => {
         const notify = wake;
         wake = null;
         notify?.();
      },
      { once: true }
   );

   const poll = async (): Promise<void> => {
      while (!signal.aborted) {
         let response: Response;
         try {
            response = await call(`/api/v1/workstation-bridge/jobs?wait=${WAIT_MS}`);
         } catch (error) {
            if (signal.aborted) return;
            const message = error instanceof Error ? error.message : String(error);
            process.stderr.write(`berry-bridge could not reach Berry (${message}). Retrying.\n`);
            await sleep(RETRY_MS);
            continue;
         }
         if (response.status === 204) continue;
         if (response.status === 401) {
            throw new Error('Berry refused the workstation token. Pair again from Settings → Runtimes.');
         }
         if (!response.ok) {
            process.stderr.write(`berry-bridge jobs poll returned ${response.status}. Retrying.\n`);
            await sleep(RETRY_MS);
            continue;
         }
         pushInbox((await response.json()) as Claim);
      }
   };

   const work = async (): Promise<void> => {
      while (!signal.aborted) {
         const job = await takeInbox();
         if (!job) return;
         if (job.kind === 'control') {
            const result = await options.control(job.request);
            const posted = await call(`/api/v1/workstation-bridge/jobs/${job.id}/result`, {
               method: 'POST',
               body: JSON.stringify(result),
            });
            if (!posted.ok && posted.status !== 404) {
               process.stderr.write(`berry-bridge could not post a control result (${posted.status}).\n`);
            }
            continue;
         }
         const caller = new AbortController();
         const stop = () => caller.abort();
         signal.addEventListener('abort', stop, { once: true });
         const batcher = createEventBatcher({
            post: (events) =>
               call(`/api/v1/workstation-bridge/jobs/${job.id}/events`, {
                  method: 'POST',
                  body: JSON.stringify({ events }),
               }),
            onGone: () => caller.abort(),
            signal,
         });
         try {
            await options.invoke(job.envelope, (event) => batcher.push(event), caller.signal);
            await batcher.finish();
         } catch (error) {
            await batcher.finish();
            if (caller.signal.aborted) {
               if (signal.aborted) return;
               continue;
            }
            const message = error instanceof Error ? error.message : 'The workstation process failed.';
            const posted = await call(`/api/v1/workstation-bridge/jobs/${job.id}/events`, {
               method: 'POST',
               body: JSON.stringify({
                  events: [{ type: 'task.failed', failure: { code: 'RUNTIME_FAULT', message, retryable: true } }],
               }),
            });
            if (!posted.ok && posted.status !== 404) {
               process.stderr.write(`berry-bridge could not post a task failure (${posted.status}).\n`);
            }
         } finally {
            signal.removeEventListener('abort', stop);
         }
      }
   };

   try {
      await Promise.all([poll().finally(() => local.abort()), work()]);
   } finally {
      options.signal?.removeEventListener('abort', stopLocal);
      clearInterval(heart);
   }
}

function createEventBatcher(options: {
   post: (events: LifecycleEvent[]) => Promise<Response>;
   onGone: () => void;
   signal?: AbortSignal;
}): { push: (event: LifecycleEvent) => void; finish: () => Promise<void> } {
   let buffer: LifecycleEvent[] = [];
   let timer: ReturnType<typeof setTimeout> | null = null;
   let writing = Promise.resolve();
   let gone = false;
   let primed = false;

   const flush = (): Promise<void> => {
      if (timer !== null) {
         clearTimeout(timer);
         timer = null;
      }
      if (buffer.length === 0) return writing;
      const batch = buffer;
      buffer = [];
      writing = writing.then(async () => {
         if (gone) return;
         try {
            const posted = await options.post(batch);
            if (posted.status === 404) {
               gone = true;
               options.onGone();
               return;
            }
            if (!posted.ok) {
               process.stderr.write(`berry-bridge could not post task events (${posted.status}).\n`);
            }
         } catch (error) {
            if (options.signal?.aborted) return;
            const message = error instanceof Error ? error.message : String(error);
            process.stderr.write(`berry-bridge could not post task events (${message}).\n`);
         }
      });
      return writing;
   };

   return {
      push(event) {
         if (gone) return;
         buffer.push(event);
         if (isTerminal(event) || buffer.length >= EVENT_BATCH) {
            void flush();
            return;
         }
         if (timer !== null) return;
         if (!primed) {
            primed = true;
            queueMicrotask(() => {
               void flush();
            });
            return;
         }
         timer = setTimeout(() => {
            timer = null;
            void flush();
         }, EVENT_FLUSH_MS);
         if (typeof timer.unref === 'function') timer.unref();
      },
      finish: () => flush(),
   };
}

type Claim =
   | { id: string; kind: 'control'; request: RuntimeControlRequest }
   | { id: string; kind: 'invoke'; envelope: TaskEnvelope };
