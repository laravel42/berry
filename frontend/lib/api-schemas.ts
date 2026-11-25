import { z } from 'zod';

/** Cursor page metadata shared by `/api/v1` list endpoints. */
export const pageInfoSchema = z.object({
   hasNextPage: z.boolean(),
   endCursor: z.string().nullable(),
});

export const actorRefSchema = z.object({
   type: z.enum(['user', 'agent']),
   id: z.string(),
   name: z.string(),
   avatarUrl: z.string().nullable(),
});

export function connectionSchema<T extends z.ZodType>(node: T) {
   return z.object({
      nodes: z.array(node),
      pageInfo: pageInfoSchema,
   });
}

/**
 * A random RFC 4122 v4 UUID.
 *
 * `crypto.randomUUID` exists only in a secure context (https or localhost).
 * Opened by its LAN address — `http://192.168.x.x:3000` from a phone — the
 * page is not one, the method is undefined, and every create (workspace,
 * task, comment) threw before its request left. `getRandomValues` has no such
 * restriction, so the fallback builds the same UUID from it.
 */
export function randomUuid(): string {
   if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
   const bytes = crypto.getRandomValues(new Uint8Array(16));
   bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
   bytes[8] = (bytes[8] & 0x3f) | 0x80; // RFC 4122 variant
   const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
   return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Visible ASCII idempotency key accepted by creating POSTs. */
export function newIdempotencyKey(): string {
   return randomUuid();
}
