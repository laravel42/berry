'use client';

import {
   Archive,
   ArchiveRestore,
   ChevronRight,
   History,
   Pencil,
   Search,
   Trash2,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useMemo, useRef, useState, type SyntheticEvent } from 'react';
import { toast } from 'sonner';

import {
   DropdownMenu,
   DropdownMenuContent,
   DropdownMenuItem,
   DropdownMenuSeparator,
   DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { BerryApiError } from '@/lib/api';
import {
   deleteSession,
   listThreads,
   renameSession,
   setSessionArchived,
   type ChatThread,
} from '@/lib/chat';
import { shortTimeAgo } from '@/lib/time-ago';
import { cn } from '@/lib/utils';

/** How many sessions each list shows; the search reaches the rest. */
const SHOWN = 20;

/** Keys the menu itself needs from the search box: moving into the list and closing. */
const MENU_KEYS = new Set(['ArrowDown', 'ArrowUp', 'Escape', 'Tab']);

/**
 * Keeps a row action's pointer and click off the row: a menu item selects on
 * pointer-up as well as on click, so stopping only the click still opens it.
 */
const own = (event: SyntheticEvent) => {
   event.stopPropagation();
   event.preventDefault();
};

/** Agent sessions only, newest first. */
const agentSessions = (found: ChatThread[]) =>
   found.filter((thread) => thread.agentId).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

/**
 * Earlier chat sessions, for the floating window's header.
 *
 * Loaded each time the menu opens rather than kept in sync, so it is current
 * without a subscription. The search box filters every session by title and
 * agent, and picking one hands it to the window, which opens it in place of
 * the current one.
 *
 * Hovering a row swaps its time for Rename and Archive. Archived sessions sit
 * behind the last row, which counts them; both lists load when the menu
 * opens, so the count is there before anyone expands it. Each archived row
 * has Unarchive in place of Archive.
 */
export function ChatHistoryMenu({
   activeId,
   orchestratorId,
   onPick,
   onRenamed,
   onArchived,
   className,
}: {
   activeId: string | null;
   /** Orchestrator is the default chat, so its name on every row says nothing. */
   orchestratorId?: string | undefined;
   onPick: (thread: ChatThread) => void;
   onRenamed?: (id: string, title: string) => void;
   /** A session left the list; the window moves off it when it was the open one. */
   onArchived?: (id: string) => void;
   className?: string;
}) {
   const t = useTranslations('agentsChat.floating');
   const chat = useTranslations('agentsChat.chat');
   const [open, setOpen] = useState(false);
   const [threads, setThreads] = useState<ChatThread[] | null>(null);
   const [failed, setFailed] = useState(false);
   const [archivedOpen, setArchivedOpen] = useState(false);
   const [archived, setArchived] = useState<ChatThread[] | null>(null);
   const [archivedFailed, setArchivedFailed] = useState(false);
   const [query, setQuery] = useState('');
   const [editing, setEditing] = useState<{ id: string; title: string } | null>(null);
   const search = useRef<HTMLInputElement>(null);

   const load = () => {
      setFailed(false);
      void listThreads()
         .then((found) => setThreads(agentSessions(found)))
         .catch(() => setFailed(true));
   };

   const loadArchived = () => {
      setArchivedFailed(false);
      void listThreads({ archived: true })
         .then((found) => setArchived(agentSessions(found)))
         .catch(() => setArchivedFailed(true));
   };

   const filter = useMemo(() => {
      const needle = query.trim().toLowerCase();
      return (list: ChatThread[] | null) => {
         if (!list) return [];
         const matching = needle
            ? list.filter(
                 (thread) =>
                    thread.topic.toLowerCase().includes(needle) ||
                    (thread.agentName ?? '').toLowerCase().includes(needle)
              )
            : list;
         return matching.slice(0, SHOWN);
      };
   }, [query]);
   const shown = filter(threads);
   const shownArchived = filter(archived);

   // Shown at once, then saved; a failure puts the lists back as the server has them.
   const rename = async (thread: ChatThread, title: string) => {
      setEditing(null);
      const next = title.trim();
      if (!next || next === thread.topic) return;
      const retitle = (list: ChatThread[] | null) =>
         list
            ? list.map((entry) => (entry.id === thread.id ? { ...entry, topic: next } : entry))
            : list;
      setThreads(retitle);
      setArchived(retitle);
      try {
         await renameSession(thread.id, next);
         onRenamed?.(thread.id, next);
      } catch (cause) {
         toast.error(cause instanceof BerryApiError ? cause.message : t('renameFailed'));
         load();
         if (archived) loadArchived();
      }
   };

   // Reversible, so no confirmation. The row moves between the two lists at
   // once; a failure puts both back as the server has them.
   // Archived sessions only, and on purpose without a confirmation: archiving
   // was the considered step, so this is clearing out what was already put
   // away. The row goes at once; a failure puts the list back as the server has it.
   const remove = async (thread: ChatThread) => {
      setArchived((list) => (list ? list.filter((entry) => entry.id !== thread.id) : list));
      try {
         await deleteSession(thread.id);
         onArchived?.(thread.id);
      } catch (cause) {
         toast.error(cause instanceof BerryApiError ? cause.message : t('deleteFailed'));
         loadArchived();
      }
   };

   const setArchivedState = async (thread: ChatThread, toArchived: boolean) => {
      const without = (list: ChatThread[] | null) =>
         list ? list.filter((entry) => entry.id !== thread.id) : list;
      const into = (list: ChatThread[] | null) =>
         list ? agentSessions([{ ...thread, archived: toArchived }, ...list]) : list;
      setThreads(toArchived ? without : into);
      setArchived(toArchived ? into : without);
      try {
         await setSessionArchived(thread.id, toArchived);
         if (toArchived) onArchived?.(thread.id);
      } catch (cause) {
         const fallback = toArchived ? t('archiveFailed') : t('unarchiveFailed');
         toast.error(cause instanceof BerryApiError ? cause.message : fallback);
         load();
         if (archived) loadArchived();
      }
   };

   const row = (thread: ChatThread, isArchived: boolean) =>
      editing?.id === thread.id ? (
         <div key={thread.id} className="px-1 py-0.5">
            <input
               autoFocus
               value={editing.title}
               aria-label={chat('rename')}
               onChange={(event) => setEditing({ id: thread.id, title: event.target.value })}
               onBlur={() => void rename(thread, editing.title)}
               // Every key is the field's: the menu neither type-selects nor
               // closes while a title is typed.
               onKeyDown={(event) => {
                  event.stopPropagation();
                  if (event.key === 'Escape') setEditing(null);
                  if (event.key === 'Enter') void rename(thread, editing.title);
               }}
               className="h-7 w-full rounded-sm bg-accent px-2 text-[length:inherit] text-accent-foreground outline-none"
            />
         </div>
      ) : (
         <DropdownMenuItem
            key={thread.id}
            onSelect={() => {
               if (thread.id !== activeId) onPick(thread);
            }}
            aria-current={thread.id === activeId ? 'true' : undefined}
            className={cn(
               'group/row my-1 gap-4 whitespace-nowrap',
               thread.id === activeId && 'bg-accent text-accent-foreground'
            )}
         >
            <span
               className={cn(
                  'min-w-0 flex-1 truncate',
                  thread.id === activeId && 'font-semibold',
                  isArchived && thread.id !== activeId && 'text-muted-foreground'
               )}
            >
               {thread.topic}
            </span>
            <span className="max-w-[45%] flex-none truncate text-muted-foreground group-hover/row:hidden">
               {[
                  thread.agentId === orchestratorId ? null : thread.agentName,
                  shortTimeAgo(thread.updatedAt),
               ]
                  .filter(Boolean)
                  .join(' · ')}
            </span>
            <span className="hidden flex-none items-center gap-2 group-hover/row:flex">
               <button
                  type="button"
                  aria-label={chat('rename')}
                  title={chat('rename')}
                  onPointerDown={own}
                  onPointerUp={own}
                  onClick={(event) => {
                     own(event);
                     setEditing({ id: thread.id, title: thread.topic });
                  }}
                  className="rounded p-0.5 text-muted-foreground hover:text-foreground"
               >
                  <Pencil className="size-4 text-current" />
               </button>
               <button
                  type="button"
                  aria-label={isArchived ? chat('unarchive') : chat('archive')}
                  title={isArchived ? chat('unarchive') : chat('archive')}
                  onPointerDown={own}
                  onPointerUp={own}
                  onClick={(event) => {
                     own(event);
                     void setArchivedState(thread, !isArchived);
                  }}
                  className="rounded p-0.5 text-muted-foreground hover:text-foreground"
               >
                  {isArchived ? (
                     <ArchiveRestore className="size-4 text-current" />
                  ) : (
                     <Archive className="size-4 text-current" />
                  )}
               </button>
               {isArchived ? (
                  <button
                     type="button"
                     aria-label={chat('delete')}
                     title={chat('delete')}
                     onPointerDown={own}
                     onPointerUp={own}
                     onClick={(event) => {
                        own(event);
                        void remove(thread);
                     }}
                     className="rounded p-0.5 text-muted-foreground hover:text-status-danger"
                  >
                     <Trash2 className="size-4 text-current" />
                  </button>
               ) : null}
            </span>
         </DropdownMenuItem>
      );

   return (
      <DropdownMenu
         open={open}
         onOpenChange={(next) => {
            setOpen(next);
            if (!next) {
               setEditing(null);
               return;
            }
            setQuery('');
            setArchivedOpen(false);
            setArchived(null);
            load();
            loadArchived();
            // The menu focuses itself on open; the search box takes it after.
            requestAnimationFrame(() => search.current?.focus());
         }}
      >
         <DropdownMenuTrigger asChild>
            <button
               type="button"
               aria-label={t('history')}
               title={t('history')}
               className={className}
            >
               <History className="size-4" />
            </button>
         </DropdownMenuTrigger>
         <DropdownMenuContent align="start" className="max-h-80 w-72 overflow-y-auto pt-0">
            <div className="sticky top-0 z-10 -mx-1 mb-1 flex items-center gap-1.5 border-b bg-popover px-2.5 py-1.5">
               <Search className="size-3 flex-none text-muted-foreground" aria-hidden />
               <input
                  ref={search}
                  // Text, not search: a global rule pins search inputs at 16px.
                  type="text"
                  inputMode="search"
                  enterKeyHint="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  // Typing is for the box, not the menu's type-to-select.
                  onKeyDown={(event) => {
                     if (!MENU_KEYS.has(event.key)) event.stopPropagation();
                  }}
                  placeholder={t('historySearch')}
                  aria-label={t('historySearch')}
                  className="min-w-0 flex-1 bg-transparent py-1.5 text-[length:inherit] outline-none placeholder:text-muted-foreground"
               />
            </div>
            {failed ? (
               <p className="px-2 py-1.5 text-muted-foreground">{t('historyFailed')}</p>
            ) : threads === null ? (
               <p className="px-2 py-1.5 text-muted-foreground">{t('historyLoading')}</p>
            ) : threads.length === 0 ? (
               <p className="px-2 py-1.5 text-muted-foreground">{t('historyEmpty')}</p>
            ) : shown.length === 0 ? (
               <p className="px-2 py-1.5 text-muted-foreground">{t('historyNoMatch')}</p>
            ) : (
               shown.map((thread) => row(thread, false))
            )}

            <DropdownMenuSeparator />
            <DropdownMenuItem
               // A toggle, not a choice: the menu stays open.
               onSelect={(event) => {
                  event.preventDefault();
                  const next = !archivedOpen;
                  setArchivedOpen(next);
                  if (next && archivedFailed) loadArchived();
               }}
               aria-expanded={archivedOpen}
               // One step below the rows: it labels a group, it is not one.
               data-caption=""
               className="gap-1.5 text-muted-foreground"
            >
               <ChevronRight
                  className={cn('size-3.5 transition-transform', archivedOpen && 'rotate-90')}
                  aria-hidden
               />
               {t('archivedSessions')}
               {archived && archived.length > 0 ? (
                  <span
                     className="ml-auto min-w-5 rounded-full bg-muted px-1.5 text-center leading-5 tabular-nums text-muted-foreground"
                     aria-label={t('archivedCount', { count: archived.length })}
                  >
                     {archived.length}
                  </span>
               ) : null}
            </DropdownMenuItem>
            {archivedOpen ? (
               archivedFailed ? (
                  <p className="px-2 py-1.5 text-muted-foreground">{t('historyFailed')}</p>
               ) : archived === null ? (
                  <p className="px-2 py-1.5 text-muted-foreground">{t('historyLoading')}</p>
               ) : archived.length === 0 ? (
                  <p className="px-2 py-1.5 text-muted-foreground">{t('archivedEmpty')}</p>
               ) : shownArchived.length === 0 ? (
                  <p className="px-2 py-1.5 text-muted-foreground">{t('historyNoMatch')}</p>
               ) : (
                  shownArchived.map((thread) => row(thread, true))
               )
            ) : null}
         </DropdownMenuContent>
      </DropdownMenu>
   );
}
