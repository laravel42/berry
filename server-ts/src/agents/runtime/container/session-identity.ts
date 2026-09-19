import { chmod, lstat, readdir } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * A Unix user per session, for a runtime that serves many sessions at once.
 *
 * On AgentCore a session is a microVM, and nothing here applies. Run as one
 * local container, every session's commands ran as the same `node` user as
 * the runtime itself: a command could read the runtime's credentials out of
 * `/proc/1/environ`, list and change any other session's workspace, and kill
 * its processes. Giving each session its own unprivileged uid closes all
 * three with the kernel's ordinary rules, and needs the runtime to be root —
 * which is why this is opt-in and refuses to start otherwise.
 *
 * The uid is not stored anywhere but in the ownership of the session's
 * directory, so it survives a restart and cannot drift from the files it
 * protects.
 */

export interface SessionIdentity {
   uid: number;
   gid: number;
}

/** Well above any account an image ships with, and below the 2^31 some tools stop at. */
export const FIRST_SESSION_UID = 200_000;
export const LAST_SESSION_UID = 2_000_000;

export interface OwnerReader {
   /** The uid owning `path`, or null when nothing is there. Never follows a symlink. */
   owner(path: string): Promise<number | null>;
   list(directory: string): Promise<string[]>;
}

const fsOwners: OwnerReader = {
   async owner(path) {
      try {
         return (await lstat(path)).uid;
      } catch (error) {
         if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null;
         throw error;
      }
   },
   async list(directory) {
      try {
         return await readdir(directory);
      } catch (error) {
         if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return [];
         throw error;
      }
   },
};

export class SessionIdentities {
   readonly #workRoot: string;
   readonly #fs: OwnerReader;
   readonly #known = new Map<string, SessionIdentity>();
   /** Allocation is read-then-claim over the directory listing; one at a time. */
   #queue: Promise<unknown> = Promise.resolve();

   constructor(workRoot: string, fs: OwnerReader = fsOwners) {
      this.#workRoot = workRoot;
      this.#fs = fs;
   }

   /** The session's identity: the one its directory already has, or the next free one. */
   for(key: string): Promise<SessionIdentity> {
      const next = this.#queue.then(() => this.#resolve(key));
      this.#queue = next.catch(() => undefined);
      return next;
   }

   async #resolve(key: string): Promise<SessionIdentity> {
      const known = this.#known.get(key);
      if (known) return known;
      const owner = await this.#fs.owner(join(this.#workRoot, key));
      const uid = owner !== null && inRange(owner) ? owner : await this.#nextFree();
      const identity = { uid, gid: uid };
      this.#known.set(key, identity);
      return identity;
   }

   async #nextFree(): Promise<number> {
      let highest = FIRST_SESSION_UID - 1;
      for (const identity of this.#known.values()) highest = Math.max(highest, identity.uid);
      for (const name of await this.#fs.list(this.#workRoot)) {
         const owner = await this.#fs.owner(join(this.#workRoot, name));
         if (owner !== null && inRange(owner)) highest = Math.max(highest, owner);
      }
      if (highest >= LAST_SESSION_UID) throw new Error('no session uid is left; clear old workspaces');
      return highest + 1;
   }
}

function inRange(uid: number): boolean {
   return uid >= FIRST_SESSION_UID && uid <= LAST_SESSION_UID;
}

/**
 * Closes the work root before the first session runs.
 *
 * A workspace from before isolation is owned by the runtime's old user and
 * open to everyone, and it stays that way until its session next runs and is
 * handed over. Until then it would be readable by every isolated session, so
 * each is shut to all but its owner now: one `chmod` per directory, nothing
 * recursive. The root itself keeps search permission only, so a session can
 * reach its own directory without being able to list the others.
 */
export async function sealWorkRoot(workRoot: string): Promise<number> {
   let sealed = 0;
   for (const name of await fsOwners.list(workRoot)) {
      const path = join(workRoot, name);
      const info = await lstat(path).catch(() => null);
      if (!info?.isDirectory() || (info.mode & 0o077) === 0) continue;
      await chmod(path, 0o700);
      sealed += 1;
   }
   await chmod(workRoot, 0o711).catch(() => undefined);
   return sealed;
}
