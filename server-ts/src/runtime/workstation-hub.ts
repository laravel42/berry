import { randomUUID } from 'node:crypto';
import type { RuntimeControlRequest, RuntimeControlResponse, TaskEnvelope } from './envelope.ts';
import { isTerminal, type LifecycleEvent } from './lifecycle.ts';
import { RuntimeUnavailable } from './transport.ts';

/** How long a heartbeat keeps a workstation online. */
export const WORKSTATION_ONLINE_MS = 45_000;

export const WORKSTATION_OFFLINE =
   'Start berry-bridge on this workstation and pair it from Settings → Runtimes.';

export type ClaimedJob =
   | { id: string; kind: 'control'; request: RuntimeControlRequest }
   | { id: string; kind: 'invoke'; envelope: TaskEnvelope };

export interface WorkstationHub {
   markSeen(userId: string, workstationId?: string): void;
   isOnline(userId: string): boolean;
   isPresent(workstationId: string): boolean;
   wait(userId: string, ms: number, signal?: AbortSignal): Promise<ClaimedJob | null>;
   control(userId: string, request: RuntimeControlRequest, signal?: AbortSignal): Promise<RuntimeControlResponse>;
   invoke(userId: string, envelope: TaskEnvelope, signal: AbortSignal): AsyncIterable<LifecycleEvent>;
   completeControl(jobId: string, response: RuntimeControlResponse): void;
   pushEvents(jobId: string, events: LifecycleEvent[]): void;
   fail(jobId: string, message: string): void;
   owns(jobId: string, userId: string): boolean;
   kind(jobId: string): 'control' | 'invoke' | null;
}

type Waiter = {
   userId: string;
   resolve: (job: ClaimedJob | null) => void;
   timer: ReturnType<typeof setTimeout>;
};

type ControlJob = {
   kind: 'control';
   userId: string;
   claimed: boolean;
   request: RuntimeControlRequest;
   resolve: (response: RuntimeControlResponse) => void;
   reject: (error: Error) => void;
};

type InvokeJob = {
   kind: 'invoke';
   userId: string;
   claimed: boolean;
   envelope: TaskEnvelope;
   push: (event: LifecycleEvent) => void;
   end: () => void;
   reject: (error: Error) => void;
};

type Pending = ControlJob | InvokeJob;

