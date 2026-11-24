'use client';

import { Archive, BookOpen, MoreHorizontal, Plus, Search } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
   DropdownMenu,
   DropdownMenuContent,
   DropdownMenuItem,
   DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { BerryApiError } from '@/lib/api';
import {
   createKnowledgePage,
   loadKnowledgeTree,
   restoreKnowledgePage,
   searchKnowledge,
   trashKnowledgePage,
   updateKnowledgePage,
   type KnowledgePageSummary,
   type KnowledgeSearchHit,
} from '@/lib/knowledge';
import { useSessionStore } from '@/store/session-store';
import { KnowledgeMoveDialog } from './knowledge-move-dialog';
import { KnowledgePageView } from './knowledge-page-view';
import { KnowledgeTrash } from './knowledge-trash';
import { KnowledgeTree, descendantIds } from './knowledge-tree';

/** Which pages are unfolded, kept per workspace on this machine. */
const expandedKey = (workspaceId: string) => `berry.knowledge.expanded.${workspaceId}`;

function readExpanded(workspaceId: string): Set<string> {
   try {
      const stored = JSON.parse(localStorage.getItem(expandedKey(workspaceId)) ?? '[]') as unknown;
      return new Set(Array.isArray(stored) ? stored.filter((id) => typeof id === 'string') : []);
   } catch {
      return new Set();
   }
}

function writeExpanded(workspaceId: string, expanded: Set<string>): void {
   try {
      localStorage.setItem(expandedKey(workspaceId), JSON.stringify([...expanded]));
   } catch {
      /* Losing the folds only costs unfolding them again. */
   }
}

/**
 * The workspace knowledge base, Notion style: a tree of nested pages beside
 * the open page. Pages are created, nested, moved and trashed from the tree;
 * the page itself is edited in place and saved as you type.
 */
