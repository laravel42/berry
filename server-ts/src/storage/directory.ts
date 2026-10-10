import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
   ChecksumMismatch,
   InvalidKey,
   ObjectNotFound,
   ObjectTooLarge,
   sniffContentType,
   validateKey,
   type PutOptions,
   type StoredObject,
} from './storage.ts';

/**
 * Artifacts on a directory of this machine.
 *
 * The desktop app has no bucket of its own. The same keys S3 would hold are
 * files under one directory, and a download still goes through Berry: there
 * is no signed URL to hand a browser.
 */

export interface DirectoryStorageOptions {
   directory: string;
   maxBytes?: number;
}

const DEFAULT_MAX_BYTES = 25 * 1024 * 1024;

export class DirectoryStorage {
   readonly #root: string;
   readonly #maxBytes: number;

   constructor(options: DirectoryStorageOptions) {
      this.#root = path.resolve(options.directory);
      this.#maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
   }

   async put(key: string, body: Uint8Array, options: PutOptions = {}): Promise<StoredObject> {
      if (body.byteLength > this.#maxBytes) throw new ObjectTooLarge(this.#maxBytes);
      const checksum = createHash('sha256').update(body).digest('hex');
      if (options.checksumSha256 && options.checksumSha256.toLowerCase() !== checksum) {
         throw new ChecksumMismatch();
      }
      const contentType = options.contentType ?? sniffContentType(body);
      const file = this.#file(key);
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, body);
      await writeFile(
         this.#metaPath(file),
         JSON.stringify({ contentType, checksumSha256: checksum, updatedAt: new Date().toISOString() })
      );
      return {
         key,
         size: body.byteLength,
         contentType,
         checksumSha256: checksum,
         etag: checksum,
         metadata: options.metadata ?? {},
         updatedAt: new Date(),
      };
   }

   async open(key: string): Promise<Uint8Array> {
      try {
         return await readFile(this.#file(key));
      } catch (error) {
         if (isMissing(error)) throw new ObjectNotFound(key);
         throw error;
      }
   }

   /** No URL a browser can fetch. Callers fall back to streaming through Berry. */
   async presignGet(
      _key: string,
      _options: { expiresSeconds?: number; contentDisposition?: string } = {}
   ): Promise<{ url: string; expiresAt: Date }> {
      throw new Error('directory storage has no signed URL');
   }

   async stat(key: string): Promise<StoredObject> {
      const file = this.#file(key);
      try {
         const info = await stat(file);
         const meta = await this.#meta(file);
         return {
            key,
            size: info.size,
            contentType: meta?.contentType ?? 'application/octet-stream',
            checksumSha256: meta?.checksumSha256 ?? '',
            etag: meta?.checksumSha256 ?? '',
            metadata: {},
            updatedAt: meta?.updatedAt ? new Date(meta.updatedAt) : info.mtime,
         };
      } catch (error) {
         if (isMissing(error)) throw new ObjectNotFound(key);
         throw error;
      }
   }

   async delete(key: string): Promise<void> {
      const file = this.#file(key);
      await rm(file, { force: true });
      await rm(this.#metaPath(file), { force: true });
   }

   destroy(): void {}

   #file(key: string): string {
      validateKey(key);
      const resolved = path.resolve(this.#root, ...key.split('/'));
      const root = this.#root;
      if (resolved !== root && !resolved.startsWith(root + path.sep)) throw new InvalidKey(key);
      return resolved;
   }

   #metaPath(file: string): string {
      return `${file}.meta.json`;
   }

   async #meta(file: string): Promise<{ contentType?: string; checksumSha256?: string; updatedAt?: string } | null> {
      try {
         return JSON.parse(await readFile(this.#metaPath(file), 'utf8')) as {
            contentType?: string;
            checksumSha256?: string;
            updatedAt?: string;
         };
      } catch (error) {
         if (isMissing(error)) return null;
         throw error;
      }
   }
}

function isMissing(error: unknown): boolean {
   return (error as { code?: string })?.code === 'ENOENT';
}
