'use client';

import { ChevronRight, FileText, Plus, SmilePlus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { TiptapAiEditor } from '@/components/common/editor/tiptap-ai-editor';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
   ancestry,
   childrenByParent,
   loadKnowledgePage,
   updateKnowledgePage,
   type KnowledgePage,
   type KnowledgePagePatch,
   type KnowledgePageSummary,
} from '@/lib/knowledge';
import { shortTimeAgo } from '@/lib/time-ago';
import { AddCoverButton, KnowledgeCoverBanner } from './knowledge-cover';
import { cn } from '@/lib/utils';

/** How long typing pauses before the page is saved. */
const SAVE_DELAY_MS = 700;

/** A page's mark, picked from a short set rather than the whole of Unicode. */
const ICONS = [
   '📄',
   '📘',
   '📗',
   '📕',
   '📙',
   '📓',
   '🗂️',
   '📁',
   '📌',
   '📎',
   '🧭',
   '🗺️',
   '🎯',
   '🚀',
   '🛠️',
   '⚙️',
   '🧪',
   '🔒',
   '🔑',
   '🐛',
   '✅',
   '📝',
   '💡',
   '🧠',
   '📣',
   '🤝',
   '👥',
   '🏁',
   '📊',
   '📈',
   '🗓️',
   '⏱️',
   '🌐',
   '💬',
   '🧩',
   '🎨',
   '🔍',
   '⚠️',
   '❤️',
   '🍓',
];

type SaveState = 'idle' | 'saving' | 'saved' | 'failed';

/**
 * One knowledge page, edited in place: icon, title and a markdown body with
 * the "/" block menu. Changes are saved a beat after typing stops, and any
 * still pending when the page closes are sent then.
 */