export function KnowledgeBase({ pageId }: { pageId: string | null }) {
   const t = useTranslations('knowledge');
   const router = useRouter();
   const { orgId } = useParams<{ orgId: string }>();
   const workspaceId = useSessionStore((state) => state.workspace?.id ?? '');
   const [pages, setPages] = useState<KnowledgePageSummary[] | null>(null);
   const [failed, setFailed] = useState(false);
   const [expanded, setExpanded] = useState<Set<string>>(new Set());
   const [query, setQuery] = useState('');
   const [hits, setHits] = useState<KnowledgeSearchHit[] | null>(null);
   const [trashOpen, setTrashOpen] = useState(false);
   const [moving, setMoving] = useState<KnowledgePageSummary | null>(null);

   const open = useCallback(
      (id: string | null) => router.push(id ? `/${orgId}/knowledge/${id}` : `/${orgId}/knowledge`),
      [router, orgId]
   );

   const refresh = useCallback(async () => {
      if (!workspaceId) return;
      try {
         setPages(await loadKnowledgeTree(workspaceId));
         setFailed(false);
      } catch {
         setFailed(true);
      }
   }, [workspaceId]);

   useEffect(() => {
      if (!workspaceId) return;
      setExpanded(readExpanded(workspaceId));
   }, [workspaceId]);

   // The tree is read again whenever a page opens, so the open page's
   // sub-pages and breadcrumb come from the server, not from a list this
   // screen assembled while pages were being added elsewhere.
   useEffect(() => {
      void refresh();
   }, [refresh, pageId]);

   // The open page's ancestors unfold, so it is visible in the tree.
   useEffect(() => {
      if (!pages || !pageId) return;
      const byId = new Map(pages.map((page) => [page.id, page]));
      const next = new Set(expanded);
      let parent = byId.get(pageId)?.parentId ?? null;
      while (parent && !next.has(parent)) {
         next.add(parent);
         parent = byId.get(parent)?.parentId ?? null;
      }
      if (next.size !== expanded.size) setExpanded(next);
      // Only when the open page or the tree changes.
      // eslint-disable-next-line react-hooks/exhaustive-deps
   }, [pages, pageId]);

   useEffect(() => {
      if (workspaceId) writeExpanded(workspaceId, expanded);
   }, [workspaceId, expanded]);

   // Search as you type, a beat after the last key.
   useEffect(() => {
      const needle = query.trim();
      if (!needle || !workspaceId) {
         setHits(null);
         return;
      }
      const timer = setTimeout(() => {
         void searchKnowledge(workspaceId, needle)
            .then(setHits)
            .catch(() => setHits([]));
      }, 200);
      return () => clearTimeout(timer);
   }, [query, workspaceId]);

   const toggle = useCallback((id: string) => {
      setExpanded((current) => {
         const next = new Set(current);
         if (next.has(id)) next.delete(id);
         else next.add(id);
         return next;
      });
   }, []);

   const create = useCallback(
      async (parentId: string | null) => {
         if (!workspaceId) return;
         try {
            const page = await createKnowledgePage(workspaceId, { parentId });
            // Shown at once, then confirmed by the server's tree.
            setPages((current) => [
               ...(current ?? []).filter((entry) => entry.id !== page.id),
               page,
            ]);
            if (parentId) setExpanded((current) => new Set(current).add(parentId));
            open(page.id);
            void refresh();
         } catch (cause) {
            toast.error(cause instanceof BerryApiError ? cause.message : t('createFailed'));
         }
      },
      [workspaceId, open, refresh, t]
   );

   // Reversible, so no confirmation: the toast offers Undo, and the Trash keeps it.
   const trash = useCallback(
      async (page: KnowledgePageSummary) => {
         if (!workspaceId || !pages) return;
         const gone = new Set([page.id, ...descendantIds(pages, page.id)]);
         try {
            await trashKnowledgePage(workspaceId, page.id);
         } catch (cause) {
            toast.error(cause instanceof BerryApiError ? cause.message : t('deleteFailed'));
            return;
         }
         setPages((current) => (current ?? []).filter((entry) => !gone.has(entry.id)));
         if (pageId && gone.has(pageId)) open(page.parentId);
         toast.success(t('movedToTrash', { title: page.title || t('untitled') }), {
            action: {
               label: t('undo'),
               onClick: () =>
                  void restoreKnowledgePage(workspaceId, page.id)
                     .then(() => refresh())
                     .catch(() => toast.error(t('restoreFailed'))),
            },
         });
      },
      [workspaceId, pages, pageId, open, refresh, t]
   );

   const move = useCallback(
      async (page: KnowledgePageSummary, parentId: string | null) => {
         if (!workspaceId || !pages) return;
         const siblings = pages.filter(
            (entry) => entry.parentId === parentId && entry.id !== page.id
         );
         const sortOrder = Math.max(0, ...siblings.map((entry) => entry.sortOrder)) + 1;
         try {
            await updateKnowledgePage(workspaceId, page.id, { parentId, sortOrder });
            if (parentId) setExpanded((current) => new Set(current).add(parentId));
            await refresh();
         } catch (cause) {
            toast.error(cause instanceof BerryApiError ? cause.message : t('moveFailed'));
         }
      },
      [workspaceId, pages, refresh, t]
   );

   /** The open page's own edits, mirrored into the tree. */
   const onSummary = useCallback((id: string, patch: Partial<KnowledgePageSummary>) => {
      setPages((current) =>
         current
            ? current.map((entry) => (entry.id === id ? { ...entry, ...patch } : entry))
            : current
      );
   }, []);

   const tree = useMemo(() => pages ?? [], [pages]);

   return (
      <div className="flex h-full min-h-0 w-full">
         {/* On a phone one column at a time: the tree, or the open page. */}
         <aside
            className={cn(
               'flex w-64 flex-none flex-col border-r max-md:w-full max-md:border-r-0',
               pageId && 'max-md:hidden'
            )}
         >
            <div className="flex items-center justify-between gap-2 px-3 pt-3 pb-2">
               <h1 className="flex min-w-0 items-center gap-2 truncate">
                  <BookOpen className="size-4 flex-none" aria-hidden />
                  {t('title')}
               </h1>
               <span className="flex flex-none items-center">
                  <DropdownMenu>
                     <DropdownMenuTrigger asChild>
                        <Button
                           size="icon"
                           variant="ghost"
                           aria-label={t('moreActions')}
                           title={t('moreActions')}
                        >
                           <MoreHorizontal className="size-4" />
                        </Button>
                     </DropdownMenuTrigger>
                     <DropdownMenuContent align="end">
                        <DropdownMenuItem onSelect={() => setTrashOpen(true)}>
                           <Archive className="size-4" /> {t('trash')}
                        </DropdownMenuItem>
                     </DropdownMenuContent>
                  </DropdownMenu>
                  <Button
                     size="icon"
                     variant="ghost"
                     aria-label={t('newPage')}
                     title={t('newPage')}
                     onClick={() => void create(null)}
                  >
                     <Plus className="size-4" />
                  </Button>
               </span>
            </div>
            <div className="mx-3 mb-2 flex items-center gap-1.5 rounded-md border px-2">
               <Search className="size-3 flex-none text-muted-foreground" aria-hidden />
               <input
                  type="text"
                  inputMode="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={t('search')}
                  aria-label={t('search')}
                  className="min-w-0 flex-1 bg-transparent py-1.5 text-[length:inherit] outline-none placeholder:text-muted-foreground"
               />
            </div>
            <nav aria-label={t('title')} className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-2">
               {hits !== null ? (
                  hits.length === 0 ? (
                     <p className="px-2 py-1.5 text-muted-foreground">{t('noMatches')}</p>
                  ) : (
                     <ul className="flex flex-col gap-0.5">
                        {hits.map((hit) => (
                           <li key={hit.id}>
                              <button
                                 type="button"
                                 onClick={() => open(hit.id)}
                                 className="flex w-full flex-col rounded-md px-2 py-1.5 text-left hover:bg-accent"
                              >
                                 <span className="truncate">
                                    {hit.icon ? `${hit.icon} ` : ''}
                                    {hit.title || t('untitled')}
                                 </span>
                                 <span
                                    className="line-clamp-2 text-muted-foreground"
                                    data-caption=""
                                 >
                                    {hit.excerpt}
                                 </span>
                              </button>
                           </li>
                        ))}
                     </ul>
                  )
               ) : failed ? (
                  <p className="px-2 py-1.5 text-muted-foreground">{t('loadFailed')}</p>
               ) : pages === null ? (
                  <p className="px-2 py-1.5 text-muted-foreground">{t('loading')}</p>
               ) : (
                  <KnowledgeTree
                     pages={tree}
                     activeId={pageId}
                     expanded={expanded}
                     onToggle={toggle}
                     onOpen={open}
                     onCreateChild={(id) => void create(id)}
                     onMove={setMoving}
                     onTrash={(page) => void trash(page)}
                  />
               )}
            </nav>
         </aside>

         <section
            className={cn('min-h-0 min-w-0 flex-1 overflow-y-auto', !pageId && 'max-md:hidden')}
         >
            {pageId ? (
               <KnowledgePageView
                  key={pageId}
                  workspaceId={workspaceId}
                  pageId={pageId}
                  pages={tree}
                  onOpen={open}
                  onSummary={onSummary}
                  onCreateChild={() => void create(pageId)}
               />
            ) : (
               <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
                  <BookOpen className="size-8 text-muted-foreground" aria-hidden />
                  <h2>{pages && pages.length > 0 ? t('pickTitle') : t('emptyTitle')}</h2>
                  <p className="max-w-sm text-muted-foreground">
                     {pages && pages.length > 0 ? t('pickBody') : t('emptyBody')}
                  </p>
                  <Button size="sm" onClick={() => void create(null)}>
                     <Plus className="size-4" />
                     {t('newPage')}
                  </Button>
               </div>
            )}
         </section>

         <KnowledgeTrash
            workspaceId={workspaceId}
            open={trashOpen}
            onOpenChange={setTrashOpen}
            onRestored={(id) => {
               void refresh();
               open(id);
            }}
         />
         <KnowledgeMoveDialog
            page={moving}
            pages={tree}
            onOpenChange={(next) => {
               if (!next) setMoving(null);
            }}
            onMove={(parentId) => {
               if (moving) void move(moving, parentId);
               setMoving(null);
            }}
         />
      </div>
   );
}
