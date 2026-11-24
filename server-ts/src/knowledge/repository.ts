import { toRFC3339, type Sql } from '../db/pool.ts';
import { escapeLike } from '../core/projects.ts';
import { NotFound } from '../identity/errors.ts';

/**
 * The workspace knowledge base (migration 264).
 *
 * Pages nest without limit and are ordered among their siblings. The body is
 * markdown, stored byte-exact. Deleting moves a page and everything under it
 * to the Trash under one `deleted_at` stamp; restoring brings back exactly that
 * set, and purging removes it for good (children cascade).
 *
 * Every query is scoped to the workspace passed in: the routes authorize the
 * caller for it, and the agent tools pass the task token's workspace.
 */

/** A page as it sits in the tree: no body, which can be large. */
export interface KnowledgePageSummary {
   id: string;
   parentId: string | null;
   title: string;
   icon: string | null;
   sortOrder: number;
   updatedAt: string;
}

export interface KnowledgePage extends KnowledgePageSummary {
   body: string;
   /** `preset:<name>`, `upload:<storage key>` or null (migration 265). */
   cover: string | null;
   createdAt: string;
   createdBy: { id: string; name: string | null } | null;
   updatedBy: { id: string; name: string | null } | null;
}

export interface TrashedKnowledgePage {
   id: string;
   title: string;
   icon: string | null;
   deletedAt: string;
   /** Sub-pages that went with it, and come back with it. */
   descendants: number;
}

export interface KnowledgeSearchHit {
   id: string;
   title: string;
   icon: string | null;
   /** A stretch of the body around the first match, or its opening. */
   excerpt: string;
   updatedAt: string;
}

export interface KnowledgePagePatch {
   title?: string;
   /** Null clears it. */
   icon?: string | null;
   body?: string;
   /** A stored cover value (`preset:…` or `upload:…`); null removes it. */
   cover?: string | null;
   /** Null moves the page to the top level. */
   parentId?: string | null;
   sortOrder?: number;
}

/** A move that would put a page inside itself. */
export class KnowledgeCycle extends Error {
   constructor() {
      super('a page cannot move under itself');
      this.name = 'KnowledgeCycle';
   }
}

const SUMMARY_COLUMNS = `page.id, page.parent_id, page.title, page.icon, page.sort_order, page.updated_at`;

export class KnowledgeRepository {
   readonly #sql: Sql;

   constructor(sql: Sql) {
      this.#sql = sql;
   }

