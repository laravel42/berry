import { appendFile, readFile } from 'node:fs/promises';
import type { SessionIdentity } from './session-identity.ts';

/**
 * A name for a session uid.
 *
 * Isolation hands each session a uid at 200000 and above, and the image has
 * no passwd entry for it. `whoami` and anything that calls `getpwuid`
 * (embedded-postgres does, through `os.userInfo`) then fail before the work
 * starts. The entry is written when the session opens. The uid is still the
 * only thing stored with the workspace; this file is rebuilt from it.
 */

export interface AccountFiles {
   read(path: string): Promise<string>;
   append(path: string, text: string): Promise<void>;
}

const realFiles: AccountFiles = {
   read: (path) => readFile(path, 'utf8'),
   append: (path, text) => appendFile(path, text),
};

let queue: Promise<unknown> = Promise.resolve();

export function ensureSessionAccount(
   identity: SessionIdentity,
   home: string,
   files: AccountFiles = realFiles
): Promise<void> {
   const next = queue.then(() => writeAccount(identity, home, files));
   queue = next.catch(() => undefined);
   return next;
}

async function writeAccount(identity: SessionIdentity, home: string, files: AccountFiles): Promise<void> {
   const name = `berry-${identity.uid}`;
   const passwd = await files.read('/etc/passwd').catch(() => '');
   if (!listed(passwd, identity.uid)) {
      await files.append(
         '/etc/passwd',
         `${name}:x:${identity.uid}:${identity.gid}:Berry session:${home}:/bin/bash\n`
      );
   }
   const group = await files.read('/etc/group').catch(() => '');
   if (!listed(group, identity.gid)) {
      await files.append('/etc/group', `${name}:x:${identity.gid}:\n`);
   }
}

/** True when some line already names this id in the third colon field. */
function listed(text: string, id: number): boolean {
   return text.split('\n').some((line) => line.split(':')[2] === String(id));
}
