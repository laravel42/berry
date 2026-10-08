import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ensureSessionAccount, type AccountFiles } from './session-account.ts';

function memory(): { files: AccountFiles; text: Map<string, string> } {
   const text = new Map<string, string>([
      ['/etc/passwd', 'root:x:0:0:root:/root:/bin/bash\nnode:x:1000:1000:node:/home/node:/bin/bash\n'],
      ['/etc/group', 'root:x:0:\nnode:x:1000:\n'],
   ]);
   return {
      text,
      files: {
         read: async (path) => text.get(path) ?? '',
         append: async (path, line) => {
            text.set(path, (text.get(path) ?? '') + line);
         },
      },
   };
}

test('a session uid gets a passwd and group name, and a second open does not add another', async () => {
   const { files, text } = memory();
   const identity = { uid: 200_000, gid: 200_000 };
   await ensureSessionAccount(identity, '/mnt/workspace/s', files);
   await ensureSessionAccount(identity, '/mnt/workspace/s', files);
   const passwd = text.get('/etc/passwd') ?? '';
   const lines = passwd.split('\n').filter((line) => line.includes(':200000:'));
   assert.equal(lines.length, 1);
   assert.equal(lines[0], 'berry-200000:x:200000:200000:Berry session:/mnt/workspace/s:/bin/bash');
   assert.match(text.get('/etc/group') ?? '', /berry-200000:x:200000:\n$/);
});
