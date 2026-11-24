'use client';

import { CornerLeftUp, FileText } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useMemo } from 'react';

import {
   Command,
   CommandEmpty,
   CommandGroup,
   CommandInput,
   CommandItem,
   CommandList,
} from '@/components/ui/command';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { ancestry, type KnowledgePageSummary } from '@/lib/knowledge';
import { descendantIds } from './knowledge-tree';

/**
 * Where a page can move: the top level, or under any page that is not the
 * page itself or one of its own sub-pages. Each choice names its path.
 */
export function KnowledgeMoveDialog({
   page,
   pages,
   onOpenChange,
   onMove,
}: {
   page: KnowledgePageSummary | null;
   pages: KnowledgePageSummary[];
   onOpenChange: (open: boolean) => void;
   onMove: (parentId: string | null) => void;
}) {
   const t = useTranslations('knowledge');
   const targets = useMemo(() => {
      if (!page) return [];
      const excluded = new Set([page.id, ...descendantIds(pages, page.id)]);
      return pages
         .filter((candidate) => !excluded.has(candidate.id))
         .map((candidate) => ({
            page: candidate,
            path: ancestry(pages, candidate.id)
               .map((step) => step.title || t('untitled'))
               .join(' / '),
         }))
         .sort((a, b) => a.path.localeCompare(b.path));
   }, [page, pages, t]);

   return (
      <Dialog open={page !== null} onOpenChange={onOpenChange}>
         <DialogContent className="max-w-md overflow-hidden p-0">
            <DialogTitle className="sr-only">{t('moveTo')}</DialogTitle>
            <Command>
               <CommandInput placeholder={t('moveSearch')} />
               <CommandList>
                  <CommandEmpty>{t('noMatches')}</CommandEmpty>
                  <CommandGroup>
                     {page?.parentId ? (
                        <CommandItem value={`__top ${t('topLevel')}`} onSelect={() => onMove(null)}>
                           <CornerLeftUp className="size-4" /> {t('topLevel')}
                        </CommandItem>
                     ) : null}
                     {targets.map(({ page: target, path }) => (
                        <CommandItem
                           key={target.id}
                           value={`${target.id} ${path}`}
                           disabled={target.id === page?.parentId}
                           onSelect={() => onMove(target.id)}
                        >
                           {target.icon ? (
                              <span className="flex size-4 items-center justify-center" aria-hidden>
                                 {target.icon}
                              </span>
                           ) : (
                              <FileText className="size-4" />
                           )}
                           <span className="truncate">{path}</span>
                        </CommandItem>
                     ))}
                  </CommandGroup>
               </CommandList>
            </Command>
         </DialogContent>
      </Dialog>
   );
}
