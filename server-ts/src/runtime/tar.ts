import { gzipSync } from 'node:zlib';

/**
 * A tar writer, for the one archive Berry builds itself.
 *
 * The runtime already unpacks a repository snapshot with `tar`, as the
 * session's own user, so the overlay of a conflict-resolution run travels the
 * same way rather than as a second format the runtime would have to write to
 * disk with its own (root) hands. Written directly because the need is this
 * small: regular files and symbolic links, in GNU format so a path of any
 * length fits.
 */

export interface TarEntry {
   path: string;
   /** Permission bits only, e.g. `0o644`. */
   mode: number;
   /** File bytes, or the target when `link` is set. */
   content: Buffer;
   link?: boolean;
}

const BLOCK = 512;

export function tarGz(entries: readonly TarEntry[], mtime: Date): Buffer {
   const seconds = Math.floor(mtime.getTime() / 1000);
   const blocks: Buffer[] = [];
   for (const entry of entries) {
      const name = Buffer.from(entry.path, 'utf8');
      const target = entry.link ? entry.content : Buffer.alloc(0);
      // GNU long-name records: the full value travels as the data of a
      // pseudo-entry, and the real header that follows carries a cut copy.
      if (target.length > 100) blocks.push(...record('././@LongLink', 0o644, seconds, 'K', Buffer.alloc(0), nulTerminated(target)));
      if (name.length > 100) blocks.push(...record('././@LongLink', 0o644, seconds, 'L', Buffer.alloc(0), nulTerminated(name)));
      blocks.push(
         ...record(entry.path, entry.mode, seconds, entry.link ? '2' : '0', target, entry.link ? Buffer.alloc(0) : entry.content)
      );
   }
   // Two empty blocks end an archive.
   blocks.push(Buffer.alloc(BLOCK * 2));
   return gzipSync(Buffer.concat(blocks));
}

function nulTerminated(value: Buffer): Buffer {
   return Buffer.concat([value, Buffer.from([0])]);
}

function record(path: string, mode: number, seconds: number, type: string, linkname: Buffer, data: Buffer): Buffer[] {
   const header = Buffer.alloc(BLOCK);
   Buffer.from(path, 'utf8').copy(header, 0, 0, 100);
   header.write(octal(mode & 0o7777, 7), 100, 'ascii');
   header.write(octal(0, 7), 108, 'ascii');
   header.write(octal(0, 7), 116, 'ascii');
   header.write(octal(data.length, 11), 124, 'ascii');
   header.write(octal(seconds, 11), 136, 'ascii');
   // The checksum is computed with its own field read as spaces.
   header.fill(0x20, 148, 156);
   header.write(type, 156, 'ascii');
   linkname.copy(header, 157, 0, 100);
   header.write('ustar  \0', 257, 'binary');
   let sum = 0;
   for (const byte of header) sum += byte;
   header.write(`${octal(sum, 6)} `, 148, 'ascii');
   const padding = (BLOCK - (data.length % BLOCK)) % BLOCK;
   return [header, data, Buffer.alloc(padding)];
}

function octal(value: number, width: number): string {
   return `${value.toString(8).padStart(width, '0')}\0`;
}
