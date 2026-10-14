import type { RuntimeControlRequest, RuntimeControlResponse, TaskEnvelope } from './envelope.ts';
import type { LifecycleEvent } from './lifecycle.ts';
import type { WorkstationHub } from './workstation-hub.ts';

export interface WorkstationKiro {
   control(
      request: RuntimeControlRequest,
      userId: string,
      signal?: AbortSignal
   ): Promise<RuntimeControlResponse>;
   invoke(envelope: TaskEnvelope, userId: string, signal: AbortSignal): AsyncIterable<LifecycleEvent>;
}

/**
 * Enqueues workstation control and tasks for berry-bridge to claim.
 *
 * The product server does not spawn the CLI. The laptop process dials Berry,
 * takes one job, and runs it against the CLIs already signed in there.
 */
export function workstationKiro(
   hub: WorkstationHub,
   options?: { apiUrl?: string }
): WorkstationKiro {
   return {
      control(request, userId, signal) {
         return hub.control(userId, request, signal);
      },
      invoke(envelope, userId, signal) {
         const apiUrl = options?.apiUrl;
         const next =
            apiUrl && envelope.berry
               ? { ...envelope, berry: { ...envelope.berry, apiUrl } }
               : envelope;
         return hub.invoke(userId, next, signal);
      },
   };
}
