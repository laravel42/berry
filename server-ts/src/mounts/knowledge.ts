import { randomUUID } from 'node:crypto';
import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { requireSession, type AuthVariables } from '../auth/middleware.ts';
import type { SessionService } from '../auth/sessions.ts';
import type { BoardRepository } from '../core/boards.ts';
import { json } from '../http/app.ts';
import { assertValid, fieldError } from '../http/body.ts';
import { ApiError } from '../http/errors.ts';
import type { Mount } from '../http/registry.ts';
import { Forbidden, NotFound } from '../identity/errors.ts';
import type { Permission } from '../identity/roles.ts';
import {
   KnowledgeCycle,
   type KnowledgePage,
   type KnowledgePagePatch,
   type KnowledgeRepository,
} from '../knowledge/repository.ts';
import type { ObjectStore } from '../storage/storage.ts';
import { pathId } from './shared.ts';
import { readJson } from './zod-body.ts';

/**
 * `/api/v1/knowledge` — the workspace knowledge base (migration 264).
 *
 * Every route names its workspace with `?workspaceId=`: the caller is
 * authorized for it (read for the tree, a page, the Trash and search; write
 * for everything that changes a page), and a page outside it is a 404. The
 * body is markdown and is stored byte-exact.
 */

export interface KnowledgeOptions {
   sessions: SessionService;
   boards: BoardRepository;
   knowledge: KnowledgeRepository;
   /** Where uploaded covers are kept. Null: presets only, uploads are refused. */
   storage: ObjectStore | null;
}

/** An uploaded cover's ceiling: a banner, not a photo archive. */
const MAX_COVER_BYTES = 5 * 1024 * 1024;

/** The image types a cover may be, by their first bytes, with the extension stored. */
function sniffCover(body: Uint8Array): { contentType: string; extension: string } | null {
   const at = (offset: number, ...bytes: number[]) =>
      bytes.every((byte, index) => body[offset + index] === byte);
   if (at(0, 0x89, 0x50, 0x4e, 0x47)) return { contentType: 'image/png', extension: 'png' };
   if (at(0, 0xff, 0xd8, 0xff)) return { contentType: 'image/jpeg', extension: 'jpg' };
   if (at(0, 0x47, 0x49, 0x46, 0x38)) return { contentType: 'image/gif', extension: 'gif' };
   // RIFF....WEBP
   if (at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) {
      return { contentType: 'image/webp', extension: 'webp' };
   }
   return null;
}

const COVER_TYPES: Record<string, string> = {
   png: 'image/png',
   jpg: 'image/jpeg',
   gif: 'image/gif',
   webp: 'image/webp',
};

/** The storage key inside an `upload:` cover, or null for a preset or none. */
const uploadKey = (cover: string | null) => (cover?.startsWith('upload:') ? cover.slice('upload:'.length) : null);

const TITLE = z.string().max(500);
/** An emoji or a short mark, not prose. */
const ICON = z.string().trim().min(1).max(16).nullable();
/** 1 MiB of markdown, the column's own limit. */
const BODY = z.string().refine((value) => Buffer.byteLength(value, 'utf8') <= 1_048_576, {
   message: 'Body must be at most 1 MiB.',
});
const PAGE_ID = z.string().uuid();

const createSchema = z.strictObject({
   parentId: PAGE_ID.nullable().optional(),
   title: TITLE.optional(),
   icon: ICON.optional(),
   body: BODY.optional(),
});

const patchSchema = z
   .strictObject({
      title: TITLE.optional(),
      icon: ICON.optional(),
      body: BODY.optional(),
      parentId: PAGE_ID.nullable().optional(),
      sortOrder: z.number().finite().optional(),
      /** A preset's name, or null to remove the cover. Images go through POST …/cover. */
      cover: z.string().regex(/^[a-z0-9-]{1,32}$/).nullable().optional(),
   })
   .refine((patch) => Object.keys(patch).length > 0, { message: 'At least one field must be provided.' });