export function KnowledgePageView({
   workspaceId,
   pageId,
   pages,
   onOpen,
   onSummary,
   onCreateChild,
}: {
   workspaceId: string;
   pageId: string;
   pages: KnowledgePageSummary[];
   onOpen: (id: string | null) => void;
   onSummary: (id: string, patch: Partial<KnowledgePageSummary>) => void;
   onCreateChild: () => void;
}) {
   const t = useTranslations('knowledge');
   const [page, setPage] = useState<KnowledgePage | null>(null);
   const [missing, setMissing] = useState(false);
   const [title, setTitle] = useState('');
   const [icon, setIcon] = useState<string | null>(null);
   const [body, setBody] = useState('');
   const [save, setSave] = useState<SaveState>('idle');
   const pending = useRef<KnowledgePagePatch>({});
   const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

   useEffect(() => {
      if (!workspaceId) return;
      let cancelled = false;
      void loadKnowledgePage(workspaceId, pageId)
         .then((loaded) => {
            if (cancelled) return;
            setPage(loaded);
            setTitle(loaded.title);
            setIcon(loaded.icon);
            setBody(loaded.body);
         })
         .catch(() => {
            if (!cancelled) setMissing(true);
         });
      return () => {
         cancelled = true;
      };
   }, [workspaceId, pageId]);

   const flush = useCallback(async () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
      const patch = pending.current;
      if (Object.keys(patch).length === 0) return;
      pending.current = {};
      setSave('saving');
      try {
         const saved = await updateKnowledgePage(workspaceId, pageId, patch);
         setPage(saved);
         setSave(Object.keys(pending.current).length > 0 ? 'saving' : 'saved');
      } catch {
         // Kept for the next edit to carry, so nothing typed is dropped.
         pending.current = { ...patch, ...pending.current };
         setSave('failed');
      }
   }, [workspaceId, pageId]);

   const queue = useCallback(
      (patch: KnowledgePagePatch) => {
         pending.current = { ...pending.current, ...patch };
         setSave('saving');
         if (timer.current) clearTimeout(timer.current);
         timer.current = setTimeout(() => void flush(), SAVE_DELAY_MS);
      },
      [flush]
   );

   // Leaving the page sends what is still waiting.
   useEffect(() => () => void flush(), [flush]);

   const trail = useMemo(() => ancestry(pages, pageId).slice(0, -1), [pages, pageId]);
   const children = useMemo(() => childrenByParent(pages).get(pageId) ?? [], [pages, pageId]);

   if (missing) {
      return (
         <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
            <h2>{t('missingTitle')}</h2>
            <p className="text-muted-foreground">{t('missingBody')}</p>
            <button
               type="button"
               className="underline underline-offset-2"
               onClick={() => onOpen(null)}
            >
               {t('backToPages')}
            </button>
         </div>
      );
   }
   if (!page) return <p className="px-10 py-8 text-muted-foreground">{t('loading')}</p>;

   const editor = page.updatedBy?.name ?? page.createdBy?.name ?? null;
   // A cover change saves at once. Only the cover (and who edited) is taken
   // back, so text still waiting to save is not replaced by the server's copy.
   const coverSaved = (saved: KnowledgePage) =>
      setPage((current) =>
         current
            ? {
                 ...current,
                 cover: saved.cover,
                 updatedAt: saved.updatedAt,
                 updatedBy: saved.updatedBy,
              }
            : saved
      );

   return (
      <article className="flex w-full flex-col px-6 pt-6 pb-24 sm:px-12">
         <div
            className="flex min-h-7 items-center justify-between gap-4 text-muted-foreground"
            data-caption=""
         >
            <nav aria-label={t('breadcrumb')} className="flex min-w-0 items-center gap-1">
               <button
                  type="button"
                  className="truncate hover:text-foreground"
                  onClick={() => onOpen(null)}
               >
                  {t('title')}
               </button>
               {trail.map((ancestor) => (
                  <span key={ancestor.id} className="flex min-w-0 items-center gap-1">
                     <ChevronRight className="size-3 flex-none" aria-hidden />
                     <button
                        type="button"
                        className="truncate hover:text-foreground"
                        onClick={() => onOpen(ancestor.id)}
                     >
                        {ancestor.icon ? `${ancestor.icon} ` : ''}
                        {ancestor.title || t('untitled')}
                     </button>
                  </span>
               ))}
            </nav>
            <span className="flex-none" aria-live="polite">
               {save === 'saving'
                  ? t('saving')
                  : save === 'failed'
                    ? t('saveFailed')
                    : save === 'saved'
                      ? t('saved')
                      : editor
                        ? t('editedBy', { name: editor, when: shortTimeAgo(page.updatedAt) })
                        : null}
            </span>
         </div>

         <KnowledgeCoverBanner
            workspaceId={workspaceId}
            pageId={pageId}
            cover={page.cover}
            onSaved={coverSaved}
         />

         <div className={cn('flex flex-col gap-2', page.cover ? 'mt-6' : 'mt-10')}>
            <div className="flex flex-wrap items-center gap-1">
               <Popover>
                  <PopoverTrigger asChild>
                     <button
                        type="button"
                        aria-label={icon ? t('changeIcon') : t('addIcon')}
                        className={cn(
                           'flex w-fit items-center gap-1.5 rounded-md text-muted-foreground hover:bg-accent hover:text-foreground',
                           icon ? 'p-1' : 'px-2 py-1'
                        )}
                     >
                        {icon ? (
                           <span data-figure="md" aria-hidden>
                              {icon}
                           </span>
                        ) : (
                           <>
                              <SmilePlus className="size-4" aria-hidden />
                              {t('addIcon')}
                           </>
                        )}
                     </button>
                  </PopoverTrigger>
                  <PopoverContent align="start" className="w-72 p-2">
                     <div className="grid grid-cols-8 gap-1">
                        {ICONS.map((choice) => (
                           <button
                              key={choice}
                              type="button"
                              aria-label={choice}
                              onClick={() => {
                                 setIcon(choice);
                                 onSummary(pageId, { icon: choice });
                                 queue({ icon: choice });
                              }}
                              className={cn(
                                 'flex aspect-square items-center justify-center rounded hover:bg-accent',
                                 icon === choice && 'bg-accent'
                              )}
                           >
                              {choice}
                           </button>
                        ))}
                     </div>
                     {icon ? (
                        <button
                           type="button"
                           onClick={() => {
                              setIcon(null);
                              onSummary(pageId, { icon: null });
                              queue({ icon: null });
                           }}
                           className="mt-2 w-full rounded-md px-2 py-1.5 text-left text-muted-foreground hover:bg-accent hover:text-foreground"
                        >
                           {t('removeIcon')}
                        </button>
                     ) : null}
                  </PopoverContent>
               </Popover>

               {page.cover ? null : (
                  <AddCoverButton workspaceId={workspaceId} pageId={pageId} onSaved={coverSaved} />
               )}
            </div>

            <textarea
               value={title}
               rows={1}
               onChange={(event) => {
                  const next = event.target.value.replace(/\n/g, ' ');
                  setTitle(next);
                  onSummary(pageId, { title: next });
                  queue({ title: next });
               }}
               onKeyDown={(event) => {
                  // Enter moves on to the body, as in Notion; a title is one line.
                  if (event.key === 'Enter') {
                     event.preventDefault();
                     const editorEl = event.currentTarget
                        .closest('article')
                        ?.querySelector<HTMLElement>('.ProseMirror');
                     editorEl?.focus();
                  }
               }}
               placeholder={t('untitled')}
               aria-label={t('pageTitle')}
               data-heading="display"
               maxLength={500}
               className="field-sizing-content w-full resize-none bg-transparent font-semibold outline-none placeholder:text-muted-foreground"
            />
         </div>

         <div className="mt-4">
            <TiptapAiEditor
               value={body}
               onChange={(next) => {
                  setBody(next);
                  queue({ body: next });
               }}
               onBlur={() => void flush()}
               placeholder={t('bodyPlaceholder')}
               aria-label={t('pageBody')}
               aiAssist={false}
               slashMenu
            />
         </div>

         <section className="mt-10 flex flex-col gap-1 border-t pt-4">
            <h2 className="text-muted-foreground" data-heading="label">
               {t('subPages')}
            </h2>
            {children.map((child) => (
               <button
                  key={child.id}
                  type="button"
                  onClick={() => onOpen(child.id)}
                  className="flex items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-accent"
               >
                  {child.icon ? (
                     <span className="flex size-4 items-center justify-center" aria-hidden>
                        {child.icon}
                     </span>
                  ) : (
                     <FileText className="size-4 text-muted-foreground" aria-hidden />
                  )}
                  <span className={cn('truncate', !child.title && 'text-muted-foreground')}>
                     {child.title || t('untitled')}
                  </span>
               </button>
            ))}
            <button
               type="button"
               onClick={onCreateChild}
               className="flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-muted-foreground hover:bg-accent hover:text-foreground"
            >
               <Plus className="size-4" aria-hidden />
               {t('addSubPage')}
            </button>
         </section>
      </article>
   );
}
