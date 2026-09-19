'use client';

import { Input } from '@/components/ui/input';
import { loadReviewDiff, parseUnifiedDiff, type ReviewItem } from '@/lib/reviews';
import type { FileDiff } from '@/data/reviews';
import { Search } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useId, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { DiffView } from './diff-view';

/**
 * Diff tab: the pull request's changes, one file at a time, filterable by path.
 *
 * The filter goes into `toolbarSlot`, the end of the page's
 * tab bar, when the page offers one: a bar of its own under that one would
 * only push the diff down. Without a slot it keeps its own, so it still works
 * on a page that has none.
 */
export function ReviewDiff({
   item,
   toolbarSlot,
}: {
   item: ReviewItem;
   toolbarSlot?: HTMLElement | null;
}) {
   const t = useTranslations('reviews');
   const [query, setQuery] = useState('');
   const [files, setFiles] = useState<FileDiff[] | null>(null);
   const [error, setError] = useState<string | null>(null);
   const filterId = useId();

   useEffect(() => {
      let cancelled = false;
      setFiles(null);
      setError(null);
      if (!item.pullRequest) return;
      loadReviewDiff(item.run.id)
         .then((text) => {
            if (!cancelled) setFiles(parseUnifiedDiff(text));
         })
         .catch((cause: unknown) => {
            if (!cancelled) setError(cause instanceof Error ? cause.message : t('diff.failed'));
         });
      return () => {
         cancelled = true;
      };
   }, [item.run.id, item.pullRequest, t]);

   const shown = useMemo(
      () =>
         (files ?? []).filter((file) =>
            `${file.path}/${file.name}`.toLowerCase().includes(query.trim().toLowerCase())
         ),
      [files, query]
   );

   if (!item.pullRequest) {
      return (
         <div className="flex h-full items-center justify-center px-6 text-muted-foreground">
            {t('diff.noPullRequest')}
         </div>
      );
   }

   const tools = (
      <>
         <div className="relative w-64 max-w-full">
            <label htmlFor={filterId} className="sr-only">
               {t('diff.filter')}
            </label>
            <Search
               className="absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground"
               aria-hidden
            />
            <Input
               id={filterId}
               value={query}
               onChange={(event) => setQuery(event.target.value)}
               placeholder={t('diff.filter')}
               className="h-7 pl-7"
            />
         </div>
      </>
   );

   return (
      <div className="flex h-full flex-col overflow-hidden">
         {toolbarSlot ? (
            createPortal(tools, toolbarSlot)
         ) : (
            <div className="flex shrink-0 items-center justify-end gap-2 border-b px-4 py-2">
               {tools}
            </div>
         )}
         <div className="flex-1 overflow-y-auto">
            <div className="flex w-full flex-col gap-3 px-6 py-6">
               {error && (
                  <p className="text-status-danger" role="alert">
                     {error}
                  </p>
               )}
               {!error && files === null && (
                  <p className="text-muted-foreground">{t('diff.loading')}</p>
               )}
               {shown.map((file) => (
                  <DiffView key={`${file.path}/${file.name}`} diff={file} />
               ))}
            </div>
         </div>
      </div>
   );
}
