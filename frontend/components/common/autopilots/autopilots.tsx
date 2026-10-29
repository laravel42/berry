'use client';

import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';

import {
   EmptyState,
   EmptyStateLoading,
   EmptyStateMark,
   EmptyStateText,
} from '@/components/common/empty-state';
import { SettingsChip, SettingsGroup } from '@/components/common/settings/shared';
import { BerryMark } from '@/components/brand/berry-mark';
import {
   AlertDialog,
   AlertDialogAction,
   AlertDialogCancel,
   AlertDialogContent,
   AlertDialogDescription,
   AlertDialogFooter,
   AlertDialogHeader,
   AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { useAutopilotActivity } from '@/hooks/use-autopilot-activity';
import {
   archiveAutopilot,
   describeAutopilotFailure,
   restoreAutopilot,
   updateAutopilot,
   type Autopilot,
} from '@/lib/autopilots';
import { cn } from '@/lib/utils';

import AutopilotLine, { COLUMN_BREAKPOINT, gridTemplate } from './autopilot-line';
import type { AutopilotColumn, AutopilotCriteria } from './autopilots-filters';
import { TEMPLATE_KEYS, type TemplateKey } from './templates';

interface Props {
   autopilots: Autopilot[];
   loaded: boolean;
   error: string | null;
   criteria: AutopilotCriteria;
   /** Names for assignee ids. */
   assigneeName: (autopilot: Autopilot) => string;
   canEdit: boolean;
   onChanged: () => void;
   /** Pause or resume one row without waiting on a reload. */
   onStatusChange?: (id: string, status: 'active' | 'paused') => void;
   narrowed: boolean;
   /** The search term, quoted back when nothing matches it. */
   query?: string;
   /** True when the workspace has no live autopilots at all, so the templates show. */
   empty: boolean;
   onUseTemplate: (template: TemplateKey) => void;
   /** Updates sort when a sortable column heading is clicked. */
   onCriteriaChange?: (criteria: AutopilotCriteria) => void;
   archived?: boolean;
}

function sortAutopilots(
   list: Autopilot[],
   sort: AutopilotCriteria['sort'],
   descending: boolean
): Autopilot[] {
   const direction = descending ? -1 : 1;
   return [...list].sort((left, right) => {
      let cmp = 0;
      if (sort === 'status') {
         cmp = left.status.localeCompare(right.status);
      } else if (sort === 'mode') {
         cmp = left.executionMode.localeCompare(right.executionMode);
      } else if (sort === 'quota') {
         cmp =
            left.quotaPeriod.localeCompare(right.quotaPeriod) ||
            (left.quotaMax ?? -1) - (right.quotaMax ?? -1);
      } else if (sort === 'updated') {
         cmp = left.updatedAt.localeCompare(right.updatedAt);
      } else if (sort === 'created') {
         cmp = left.createdAt.localeCompare(right.createdAt);
      } else {
         cmp = left.name.localeCompare(right.name);
      }
      return direction * cmp;
   });
}

/** Columns whose heading sorts the list; the run columns are read per row and do not. */
const SORT_FOR_COLUMN: Partial<Record<AutopilotColumn, AutopilotCriteria['sort']>> = {
   mode: 'mode',
   quota: 'quota',
   updated: 'updated',
};

/**
 * The workspace's autopilots as one group of rows, the way Settings lists
 * things: a heading row, then one divided row per autopilot. With nothing to
 * list, a short explanation and a group of templates to start from.
 */
export default function Autopilots({
   autopilots,
   loaded,
   error,
   criteria,
   assigneeName,
   canEdit,
   onChanged,
   onStatusChange,
   narrowed,
   query = '',
   empty,
   onUseTemplate,
   onCriteriaChange,
   archived = false,
}: Props) {
   const t = useTranslations('areas.autopilots');
   const [confirming, setConfirming] = useState<Autopilot | null>(null);

   const rows = useMemo(
      () => sortAutopilots(autopilots, criteria.sort, criteria.sortDescending),
      [autopilots, criteria.sort, criteria.sortDescending]
   );
   const activity = useAutopilotActivity(rows);

   const fail = (failure: unknown) => toast.error(describeAutopilotFailure(failure));

   const setStatus = async (autopilot: Autopilot, status: 'active' | 'paused') => {
      // Optimistic: the switch moves at once and moves back if the write fails.
      onStatusChange?.(autopilot.id, status);
      try {
         await updateAutopilot(autopilot.id, { status });
         toast.success(status === 'paused' ? t('row.paused') : t('row.resumed'));
         onChanged();
      } catch (failure) {
         onStatusChange?.(autopilot.id, autopilot.status === 'paused' ? 'paused' : 'active');
         fail(failure);
      }
   };

   const remove = async (autopilot: Autopilot) => {
      try {
         await archiveAutopilot(autopilot.id);
         toast.success(t('row.deleted', { name: autopilot.name }));
         onChanged();
      } catch (failure) {
         fail(failure);
      }
   };

   const restore = async (autopilot: Autopilot) => {
      try {
         await restoreAutopilot(autopilot.id);
         toast.success(t('row.restored', { name: autopilot.name }));
         onChanged();
      } catch (failure) {
         fail(failure);
      }
   };

   const sortBy = (sort: AutopilotCriteria['sort']) => {
      if (!onCriteriaChange) return;
      if (criteria.sort === sort) {
         onCriteriaChange({ ...criteria, sortDescending: !criteria.sortDescending });
         return;
      }
      // Dates default newest-first; names and labels default A→Z.
      onCriteriaChange({
         ...criteria,
         sort,
         sortDescending: sort === 'updated' || sort === 'created',
      });
   };

   const sortMark = (key: AutopilotCriteria['sort']) =>
      criteria.sort === key ? (
         <span aria-hidden>{criteria.sortDescending ? ' ↓' : ' ↑'}</span>
      ) : null;

   const heading = (
      label: string,
      key: AutopilotCriteria['sort'] | undefined,
      className?: string
   ) =>
      key && onCriteriaChange ? (
         <button
            type="button"
            onClick={() => sortBy(key)}
            className={cn(
               'min-w-0 cursor-pointer truncate text-left hover:text-foreground',
               criteria.sort === key && 'text-foreground',
               className
            )}
         >
            {label}
            {sortMark(key)}
         </button>
      ) : (
         <span className={cn('min-w-0 truncate', className)}>{label}</span>
      );

   if (!loaded && !error) {
      return <EmptyStateLoading label={t('loading')} />;
   }
   if (error) {
      return (
         <div className="px-6 py-10 text-muted-foreground" role="alert">
            {error}
         </div>
      );
   }

   if (empty && !archived) {
      return (
         <Page>
            <div className="flex flex-col items-center gap-2 px-0 pt-12 pb-3 text-center">
               <BerryMark
                  size="lg"
                  tone="neutral"
                  state="hollow"
                  bracketClassName="text-muted-foreground"
                  className="mb-2 size-8 text-muted-foreground"
                  label={t('empty.mark')}
               />
               <h2 className="font-semibold">{t('empty.title')}</h2>
               <p className="max-w-[560px] text-pretty text-muted-foreground">{t('empty.body')}</p>
            </div>
            {canEdit ? <Templates onUse={onUseTemplate} /> : null}
         </Page>
      );
   }

   if (rows.length === 0 && archived && !narrowed) {
      return (
         <EmptyState icon={<EmptyStateMark label={t('empty.archived')} />}>
            <EmptyStateText>{t('empty.archived')}</EmptyStateText>
         </EmptyState>
      );
   }

   return (
      <Page>
         <SettingsGroup className="divide-y-0">
            <div
               data-heading="label"
               className="grid h-[34px] items-center gap-4 px-4 text-subtle-foreground"
               style={{ gridTemplateColumns: gridTemplate(criteria.columns) }}
            >
               {heading(t('columns.autopilot'), 'name')}
               {criteria.columns.map((column) => (
                  <div key={column} className={cn('flex min-w-0', COLUMN_BREAKPOINT[column])}>
                     {heading(t(`columns.${column}`), SORT_FOR_COLUMN[column])}
                  </div>
               ))}
               <span aria-hidden />
            </div>

            {rows.map((autopilot) => (
               <AutopilotLine
                  key={autopilot.id}
                  autopilot={autopilot}
                  activity={activity[autopilot.id]}
                  columns={criteria.columns}
                  assigneeName={assigneeName(autopilot)}
                  canEdit={canEdit}
                  onPauseOrResume={(row) =>
                     void setStatus(row, row.status === 'paused' ? 'active' : 'paused')
                  }
                  onConfirmDelete={setConfirming}
                  onRestore={(row) => void restore(row)}
               />
            ))}

            {rows.length === 0 ? (
               <div className="border-t border-settings-divider px-4 py-7 text-center text-subtle-foreground">
                  {query.trim() ? t('noMatchQuery', { query: query.trim() }) : t('noMatch')}
               </div>
            ) : null}
         </SettingsGroup>

         <AlertDialog
            open={confirming !== null}
            onOpenChange={(open) => !open && setConfirming(null)}
         >
            <AlertDialogContent>
               <AlertDialogHeader>
                  <AlertDialogTitle>
                     {t('row.confirmDeleteTitle', { name: confirming?.name ?? '' })}
                  </AlertDialogTitle>
                  <AlertDialogDescription>{t('row.confirmDeleteBody')}</AlertDialogDescription>
               </AlertDialogHeader>
               <AlertDialogFooter>
                  <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
                  <AlertDialogAction
                     onClick={() => {
                        const target = confirming;
                        setConfirming(null);
                        if (target) void remove(target);
                     }}
                  >
                     {t('row.delete')}
                  </AlertDialogAction>
               </AlertDialogFooter>
            </AlertDialogContent>
         </AlertDialog>
      </Page>
   );
}

/** The scroll area: 20px padding, content centred at 1100px. */
function Page({ children }: { children: React.ReactNode }) {
   return (
      <div className="h-full w-full overflow-y-auto p-5">
         <div className="mx-auto flex max-w-[1100px] flex-col gap-5">{children}</div>
      </div>
   );
}

/** One row per starting point; "Use template" opens the editor already filled in. */
function Templates({ onUse }: { onUse: (template: TemplateKey) => void }) {
   const t = useTranslations('areas.autopilots.templates');
   return (
      <section className="flex flex-col gap-2.5">
         <div className="flex flex-col gap-0.5 px-1">
            <h2 className="font-semibold">{t('title')}</h2>
            <p className="text-subtle-foreground">{t('hint')}</p>
         </div>
         <SettingsGroup>
            {TEMPLATE_KEYS.map((key) => (
               <div
                  key={key}
                  className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-6 px-4 py-3.5"
               >
                  <div className="flex min-w-0 flex-col gap-[3px]">
                     <span className="flex flex-wrap items-center gap-2.5">
                        <span className="font-semibold text-foreground">{t(`${key}_name`)}</span>
                        <SettingsChip className="h-5 rounded-[5px] bg-settings-control px-[7px]">
                           {t(`${key}_when`)}
                        </SettingsChip>
                     </span>
                     <span className="max-w-[720px] text-pretty text-muted-foreground">
                        {t(`${key}_prompt`)}
                     </span>
                  </div>
                  <Button variant="soft" onClick={() => onUse(key)}>
                     {t('use')}
                  </Button>
               </div>
            ))}
         </SettingsGroup>
      </section>
   );
}
