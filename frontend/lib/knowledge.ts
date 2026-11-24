import { z } from 'zod';
import { apiFetch } from './api';

/**
 * The workspace knowledge base: nested pages with a markdown body.
 *
 * Every call names the workspace; the server authorizes the caller for it.
 * Deleting moves a page and its sub-pages to the Trash, which can restore
 * them or delete them for good.
 */

const summarySchema = z.object({
   id: z.string(),
   parentId: z.string().nullable(),
   title: z.string(),
   icon: z.string().nullable(),
   sortOrder: z.number(),
   updatedAt: z.string(),
});

const personSchema = z.object({ id: z.string(), name: z.string().nullable() }).nullable();

/** A preset the app draws, or an uploaded image named by its version. */
const coverSchema = z
   .discriminatedUnion('kind', [
      z.object({ kind: z.literal('preset'), name: z.string() }),
      z.object({ kind: z.literal('image'), version: z.string() }),
   ])
   .nullable();

const pageSchema = summarySchema.extend({
   body: z.string(),
   cover: coverSchema.default(null),
   createdAt: z.string(),
   createdBy: personSchema,
   updatedBy: personSchema,
});

const trashedSchema = z.object({
   id: z.string(),
   title: z.string(),
   icon: z.string().nullable(),
   deletedAt: z.string(),
   descendants: z.number(),
});

const hitSchema = z.object({
   id: z.string(),
   title: z.string(),
   icon: z.string().nullable(),
   excerpt: z.string(),
   updatedAt: z.string(),
});

export type KnowledgePageSummary = z.infer<typeof summarySchema>;
export type KnowledgePage = z.infer<typeof pageSchema>;
export type TrashedKnowledgePage = z.infer<typeof trashedSchema>;
export type KnowledgeSearchHit = z.infer<typeof hitSchema>;
export type KnowledgeCover = z.infer<typeof coverSchema>;

export interface KnowledgePagePatch {
   title?: string;
   icon?: string | null;
   body?: string;
   /** A preset's name, or null to remove the cover. */
   cover?: string | null;
   parentId?: string | null;
   sortOrder?: number;
}

const scoped = (workspaceId: string, path: string, query?: Record<string, string>) => {
   const params = new URLSearchParams({ workspaceId, ...query });
   return `/api/v1/knowledge${path}?${params.toString()}`;
};

const nodes = <T extends z.ZodTypeAny>(schema: T) => z.object({ nodes: z.array(schema) });

export async function loadKnowledgeTree(workspaceId: string): Promise<KnowledgePageSummary[]> {
   const json: unknown = await apiFetch(scoped(workspaceId, '/pages'));
   return nodes(summarySchema).parse(json).nodes;
}

export async function loadKnowledgePage(workspaceId: string, id: string): Promise<KnowledgePage> {
   const json: unknown = await apiFetch(scoped(workspaceId, `/pages/${encodeURIComponent(id)}`));
   return pageSchema.parse(json);
}

export async function createKnowledgePage(
   workspaceId: string,
   input: { parentId?: string | null; title?: string; icon?: string | null; body?: string }
): Promise<KnowledgePage> {
   const json: unknown = await apiFetch(scoped(workspaceId, '/pages'), {
      method: 'POST',
      body: JSON.stringify(input),
   });
   return pageSchema.parse(json);
}

export async function updateKnowledgePage(
   workspaceId: string,
   id: string,
   patch: KnowledgePagePatch
): Promise<KnowledgePage> {
   const json: unknown = await apiFetch(scoped(workspaceId, `/pages/${encodeURIComponent(id)}`), {
      method: 'PATCH',
      body: JSON.stringify(patch),
   });
   return pageSchema.parse(json);
}

/** Sets an uploaded image as the page's cover: PNG, JPEG, GIF or WebP, at most 5 MB. */
export async function uploadKnowledgeCover(
   workspaceId: string,
   id: string,
   file: Blob
): Promise<KnowledgePage> {
   const json: unknown = await apiFetch(
      scoped(workspaceId, `/pages/${encodeURIComponent(id)}/cover`),
      {
         method: 'POST',
         headers: { 'content-type': file.type || 'application/octet-stream' },
         body: file,
      }
   );
   return pageSchema.parse(json);
}

/** Where an uploaded cover is served; the version changes with every upload. */
export function knowledgeCoverUrl(workspaceId: string, id: string, version: string): string {
   return scoped(workspaceId, `/pages/${encodeURIComponent(id)}/cover`, { v: version });
}

/** Moves the page and everything under it to the Trash. */
export async function trashKnowledgePage(workspaceId: string, id: string): Promise<void> {
   await apiFetch(scoped(workspaceId, `/pages/${encodeURIComponent(id)}`), { method: 'DELETE' });
}

export async function loadKnowledgeTrash(workspaceId: string): Promise<TrashedKnowledgePage[]> {
   const json: unknown = await apiFetch(scoped(workspaceId, '/trash'));
   return nodes(trashedSchema).parse(json).nodes;
}

export async function restoreKnowledgePage(
   workspaceId: string,
   id: string
): Promise<KnowledgePage> {
   const json: unknown = await apiFetch(
      scoped(workspaceId, `/trash/${encodeURIComponent(id)}/restore`),
      { method: 'POST', body: '{}' }
   );
   return pageSchema.parse(json);
}

/** Permanent: removes a trashed page and what went with it. */
export async function purgeKnowledgePage(workspaceId: string, id: string): Promise<void> {
   await apiFetch(scoped(workspaceId, `/trash/${encodeURIComponent(id)}`), { method: 'DELETE' });
}

export async function searchKnowledge(
   workspaceId: string,
   query: string
): Promise<KnowledgeSearchHit[]> {
   const json: unknown = await apiFetch(scoped(workspaceId, '/search', { q: query }));
   return nodes(hitSchema).parse(json).nodes;
}

/** The tree as parent → ordered children, from the flat list. */
export function childrenByParent(
   pages: KnowledgePageSummary[]
): Map<string | null, KnowledgePageSummary[]> {
   const byParent = new Map<string | null, KnowledgePageSummary[]>();
   for (const page of pages) {
      const list = byParent.get(page.parentId) ?? [];
      list.push(page);
      byParent.set(page.parentId, list);
   }
   for (const list of byParent.values()) list.sort((a, b) => a.sortOrder - b.sortOrder);
   return byParent;
}

/** The chain from the top level down to `id`, for the breadcrumb. */
export function ancestry(pages: KnowledgePageSummary[], id: string): KnowledgePageSummary[] {
   const byId = new Map(pages.map((page) => [page.id, page]));
   const chain: KnowledgePageSummary[] = [];
   let current = byId.get(id);
   while (current && chain.length < 100) {
      chain.unshift(current);
      current = current.parentId ? byId.get(current.parentId) : undefined;
   }
   return chain;
}
