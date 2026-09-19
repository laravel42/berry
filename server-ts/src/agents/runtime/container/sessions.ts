import type { Message } from '@strands-agents/sdk';
import type { LocalSession } from './local-session.ts';

/**
 * The sessions this microVM holds warm.
 *
 * AgentCore routes every invoke carrying one `runtimeSessionId` to the same
 * microVM while it lives, so this map is what makes a follow-up run on an
 * issue continue the conversation instead of starting over. Work on one
 * session is serialised: two runs never share a session concurrently on the
 * server side (`issues.active_run_id`), but a retry can arrive while the loop
 * of the run it replaces is still finishing after its stream closed. That
 * orphaned loop is stopped when the retry arrives (see `exclusive`), so the
 * new run starts at once instead of waiting for it.
 */

export interface WarmSession {
   key: string;
   /** Changes when the agent's configuration does; a mismatch restarts cold. */
   fingerprint: string;
   messages: Message[];
   workspace: LocalSession;
   lastUsedAt: number;
}

/** The caller of a queued invocation went away before its turn came. */
export class CallerGone extends Error {
   override readonly name = 'CallerGone';
   constructor() {
      super('the caller disconnected before the invocation started');
   }
}

export class SessionRegistry {
   readonly #sessions = new Map<string, WarmSession>();
   readonly #tails = new Map<string, Promise<unknown>>();
   readonly #controllers = new Map<string, AbortController>();
   /** The invocation running on each session, and whether its caller has gone. */
   readonly #running = new Map<string, { controller: AbortController; orphaned: boolean }>();
   #active = 0;

   /** True while any loop is working — `/ping` answers `HealthyBusy`. */
   get busy(): boolean {
      return this.#active > 0;
   }

   get size(): number {
      return this.#sessions.size;
   }

   get(key: string): WarmSession | undefined {
      return this.#sessions.get(key);
   }

   set(entry: WarmSession): void {
      this.#sessions.set(entry.key, entry);
   }

   drop(key: string): void {
      this.#sessions.delete(key);
   }

   /**
    * Runs `work` once every earlier invocation on `key` has finished.
    *
    * `caller` is the invocation's own lifetime — its HTTP stream. A loop whose
    * caller hangs up keeps running, so a dropped stream with no retry still
    * finishes and leaves its session warm. But it no longer holds the session
    * against the next invocation: a newcomer stops an orphaned loop at its
    * next step instead of waiting out its whole step budget in silence, which
    * is what a run started after an API restart used to do. A queued
    * invocation whose own caller left never starts.
    */
   async exclusive<T>(
      key: string,
      work: (signal: AbortSignal) => Promise<T>,
      caller?: AbortSignal
   ): Promise<T> {
      const running = this.#running.get(key);
      if (running?.orphaned) running.controller.abort();

      const previous = this.#tails.get(key) ?? Promise.resolve();
      const entry = { controller: new AbortController(), orphaned: false };
      const onGone = () => {
         entry.orphaned = true;
      };
      caller?.addEventListener('abort', onGone, { once: true });
      if (caller?.aborted) entry.orphaned = true;
      const next = previous
         .catch(() => undefined)
         .then(async () => {
            if (entry.orphaned) throw new CallerGone();
            this.#active += 1;
            this.#controllers.set(key, entry.controller);
            this.#running.set(key, entry);
            try {
               return await work(entry.controller.signal);
            } finally {
               this.#active -= 1;
               if (this.#controllers.get(key) === entry.controller) this.#controllers.delete(key);
               if (this.#running.get(key) === entry) this.#running.delete(key);
            }
         });
      this.#tails.set(key, next);
      try {
         return await next;
      } finally {
         caller?.removeEventListener('abort', onGone);
         if (this.#tails.get(key) === next) this.#tails.delete(key);
      }
   }

   /** The local stand-in for `StopRuntimeSession`: abort the loop and forget the session. */
   stop(key: string): boolean {
      const controller = this.#controllers.get(key);
      controller?.abort();
      const held = this.#sessions.delete(key);
      return held || controller !== undefined;
   }
}
