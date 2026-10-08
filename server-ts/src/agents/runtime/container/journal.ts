/**
 * Every lifecycle frame of the runs this runtime is working on, kept so a
 * caller that lost the stream can collect the rest of it.
 *
 * A loop whose caller hangs up keeps running (`SessionRegistry.exclusive`),
 * but its frames used to go nowhere: an API restart threw away the run's
 * delivery and its report, and the retry started over from the last
 * checkpoint. 32 runs went that way in one afternoon of editing the server.
 * Now the API reconnects and asks for the frames after the last one it
 * recorded (`resume`), whether the run is still going or already finished.
 *
 * Bounded twice: a run that wrote more than `maxBytes` keeps only its newest
 * frames, and an asker who missed the dropped ones is told it cannot resume
 * rather than handed a stream with a hole; and a finished run's journal is
 * kept for `keepMs`, long enough for an API to come back, not forever.
 */

export interface JournalOptions {
   maxBytes?: number;
   keepMs?: number;
   clock?: () => number;
}

interface Journal {
   session: string;
   /** The index of `frames[0]`: frames before it were dropped for size. */
   first: number;
   frames: string[];
   bytes: number;
   done: boolean;
   endedAt: number | null;
   followers: Set<Follower>;
}

interface Follower {
   frame(frame: string): void;
   end(): void;
}

export type FollowResult =
   | { kind: 'following'; stop: () => void }
   | { kind: 'missing' }
   | { kind: 'trimmed' };

const DEFAULT_MAX_BYTES = 64 * 1024 * 1024;
const DEFAULT_KEEP_MS = 15 * 60_000;

export class RunJournals {
   readonly #journals = new Map<string, Journal>();
   readonly #maxBytes: number;
   readonly #keepMs: number;
   readonly #clock: () => number;

   constructor(options: JournalOptions = {}) {
      this.#maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
      this.#keepMs = options.keepMs ?? DEFAULT_KEEP_MS;
      this.#clock = options.clock ?? Date.now;
   }

   /** Starts a run's journal, replacing an older one for the same run. */
   open(runId: string, session: string): void {
      this.#prune();
      const previous = this.#journals.get(runId);
      if (previous) for (const follower of previous.followers) follower.end();
      this.#journals.set(runId, { session, first: 0, frames: [], bytes: 0, done: false, endedAt: null, followers: new Set() });
   }

   append(runId: string, frame: string): void {
      const journal = this.#journals.get(runId);
      if (!journal || journal.done) return;
      journal.frames.push(frame);
      journal.bytes += frame.length;
      while (journal.bytes > this.#maxBytes && journal.frames.length > 1) {
         journal.bytes -= journal.frames.shift()!.length;
         journal.first += 1;
      }
      for (const follower of journal.followers) follower.frame(frame);
   }

   end(runId: string): void {
      const journal = this.#journals.get(runId);
      if (!journal || journal.done) return;
      journal.done = true;
      journal.endedAt = this.#clock();
      for (const follower of journal.followers) follower.end();
      journal.followers.clear();
   }

   /**
    * The frames after the first `after`, then each new one as it is written,
    * then `end`. Synchronous up to the live tail, so no frame is written
    * between the replay and the subscription.
    */
   follow(runId: string, session: string, after: number, follower: Follower): FollowResult {
      this.#prune();
      const journal = this.#journals.get(runId);
      if (!journal || journal.session !== session) return { kind: 'missing' };
      if (after < journal.first) return { kind: 'trimmed' };
      for (const frame of journal.frames.slice(after - journal.first)) follower.frame(frame);
      if (journal.done) {
         follower.end();
         return { kind: 'following', stop: () => undefined };
      }
      journal.followers.add(follower);
      return { kind: 'following', stop: () => journal.followers.delete(follower) };
   }

   get size(): number {
      return this.#journals.size;
   }

   #prune(): void {
      const cutoff = this.#clock() - this.#keepMs;
      for (const [runId, journal] of this.#journals) {
         if (journal.done && journal.endedAt !== null && journal.endedAt < cutoff) this.#journals.delete(runId);
      }
   }
}
