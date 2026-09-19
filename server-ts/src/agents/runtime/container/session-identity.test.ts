import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FIRST_SESSION_UID, SessionIdentities, type OwnerReader } from './session-identity.ts';

/** A work root whose directories are owned by whoever the test says. */
function owners(initial: Record<string, number>): OwnerReader & { set(name: string, uid: number): void } {
   const map = new Map(Object.entries(initial));
   return {
      owner: async (path) => map.get(path.split('/').at(-1)!) ?? null,
      list: async () => [...map.keys()],
      set: (name, uid) => void map.set(name, uid),
   };
}

test('the first session gets the first uid, and each new one the next', async () => {
   const ids = new SessionIdentities('/work', owners({}));
   assert.deepEqual(await ids.for('a'), { uid: FIRST_SESSION_UID, gid: FIRST_SESSION_UID });
   assert.deepEqual(await ids.for('b'), { uid: FIRST_SESSION_UID + 1, gid: FIRST_SESSION_UID + 1 });
   assert.deepEqual(await ids.for('a'), { uid: FIRST_SESSION_UID, gid: FIRST_SESSION_UID });
});

test('a session keeps the uid its directory already has, across a restart', async () => {
   const fs = owners({ a: FIRST_SESSION_UID + 7 });
   assert.equal((await new SessionIdentities('/work', fs).for('a')).uid, FIRST_SESSION_UID + 7);
   // A new session never reuses a uid some directory is owned by.
   assert.equal((await new SessionIdentities('/work', fs).for('b')).uid, FIRST_SESSION_UID + 8);
});

test('a directory from before isolation, owned by the runtime’s old user, gets a uid of its own', async () => {
   const ids = new SessionIdentities('/work', owners({ old: 1000, other: 1000 }));
   const [old, other] = [await ids.for('old'), await ids.for('other')];
   assert.equal(old.uid, FIRST_SESSION_UID);
   assert.equal(other.uid, FIRST_SESSION_UID + 1);
});

test('sessions asked for at the same moment never share a uid', async () => {
   const ids = new SessionIdentities('/work', owners({}));
   const all = await Promise.all(Array.from({ length: 16 }, (_, index) => ids.for(`s${index}`)));
   assert.equal(new Set(all.map((identity) => identity.uid)).size, 16);
});