export function knowledgeMounts(options: KnowledgeOptions): Mount[] {
   const route = new Hono<{ Variables: AuthVariables }>();
   route.use('*', requireSession(options.sessions));
   const { knowledge } = options;

   route.get('/pages', async (context) => {
      const workspaceId = await workspaceOf(context, options, 'product.read');
      return json({ nodes: await knowledge.tree(workspaceId) });
   });

   route.get('/search', async (context) => {
      const workspaceId = await workspaceOf(context, options, 'product.read');
      const query = new URL(context.req.url).searchParams.get('q') ?? '';
      return json({ nodes: await knowledge.search(workspaceId, query) });
   });

   route.get('/trash', async (context) => {
      const workspaceId = await workspaceOf(context, options, 'product.read');
      return json({ nodes: await knowledge.trashed(workspaceId) });
   });

   route.post('/pages', async (context) => {
      const workspaceId = await workspaceOf(context, options, 'product.write');
      const input = await readJson(context, createSchema);
      const page = await knowledge
         .create({
            workspaceId,
            parentId: input.parentId ?? null,
            title: input.title ?? '',
            icon: input.icon ?? null,
            body: input.body ?? '',
            userId: context.get('user').id,
         })
         .catch(rethrow('Parent page'));
      return json(serialize(page), 201);
   });

   route.get('/pages/:pageId', async (context) => {
      const workspaceId = await workspaceOf(context, options, 'product.read');
      const id = pathId(context.req.param('pageId'), 'Page');
      return json(serialize(await knowledge.get(workspaceId, id).catch(rethrow('Page'))));
   });

   route.patch('/pages/:pageId', async (context) => {
      const workspaceId = await workspaceOf(context, options, 'product.write');
      const id = pathId(context.req.param('pageId'), 'Page');
      const body = await readJson(context, patchSchema);
      // Only the fields sent: absent leaves the column alone.
      const patch: KnowledgePagePatch = {};
      if (body.title !== undefined) patch.title = body.title;
      if (body.icon !== undefined) patch.icon = body.icon;
      if (body.body !== undefined) patch.body = body.body;
      if (body.parentId !== undefined) patch.parentId = body.parentId;
      if (body.sortOrder !== undefined) patch.sortOrder = body.sortOrder;
      const previous = body.cover !== undefined ? await knowledge.cover(workspaceId, id).catch(rethrow('Page')) : null;
      if (body.cover !== undefined) patch.cover = body.cover === null ? null : `preset:${body.cover}`;
      const page = await knowledge
         .update(workspaceId, id, patch, context.get('user').id)
         .catch(rethrow('Page'));
      if (body.cover !== undefined) await forget(options, uploadKey(previous));
      return json(serialize(page));
   });

   // The body is the image itself, not a form: PNG, JPEG, GIF or WebP, by its
   // bytes rather than its declared type.
   route.post('/pages/:pageId/cover', async (context) => {
      const workspaceId = await workspaceOf(context, options, 'product.write');
      const id = pathId(context.req.param('pageId'), 'Page');
      if (!options.storage) {
         throw new ApiError(503, 'STORAGE_NOT_CONFIGURED', 'This deployment has no file storage for covers.');
      }
      const declared = Number(context.req.header('content-length') ?? '0');
      if (declared > MAX_COVER_BYTES) {
         throw new ApiError(413, 'PAYLOAD_TOO_LARGE', 'A cover must be at most 5 MB.');
      }
      const bytes = new Uint8Array(await context.req.raw.arrayBuffer());
      if (bytes.byteLength > MAX_COVER_BYTES) {
         throw new ApiError(413, 'PAYLOAD_TOO_LARGE', 'A cover must be at most 5 MB.');
      }
      const type = sniffCover(bytes);
      if (!type) {
         assertValid([fieldError('/', 'invalid_type', 'A cover must be a PNG, JPEG, GIF or WebP image.')]);
      }
      const previous = await knowledge.cover(workspaceId, id).catch(rethrow('Page'));
      const key = `knowledge/${workspaceId}/${id}/${randomUUID()}.${type!.extension}`;
      await options.storage.put(key, bytes, { contentType: type!.contentType });
      const page = await knowledge
         .update(workspaceId, id, { cover: `upload:${key}` }, context.get('user').id)
         .catch(async (error: unknown) => {
            await forget(options, key);
            return rethrow('Page')(error);
         });
      await forget(options, uploadKey(previous));
      return json(serialize(page));
   });

   // A new upload gets a new key, so the image behind a URL never changes.
   route.get('/pages/:pageId/cover', async (context) => {
      const workspaceId = await workspaceOf(context, options, 'product.read');
      const id = pathId(context.req.param('pageId'), 'Page');
      const key = uploadKey(await knowledge.cover(workspaceId, id).catch(rethrow('Page')));
      if (!key || !options.storage) throw ApiError.notFound('Cover');
      const bytes = await options.storage.open(key).catch(() => {
         throw ApiError.notFound('Cover');
      });
      const extension = key.slice(key.lastIndexOf('.') + 1);
      return new Response(bytes, {
         status: 200,
         headers: {
            'content-type': COVER_TYPES[extension] ?? 'application/octet-stream',
            'cache-control': 'private, max-age=31536000, immutable',
         },
      });
   });

   // Delete is reversible: the page and its sub-pages go to the Trash.
   route.delete('/pages/:pageId', async (context) => {
      const workspaceId = await workspaceOf(context, options, 'product.write');
      const id = pathId(context.req.param('pageId'), 'Page');
      await knowledge.trash(workspaceId, id, context.get('user').id).catch(rethrow('Page'));
      return new Response(null, { status: 204 });
   });

   route.post('/trash/:pageId/restore', async (context) => {
      const workspaceId = await workspaceOf(context, options, 'product.write');
      const id = pathId(context.req.param('pageId'), 'Page');
      return json(serialize(await knowledge.restore(workspaceId, id).catch(rethrow('Page'))));
   });

   // Permanent: only what is already in the Trash.
   route.delete('/trash/:pageId', async (context) => {
      const workspaceId = await workspaceOf(context, options, 'product.write');
      const id = pathId(context.req.param('pageId'), 'Page');
      await knowledge.purge(workspaceId, id).catch(rethrow('Page'));
      return new Response(null, { status: 204 });
   });

   return [{ prefix: '/api/v1/knowledge', handler: route }];
}

