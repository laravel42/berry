import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { ChecksumMismatch, InvalidKey, ObjectNotFound } from './storage.ts';
import { DirectoryStorage } from './directory.ts';

const root = await mkdtemp(path.join(tmpdir(), 'berry-artifacts-'));
after(() => rm(root, { recursive: true, force: true }));

test('a file round-trips under its key and a missing one is absent', async () => {
   const store = new DirectoryStorage({ directory: root });
   const body = new TextEncoder().encode('the inventory');
   const stored = await store.put('artifacts/ws/run/notes.md', body, { contentType: 'text/plain' });
   assert.equal(stored.size, body.byteLength);
   assert.equal(new TextDecoder().decode(await store.open('artifacts/ws/run/notes.md')), 'the inventory');
   const info = await store.stat('artifacts/ws/run/notes.md');
   assert.equal(info.contentType, 'text/plain');
   assert.equal(info.checksumSha256, stored.checksumSha256);
   await store.delete('artifacts/ws/run/notes.md');
   await assert.rejects(() => store.open('artifacts/ws/run/notes.md'), ObjectNotFound);
});

test('a key that leaves the directory is refused, and a bad checksum is not stored', async () => {
   const store = new DirectoryStorage({ directory: root });
   await assert.rejects(() => store.put('../outside.txt', new Uint8Array([1])), InvalidKey);
   await assert.rejects(
      () => store.put('ok.txt', new TextEncoder().encode('x'), { checksumSha256: '00' }),
      ChecksumMismatch
   );
   await assert.rejects(() => store.open('ok.txt'), ObjectNotFound);
});