   /** Every live page, for the tree. Ordered parent-first only by the client. */
   async tree(workspaceId: string): Promise<KnowledgePageSummary[]> {
      const rows = await this.#sql`
         SELECT ${this.#sql.unsafe(SUMMARY_COLUMNS)}
           FROM knowledge_pages AS page
          WHERE page.workspace_id = ${workspaceId} AND page.deleted_at IS NULL
          ORDER BY page.parent_id NULLS FIRST, page.sort_order, page.created_at, page.id`;
      return rows.map(toSummary);
   }

   async get(workspaceId: string, id: string): Promise<KnowledgePage> {
      const [row] = await this.#sql`
         SELECT ${this.#sql.unsafe(SUMMARY_COLUMNS)}, page.body, page.cover, page.created_at,
                page.created_by, creator.name AS creator_name,
                page.updated_by, editor.name AS editor_name
           FROM knowledge_pages AS page
           LEFT JOIN users AS creator ON creator.id = page.created_by
           LEFT JOIN users AS editor ON editor.id = page.updated_by
          WHERE page.workspace_id = ${workspaceId} AND page.id = ${id} AND page.deleted_at IS NULL`;
      if (!row) throw new NotFound();
      return toPage(row);
   }

   async create(input: {
      workspaceId: string;
      parentId: string | null;
      title: string;
      icon: string | null;
      body: string;
      userId: string;
   }): Promise<KnowledgePage> {
      const id = await this.#sql.begin(async (transaction) => {
         const tx = transaction as unknown as Sql;
         if (input.parentId) await liveParent(tx, input.workspaceId, input.parentId);
         // Last among its siblings: a new page lands at the bottom of its list.
         const [created] = await tx`
            INSERT INTO knowledge_pages
                   (workspace_id, parent_id, title, icon, body, sort_order, created_by, updated_by)
            SELECT ${input.workspaceId}, ${input.parentId}, ${input.title}, ${input.icon}, ${input.body},
                   COALESCE(MAX(sibling.sort_order), 0) + 1, ${input.userId}, ${input.userId}
              FROM (SELECT 1) AS one
              LEFT JOIN knowledge_pages AS sibling
                ON sibling.workspace_id = ${input.workspaceId}
               AND sibling.parent_id IS NOT DISTINCT FROM ${input.parentId}::uuid
               AND sibling.deleted_at IS NULL
            RETURNING id`;
         return created!.id as string;
      });
      return this.get(input.workspaceId, id);
   }

   async update(
      workspaceId: string,
      id: string,
      patch: KnowledgePagePatch,
      userId: string
   ): Promise<KnowledgePage> {
      await this.#sql.begin(async (transaction) => {
         const tx = transaction as unknown as Sql;
         const [locked] = await tx`
            SELECT id FROM knowledge_pages
             WHERE workspace_id = ${workspaceId} AND id = ${id} AND deleted_at IS NULL
             FOR UPDATE`;
         if (!locked) throw new NotFound();
         const moving = patch.parentId !== undefined;
         if (moving && patch.parentId) {
            if (patch.parentId === id) throw new KnowledgeCycle();
            await liveParent(tx, workspaceId, patch.parentId);
            // The new parent may not sit anywhere beneath the page.
            const [cyclic] = await tx`
               WITH RECURSIVE below AS (
                  SELECT id FROM knowledge_pages WHERE parent_id = ${id}
                  UNION
                  SELECT page.id FROM knowledge_pages AS page JOIN below ON page.parent_id = below.id
               )
               SELECT EXISTS (SELECT 1 FROM below WHERE id = ${patch.parentId}) AS cyclic`;
            if (cyclic?.cyclic === true) throw new KnowledgeCycle();
         }
         await tx`
            UPDATE knowledge_pages SET
               title = CASE WHEN ${patch.title !== undefined} THEN ${patch.title ?? ''}::text ELSE title END,
               icon = CASE WHEN ${patch.icon !== undefined} THEN ${patch.icon ?? null}::text ELSE icon END,
               body = CASE WHEN ${patch.body !== undefined} THEN ${patch.body ?? ''}::text ELSE body END,
               cover = CASE WHEN ${patch.cover !== undefined} THEN ${patch.cover ?? null}::text ELSE cover END,
               parent_id = CASE WHEN ${moving} THEN ${patch.parentId ?? null}::uuid ELSE parent_id END,
               sort_order = CASE WHEN ${patch.sortOrder !== undefined} THEN ${patch.sortOrder ?? 0}::double precision ELSE sort_order END,
               updated_by = ${userId},
               updated_at = now()
             WHERE id = ${id}`;
      });
      return this.get(workspaceId, id);
   }

   /** A live page's stored cover value, or a 404 when there is no such page. */
   async cover(workspaceId: string, id: string): Promise<string | null> {
      const [row] = await this.#sql`
         SELECT cover FROM knowledge_pages
          WHERE workspace_id = ${workspaceId} AND id = ${id} AND deleted_at IS NULL`;
      if (!row) throw new NotFound();
      return (row.cover as string | null) ?? null;
   }

   /** Moves the page and everything under it to the Trash, under one stamp. */
   async trash(workspaceId: string, id: string, userId: string): Promise<void> {
      const moved = await this.#sql`
         WITH RECURSIVE subtree AS (
            SELECT id FROM knowledge_pages
             WHERE workspace_id = ${workspaceId} AND id = ${id} AND deleted_at IS NULL
            UNION
            SELECT page.id FROM knowledge_pages AS page
              JOIN subtree ON page.parent_id = subtree.id
             WHERE page.deleted_at IS NULL
         )
         UPDATE knowledge_pages SET deleted_at = now(), deleted_by = ${userId}
          WHERE id IN (SELECT id FROM subtree)`;
      if (moved.count === 0) throw new NotFound();
   }

   /**
    * Brings a trashed page back with the sub-pages deleted along with it. A
    * page whose parent is gone or still in the Trash comes back at the top.
    */
   async restore(workspaceId: string, id: string): Promise<KnowledgePage> {
      await this.#sql.begin(async (transaction) => {
         const tx = transaction as unknown as Sql;
         const [page] = await tx`
            SELECT page.deleted_at, page.parent_id,
                   (parent.id IS NOT NULL AND parent.deleted_at IS NULL) AS parent_live
              FROM knowledge_pages AS page
              LEFT JOIN knowledge_pages AS parent ON parent.id = page.parent_id
             WHERE page.workspace_id = ${workspaceId} AND page.id = ${id} AND page.deleted_at IS NOT NULL
             FOR UPDATE OF page`;
         if (!page) throw new NotFound();
         await tx`
            WITH RECURSIVE subtree AS (
               SELECT id FROM knowledge_pages WHERE id = ${id}
               UNION
               SELECT child.id FROM knowledge_pages AS child
                 JOIN subtree ON child.parent_id = subtree.id
                WHERE child.deleted_at = ${page.deleted_at as string}::timestamptz
            )
            UPDATE knowledge_pages SET deleted_at = NULL, deleted_by = NULL
             WHERE id IN (SELECT id FROM subtree)`;
         if (page.parent_id && page.parent_live !== true) {
            await tx`UPDATE knowledge_pages SET parent_id = NULL WHERE id = ${id}`;
         }
      });
      return this.get(workspaceId, id);
   }

   /** Deletes a trashed page for good; what was under it goes with it. */
   async purge(workspaceId: string, id: string): Promise<void> {
      const removed = await this.#sql`
         DELETE FROM knowledge_pages
          WHERE workspace_id = ${workspaceId} AND id = ${id} AND deleted_at IS NOT NULL`;
      if (removed.count === 0) throw new NotFound();
   }

   /**
    * What the Trash shows: each page deleted on its own account, not the
    * sub-pages that went with it, newest first.
    */
   async trashed(workspaceId: string): Promise<TrashedKnowledgePage[]> {
      const rows = await this.#sql`
         SELECT page.id, page.title, page.icon, page.deleted_at,
                (WITH RECURSIVE below AS (
                    SELECT child.id FROM knowledge_pages AS child
                     WHERE child.parent_id = page.id AND child.deleted_at = page.deleted_at
                    UNION
                    SELECT child.id FROM knowledge_pages AS child
                      JOIN below ON child.parent_id = below.id
                     WHERE child.deleted_at = page.deleted_at
                 ) SELECT count(*) FROM below)::int AS descendants
           FROM knowledge_pages AS page
           LEFT JOIN knowledge_pages AS parent ON parent.id = page.parent_id
          WHERE page.workspace_id = ${workspaceId}
            AND page.deleted_at IS NOT NULL
            AND (parent.id IS NULL OR parent.deleted_at IS DISTINCT FROM page.deleted_at)
          ORDER BY page.deleted_at DESC, page.id
          LIMIT 200`;
      return rows.map((row) => ({
         id: row.id as string,
         title: row.title as string,
         icon: (row.icon as string | null) ?? null,
         deletedAt: toRFC3339(row.deleted_at as string) ?? '',
         descendants: Number(row.descendants),
      }));
   }

   /** Live pages whose title or body contains `query`, title matches first. */
   async search(workspaceId: string, query: string, limit = 20): Promise<KnowledgeSearchHit[]> {
      const needle = query.trim();
      if (!needle) return [];
      const like = escapeLike(needle);
      const rows = await this.#sql`
         SELECT page.id, page.title, page.icon, page.body, page.updated_at,
                (page.title ILIKE ('%' || ${like} || '%') ESCAPE '\\') AS in_title
           FROM knowledge_pages AS page
          WHERE page.workspace_id = ${workspaceId} AND page.deleted_at IS NULL
            AND (page.title ILIKE ('%' || ${like} || '%') ESCAPE '\\'
                 OR page.body ILIKE ('%' || ${like} || '%') ESCAPE '\\')
          ORDER BY in_title DESC, page.updated_at DESC, page.id
          LIMIT ${Math.max(1, Math.min(limit, 50))}`;
      return rows.map((row) => ({
         id: row.id as string,
         title: row.title as string,
         icon: (row.icon as string | null) ?? null,
         excerpt: excerptAround(row.body as string, needle),
         updatedAt: toRFC3339(row.updated_at as string) ?? '',
      }));
   }
}

/** The parent must be a live page of the same workspace. */
async function liveParent(tx: Sql, workspaceId: string, parentId: string): Promise<void> {
   const [parent] = await tx`
      SELECT id FROM knowledge_pages
       WHERE workspace_id = ${workspaceId} AND id = ${parentId} AND deleted_at IS NULL`;
   if (!parent) throw new NotFound();
}

const EXCERPT_CHARS = 200;

/** About `EXCERPT_CHARS` of the body around the first match, on one line. */
export function excerptAround(body: string, needle: string): string {
   const flat = body.replace(/\s+/g, ' ').trim();
   const at = flat.toLowerCase().indexOf(needle.toLowerCase());
   const start = at < 0 ? 0 : Math.max(0, at - Math.floor(EXCERPT_CHARS / 3));
   const slice = flat.slice(start, start + EXCERPT_CHARS);
   return `${start > 0 ? '…' : ''}${slice}${start + EXCERPT_CHARS < flat.length ? '…' : ''}`;
}

function toSummary(row: Record<string, unknown>): KnowledgePageSummary {
   return {
      id: row.id as string,
      parentId: (row.parent_id as string | null) ?? null,
      title: row.title as string,
      icon: (row.icon as string | null) ?? null,
      sortOrder: Number(row.sort_order),
      updatedAt: toRFC3339(row.updated_at as string) ?? '',
   };
}

function toPage(row: Record<string, unknown>): KnowledgePage {
   const person = (id: unknown, name: unknown) =>
      id ? { id: id as string, name: (name as string | null) ?? null } : null;
   return {
      ...toSummary(row),
      body: row.body as string,
      cover: (row.cover as string | null) ?? null,
      createdAt: toRFC3339(row.created_at as string) ?? '',
      createdBy: person(row.created_by, row.creator_name),
      updatedBy: person(row.updated_by, row.editor_name),
   };
}