function serialize(page: KnowledgePage): Record<string, unknown> {
   return {
      id: page.id,
      parentId: page.parentId,
      title: page.title,
      icon: page.icon,
      body: page.body,
      cover: wireCover(page.cover),
      sortOrder: page.sortOrder,
      createdAt: page.createdAt,
      updatedAt: page.updatedAt,
      createdBy: page.createdBy,
      updatedBy: page.updatedBy,
   };
}

/**
 * The cover as the web app reads it: a preset by name, or an image with the
 * version that changes with every upload (part of its URL, for the cache).
 */
function wireCover(cover: string | null): Record<string, string> | null {
   if (!cover) return null;
   if (cover.startsWith('preset:')) return { kind: 'preset', name: cover.slice('preset:'.length) };
   const key = uploadKey(cover);
   if (!key) return null;
   const file = key.slice(key.lastIndexOf('/') + 1);
   return { kind: 'image', version: file.slice(0, file.indexOf('.')) };
}

/** Removes an uploaded cover nothing points at any more; a miss is not a failure. */
async function forget(options: KnowledgeOptions, key: string | null): Promise<void> {
   if (!key || !options.storage) return;
   await options.storage.delete(key).catch(() => undefined);
}

/** The `?workspaceId=` the caller may act in with `permission`, or a 404. */
async function workspaceOf(
   context: Context<{ Variables: AuthVariables }>,
   options: KnowledgeOptions,
   permission: Permission
): Promise<string> {
   const raw = new URL(context.req.url).searchParams.get('workspaceId') ?? '';
   if (!z.string().uuid().safeParse(raw).success) {
      assertValid([fieldError('/workspaceId', 'required', 'workspaceId must be a UUID.')]);
   }
   const workspaceId = raw.toLowerCase();
   await options.boards
      .authorizeWorkspace(context.get('user').id, workspaceId, permission)
      .catch((error: unknown) => {
         if (error instanceof NotFound) throw ApiError.notFound('Workspace');
         if (error instanceof Forbidden) throw new ApiError(403, 'FORBIDDEN', 'You may not change this knowledge base.');
         throw error;
      });
   return workspaceId;
}

function rethrow(resource: string) {
   return (error: unknown): never => {
      if (error instanceof NotFound) throw ApiError.notFound(resource);
      if (error instanceof KnowledgeCycle) {
         throw new ApiError(422, 'VALIDATION_FAILED', 'A page cannot move under itself.');
      }
      throw error;
   };
}
