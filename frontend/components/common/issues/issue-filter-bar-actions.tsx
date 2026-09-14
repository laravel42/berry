'use client';

import { Button } from '@/components/ui/button';
import { BerryApiError } from '@/lib/api';
import { cn } from '@/lib/utils';
import { updateSavedView } from '@/lib/views';
import { useFilterStore } from '@/store/filter-store';
import { useViewsStore } from '@/store/views-store';
import { FilterXIcon, Save } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { useIssueListView } from './use-issue-list-view';

/**
 * Clear (and update-current-view when on a saved view) for the URL filters.
 * Lives in the Tasks header; other issue lists keep it on the chip row.
 */
export function IssueFilterBarActions({ className }: { className?: string }) {
   const t = useTranslations('issueLists');
   const { filters, clearFilters } = useFilterStore();
   const view = useIssueListView();
   const { viewId } = useParams<{ viewId?: string }>();
   const savedView = useViewsStore((state) => (viewId ? state.getViewById(viewId) : undefined));
   const hydrateViews = useViewsStore((state) => state.hydrateViews);
   const views = useViewsStore((state) => state.views);
   const [saving, setSaving] = useState(false);

   if (filters.length === 0) return null;

   const saveIntoView = () => {
      if (!savedView || saving) return;
      setSaving(true);
      void updateSavedView(savedView.id, {
         query: { filters: JSON.parse(JSON.stringify(filters)) as unknown },
         display: {
            ...savedView.display,
            layout: view.mode,
            grouping: view.grouping,
            ordering: view.ordering,
            direction: view.direction,
         },
         revision: savedView.revision,
      })
         .then((updated) => {
            hydrateViews(
               views.map((entry) =>
                  entry.id === savedView.id
                     ? { ...entry, revision: updated.revision, savedFilters: filters }
                     : entry
               )
            );
            toast.success(t('filters.savedToView'));
         })
         .catch((cause: unknown) => {
            const stale =
               cause instanceof BerryApiError &&
               (cause.status === 409 || cause.code.includes('CONFLICT'));
            toast.error(stale ? t('views.conflict') : t('states.loadFailed'));
         })
         .finally(() => setSaving(false));
   };

   return (
      <div className={cn('flex items-center gap-1', className)}>
         <Button size="xs" variant="destructive" onClick={clearFilters}>
            <FilterXIcon className="size-4" />
            {t('filters.clear')}
         </Button>
         {savedView ? (
            <Button
               size="xs"
               variant="outline"
               className="border-muted-foreground/15"
               disabled={saving}
               onClick={saveIntoView}
            >
               <Save className="size-4" />
               {t('filters.saveToView')}
            </Button>
         ) : null}
      </div>
   );
}