export function createWorkstationHub(options: {
   now?: () => number;
   newId?: () => string;
} = {}): WorkstationHub {
   const now = options.now ?? Date.now;
   const newId = options.newId ?? (() => randomUUID());
   const presence = new Map<string, number>();
   const machines = new Map<string, number>();
   const queued = new Map<string, string[]>();
   const jobs = new Map<string, Pending>();
   const waiters: Waiter[] = [];

   const seen = (userId: string, workstationId?: string): void => {
      presence.set(userId, now());
      if (workstationId) machines.set(workstationId, now());
   };

   const online = (userId: string): boolean => {
      if (waiters.some((waiter) => waiter.userId === userId)) return true;
      const at = presence.get(userId);
      return at !== undefined && now() - at < WORKSTATION_ONLINE_MS;
   };

   const takeQueued = (userId: string): ClaimedJob | null => {
      const ids = queued.get(userId);
      while (ids && ids.length > 0) {
         const id = ids.shift();
         if (!id) continue;
         const job = jobs.get(id);
         if (!job || job.claimed) continue;
         job.claimed = true;
         return toClaim(id, job);
      }
      return null;
   };

   const offer = (id: string, job: Pending): void => {
      const waiterIndex = waiters.findIndex((waiter) => waiter.userId === job.userId);
      if (waiterIndex >= 0) {
         const waiter = waiters[waiterIndex];
         if (waiter) {
            clearTimeout(waiter.timer);
            waiters.splice(waiterIndex, 1);
            job.claimed = true;
            waiter.resolve(toClaim(id, job));
            return;
         }
      }
      const ids = queued.get(job.userId) ?? [];
      ids.push(id);
      queued.set(job.userId, ids);
   };

   const drop = (id: string): Pending | undefined => {
      const job = jobs.get(id);
      jobs.delete(id);
      if (job) {
         const ids = queued.get(job.userId);
         if (ids) {
            const next = ids.filter((queuedId) => queuedId !== id);
            if (next.length === 0) queued.delete(job.userId);
            else queued.set(job.userId, next);
         }
      }
      return job;
   };

   const requireOnline = (userId: string): void => {
      if (!online(userId)) throw new RuntimeUnavailable(WORKSTATION_OFFLINE);
   };

   return {
      markSeen(userId, workstationId) {
         seen(userId, workstationId);
      },
      isOnline(userId) {
         return online(userId);
      },
      isPresent(workstationId) {
         const at = machines.get(workstationId);
         return at !== undefined && now() - at < WORKSTATION_ONLINE_MS;
      },
      wait(userId, ms, signal) {
         seen(userId);
         const ready = takeQueued(userId);
         if (ready) return Promise.resolve(ready);
         return new Promise((resolve) => {
            const waiter: Waiter = {
               userId,
               resolve: (job) => resolve(job),
               timer: setTimeout(() => {
                  const index = waiters.indexOf(waiter);
                  if (index >= 0) waiters.splice(index, 1);
                  resolve(null);
               }, ms),
            };
            const stop = () => {
               const index = waiters.indexOf(waiter);
               if (index >= 0) waiters.splice(index, 1);
               clearTimeout(waiter.timer);
               resolve(null);
            };
            if (signal) {
               if (signal.aborted) {
                  clearTimeout(waiter.timer);
                  resolve(null);
                  return;
               }
               signal.addEventListener('abort', stop, { once: true });
            }
            waiters.push(waiter);
         });
      },
      control(userId, request, signal) {
         const id = newId();
         return new Promise<RuntimeControlResponse>((resolve, reject) => {
            try {
               requireOnline(userId);
            } catch (error) {
               reject(error instanceof Error ? error : new RuntimeUnavailable(WORKSTATION_OFFLINE));
               return;
            }
            const stop = () => {
               drop(id);
               reject(new RuntimeUnavailable('The workstation process was stopped.'));
            };
            if (signal?.aborted) {
               reject(new RuntimeUnavailable('The workstation process was stopped.'));
               return;
            }
            const job: ControlJob = {
               kind: 'control',
               userId,
               claimed: false,
               request,
               resolve: (response) => {
                  signal?.removeEventListener('abort', stop);
                  resolve(response);
               },
               reject: (error) => {
                  signal?.removeEventListener('abort', stop);
                  reject(error);
               },
            };
            jobs.set(id, job);
            if (signal) signal.addEventListener('abort', stop, { once: true });
            offer(id, job);
         });
      },
      invoke(userId, envelope, signal) {
         requireOnline(userId);
         const id = newId();
         const queue: LifecycleEvent[] = [];
         let wake: (() => void) | null = null;
         let done = false;
         let failed: Error | null = null;
         const job: InvokeJob = {
            kind: 'invoke',
            userId,
            claimed: false,
            envelope,
            push(event) {
               queue.push(event);
               if (isTerminal(event)) done = true;
               wake?.();
            },
            end() {
               done = true;
               wake?.();
            },
            reject(error) {
               failed = error;
               wake?.();
            },
         };
         jobs.set(id, job);
         offer(id, job);

         return {
            async *[Symbol.asyncIterator]() {
               const stop = () => {
                  const pending = drop(id);
                  if (pending?.kind === 'invoke' && !done && !failed) {
                     pending.reject(new RuntimeUnavailable('The workstation process was stopped.'));
                  }
               };
               signal.addEventListener('abort', stop, { once: true });
               try {
                  while (!done || queue.length > 0) {
                     if (failed) throw failed;
                     if (signal.aborted) throw new RuntimeUnavailable('The workstation process was stopped.');
                     const event = queue.shift();
                     if (event) {
                        yield event;
                        continue;
                     }
                     if (done) break;
                     await new Promise<void>((resolve) => {
                        wake = resolve;
                     });
                     wake = null;
                  }
                  if (failed) throw failed;
               } finally {
                  signal.removeEventListener('abort', stop);
                  drop(id);
               }
            },
         };
      },
      completeControl(jobId, response) {
         const job = drop(jobId);
         if (!job || job.kind !== 'control') return;
         job.resolve(response);
      },
      pushEvents(jobId, events) {
         const job = jobs.get(jobId);
         if (!job || job.kind !== 'invoke') return;
         for (const event of events) job.push(event);
         if (events.some((event) => isTerminal(event))) drop(jobId);
      },
      fail(jobId, message) {
         const job = drop(jobId);
         if (!job) return;
         job.reject(new RuntimeUnavailable(message));
      },
      owns(jobId, userId) {
         return jobs.get(jobId)?.userId === userId;
      },
      kind(jobId) {
         return jobs.get(jobId)?.kind ?? null;
      },
   };
}

function toClaim(id: string, job: Pending): ClaimedJob {
   return job.kind === 'control'
      ? { id, kind: 'control', request: job.request }
      : { id, kind: 'invoke', envelope: job.envelope };
}
