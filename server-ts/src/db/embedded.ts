import { mkdir, open, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { closeDatabase, openDatabase, type Sql } from './pool.ts';

/**
 * Postgres inside this process.
 *
 * `DATABASE_URL=pglite:<directory>` starts PGlite and a loopback wire-protocol
 * socket, so postgres.js and the `pg` pool keep speaking Postgres. The data
 * directory is the whole database: one process owns it, and a second process
 * is refused rather than allowed to corrupt the files. Host Postgres stays
 * available for any URL that is not this scheme.
 */

const SCHEME = 'pglite:';
const LOCK_NAME = 'berry.lock';

/**
 * How many clients may sit on the socket. PGlite still runs one query at a
 * time. The cap covers the server pool, the auth pool, and a test file's pool.
 * An extended query stays on one client until Sync, so a second connection
 * cannot drop the unnamed portal.
 */
const SOCKET_CONNECTIONS = 32;

export function isEmbeddedDatabase(url: string): boolean {
   return url.startsWith(SCHEME);
}

/** The data directory a `pglite:` URL names. Relative paths resolve from the cwd. */
export function embeddedDataDir(url: string): string {
   const raw = url.slice(SCHEME.length).trim();
   if (!raw) throw new Error('DATABASE_URL=pglite: needs a data directory, for example pglite:./.berry');
   return path.resolve(raw);
}

export interface EmbeddedDatabase {
   /** `postgres://` URL for the loopback socket this process is serving. */
   url: string;
   close(): Promise<void>;
}

/**
 * Starts PGlite on `directory` and serves it at 127.0.0.1 on a free port.
 *
 * The lock is taken before PGlite opens the files. A live pid keeps the
 * directory; a pid that is gone is a crash, and the next start reclaims it.
 */
export async function startEmbeddedDatabase(directory: string): Promise<EmbeddedDatabase> {
   const root = path.resolve(directory);
   await mkdir(root, { recursive: true });
   const release = await lock(root);

   let db: PGlite | undefined;
   let server: PGLiteSocketServer | undefined;
   try {
      db = await PGlite.create(path.join(root, 'pg'));
      server = new PGLiteSocketServer({
         db,
         host: '127.0.0.1',
         port: 0,
         maxConnections: SOCKET_CONNECTIONS,
      });
      await server.start();
      const address = server.getServerConn();
      const url = `postgres://postgres@${address}/postgres`;
      let closed = false;
      return {
         url,
         close: async () => {
            if (closed) return;
            closed = true;
            await server?.stop();
            await db?.close();
            await release();
         },
      };
   } catch (error) {
      await server?.stop().catch(() => {});
      await db?.close().catch(() => {});
      await release();
      throw error;
   }
}

export interface RunningDatabase {
   sql: Sql;
   /**
    * The URL clients in this process should use. A `pglite:` setting becomes
    * the loopback socket; a `postgres:` setting is unchanged.
    */
   url: string;
   close(): Promise<void>;
}

/** Opens whatever `DATABASE_URL` names, including an embedded PGlite directory. */
export async function openFromUrl(url: string): Promise<RunningDatabase> {
   if (!isEmbeddedDatabase(url)) {
      const sql = openDatabase({ url });
      return { sql, url, close: () => closeDatabase(sql) };
   }

   const embedded = await startEmbeddedDatabase(embeddedDataDir(url));
   const sql = openDatabase({ url: embedded.url, max: 1 });
   return {
      sql,
      url: embedded.url,
      close: async () => {
         await closeDatabase(sql);
         await embedded.close();
      },
   };
}

/** Exclusive create of `berry.lock`. Returns a function that deletes it. */
async function lock(directory: string): Promise<() => Promise<void>> {
   const file = path.join(directory, LOCK_NAME);
   for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
         const handle = await open(file, 'wx');
         await handle.writeFile(String(process.pid));
         return async () => {
            await handle.close();
            await rm(file, { force: true });
         };
      } catch (error) {
         if (!isAlreadyThere(error)) throw error;
         const holder = Number((await readFile(file, 'utf8')).trim());
         if (Number.isInteger(holder) && holder > 0 && alive(holder)) {
            throw new Error(`PGlite data directory is in use by process ${holder}: ${directory}`);
         }
         await rm(file, { force: true });
      }
   }
   throw new Error(`could not lock the PGlite data directory: ${directory}`);
}

function isAlreadyThere(error: unknown): boolean {
   return error instanceof Error && 'code' in error && error.code === 'EEXIST';
}

/** `kill(pid, 0)` probes liveness. EPERM means the pid exists and we may not signal it. */
function alive(pid: number): boolean {
   try {
      process.kill(pid, 0);
      return true;
   } catch (error) {
      return error instanceof Error && 'code' in error && error.code === 'EPERM';
   }
}
