'use client';

import { FileText, Undo2, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { ConfirmAction } from '@/components/common/confirm-action';
import {
   Dialog,
   DialogContent,
   DialogDescription,
   DialogHeader,
   DialogTitle,
} from '@/components/ui/dialog';
import { BerryApiError } from '@/lib/api';
import {
   loadKnowledgeTrash,
   purgeKnowledgePage,
   restoreKnowledgePage,
   type TrashedKnowledgePage,
} from '@/lib/knowledge';
import { shortTimeAgo } from '@/lib/time-ago';

/**
 * Deleted pages, newest first. Restore brings a page back with the sub-pages
 * that went with it; deleting from here is for good, so it confirms.
 */
export function KnowledgeTrash({
   workspaceId,
   open,
   onOpenChange,
   onRestored,
}: {
   workspaceId: string;
   open: boolean;
   onOpenChange: (open: boolean) => void;
   onRestored: (id: string) => void;
}) {
   const t = useTranslations('knowledge');
   const [pages, setPages] = useState<TrashedKnowledgePage[] | null>(null);
   const [failed, setFailed] = useState(false);
   const [purging, setPurging] = useState<TrashedKnowledgePage | null>(null);

   useEffect(() => {
      if (!open || !workspaceId) return;
      setPages(null);
      setFailed(false);
      void loadKnowledgeTrash(workspaceId)
         .then(setPages)
         .catch(() => setFailed(true));
   }, [open, workspaceId]);

   const restore = async (page: TrashedKnowledgePage) => {
      try {
         await restoreKnowledgePage(workspaceId, page.id);
      } catch (cause) {
         toast.error(cause instanceof BerryApiError ? cause.message : t('restoreFailed'));
         return;
      }
      setPages((current) => (current ?? []).filter((entry) => entry.id !== page.id));
      onOpenChange(false);
      onRestored(page.id);
   };

   const purge = async () => {
      if (!purging) return;
      try {
         await purgeKnowledgePage(workspaceId, purging.id);
      } catch (cause) {
         toast.error(cause instanceof BerryApiError ? cause.message : t('purgeFailed'));
         throw cause;
      }
      setPages((current) => (current ?? []).filter((entry) => entry.id !== purging.id));
   };

   return (
      <>
         <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-lg">
               <DialogHeader>
                  <DialogTitle>{t('trash')}</DialogTitle>
                  <DialogDescription>{t('trashBody')}</DialogDescription>
               </DialogHeader>
               <div className="max-h-96 overflow-y-auto">
                  {failed ? (
                     <p className="py-2 text-muted-foreground">{t('loadFailed')}</p>
                  ) : pages === null ? (
                     <p className="py-2 text-muted-foreground">{t('loading')}</p>
                  ) : pages.length === 0 ? (
                     <p className="py-2 text-muted-foreground">{t('trashEmpty')}</p>
                  ) : (
                     <ul className="flex flex-col gap-0.5">
                        {pages.map((page) => (
                           <li
                              key={page.id}
                              className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-accent"
                           >
                              {page.icon ? (
                                 <span
                                    className="flex size-4 flex-none items-center justify-center"
                                    aria-hidden
                                 >
                                    {page.icon}
                                 </span>
                              ) : (
                                 <FileText
                                    className="size-4 flex-none text-muted-foreground"
                                    aria-hidden
                                 />
                              )}
                              <span className="flex min-w-0 flex-1 flex-col">
                                 <span className="truncate">{page.title || t('untitled')}</span>
                                 <span className="text-muted-foreground" data-caption="">
                                    {page.descendants > 0
                                       ? t('deletedWith', {
                                            when: shortTimeAgo(page.deletedAt),
                                            count: page.descendants,
                                         })
                                       : t('deletedAt', { when: shortTimeAgo(page.deletedAt) })}
                                 </span>
                              </span>
                              <button
                                 type="button"
                                 aria-label={t('restore')}
                                 title={t('restore')}
                                 onClick={() => void restore(page)}
                                 className="flex size-7 flex-none items-center justify-center rounded text-muted-foreground hover:text-foreground"
                              >
                                 <Undo2 className="size-4" />
                              </button>
                              <button
                                 type="button"
                                 aria-label={t('purge')}
                                 title={t('purge')}
                                 onClick={() => setPurging(page)}
                                 className="flex size-7 flex-none items-center justify-center rounded text-muted-foreground hover:text-status-danger"
                              >
                                 <X className="size-4" />
                              </button>
                           </li>
                        ))}
                     </ul>
                  )}
               </div>
            </DialogContent>
         </Dialog>
         <ConfirmAction
            open={purging !== null}
            onOpenChange={(next) => {
               if (!next) setPurging(null);
            }}
            title={t('purgeTitle', { title: purging?.title || t('untitled') })}
            description={t('purgeBody')}
            confirmLabel={t('purge')}
            pendingLabel={t('purging')}
            danger
            onConfirm={purge}
         />
      </>
   );
}
