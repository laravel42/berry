'use client';

import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';

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
import { Checkbox } from '@/components/ui/checkbox';
import { Progress } from '@/components/ui/progress';
import {
   EmptyState,
   EmptyStateLoading,
   EmptyStateMark,
   EmptyStateText,
   EmptyStateTitle,
} from '@/components/common/empty-state';
import {
   archiveAutopilot,
   describeAutopilotFailure,
   updateAutopilot,
   type Autopilot,
} from '@/lib/autopilots';
import { cn } from '@/lib/utils';

import AutopilotLine, { COLUMN_BREAKPOINT, COLUMN_WIDTH } from './autopilot-line';
import type { AutopilotColumn, AutopilotCriteria } from './autopilots-filters';

interface Props {
   autopilots: Autopilot[];
   loaded: boolean;
   error: string | null;
   criteria: AutopilotCriteria;
   /** Names for assignee ids. */
   assigneeName: (autopilot: Autopilot) => string;
   canEdit: boolean;
   onChanged: () => void;
   narrowed: boolean;
   onUseTemplate: (template: { name: string; prompt: string }) => void;
   /** Updates sort when a sortable column heading is clicked. */
   onCriteriaChange?: (criteria: AutopilotCriteria) => void;
}

/** Something to start from, so an empty workspace is not an empty page. */
const TEMPLATES = ['standup', 'triage', 'sweep', 'digest', 'release', 'watch'] as const;

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

/** Every visible column heading sorts; the Autopilot name is the flex column. */
const SORT_FOR_COLUMN: Record<AutopilotColumn | 'autopilot', AutopilotCriteria['sort']> = {
   autopilot: 'name',
   status: 'status',
   mode: 'mode',
   quota: 'quota',
   updated: 'updated',
};

/**
 * The workspace's autopilots.
 *
 * Same table shape as Agents: sticky header, checkbox, name, optional cells,
 * hover menu. Pausing and deleting are offered per row and over a selection.
 */
export default function Autopilots({
   autopilots,
   loaded,
   error,
   criteria,
   assigneeName,
   canEdit,
   onChanged,
   narrowed,
   onUseTemplate,
   onCriteriaChange,
}: Props) {
   const t = useTranslations('areas.autopilots');
   const [selection, setSelection] = useState<string[]>([]);
   const [confirming, setConfirming] = useState<Autopilot | null>(null);
   const [confirmingBulk, setConfirmingBulk] = useState(false);
   const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

   const rows = useMemo(
      () => sortAutopilots(autopilots, criteria.sort, criteria.sortDescending),
      [autopilots, criteria.sort, criteria.sortDescending]
   );
   const selected = rows.filter((row) => selection.includes(row.id));
   const allSelected = rows.length > 0 && selection.length === rows.length;

   const fail = (failure: unknown) => toast.error(describeAutopilotFailure(failure));

   const setStatus = async (autopilot: Autopilot, status: 'active' | 'paused') => {
      try {
         await updateAutopilot(autopilot.id, { status });
         toast.success(status === 'paused' ? t('row.paused') : t('row.resumed'));
         onChanged();
      } catch (failure) {
         fail(failure);
      }
   };

   const remove = async (autopilot: Autopilot) => {
      try {
         await archiveAutopilot(autopilot.id);
         toast.success(t('row.deleted', { name: autopilot.name }));
         setSelection((current) => current.filter((id) => id !== autopilot.id));
         onChanged();
      } catch (failure) {
         fail(failure);
      }
   };

   /** One request per autopilot, counted off, so a failure names itself. */
   const walk = async (work: (autopilot: Autopilot) => Promise<unknown>, done: string) => {
      setProgress({ done: 0, total: selected.length });
      let failed = 0;
      for (const [index, autopilot] of selected.entries()) {
         try {
            await work(autopilot);
         } catch (failure) {
            failed += 1;
            if (failed === 1) fail(failure);
         }
         setProgress({ done: index + 1, total: selected.length });
      }
      setProgress(null);
      setSelection([]);
      toast.success(done);
      onChanged();
   };

   const toggle = (id: string) =>
      setSelection((current) =>
         current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id]
      );

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

   const header = (column: AutopilotColumn, label: string) => {
      if (!criteria.columns.includes(column)) return null;
      const key = SORT_FOR_COLUMN[column];
      const classes = cn(
         'shrink-0 items-center gap-1',
         COLUMN_WIDTH[column],
         COLUMN_BREAKPOINT[column] ?? 'flex'
      );
      if (!onCriteriaChange) {
         return <div className={classes}>{label}</div>;
      }
      return (
         <div className={classes}>
            <button
               type="button"
               onClick={() => sortBy(key)}
               aria-label={label}
               className={cn(
                  'truncate uppercase hover:text-foreground',
                  criteria.sort === key && 'text-foreground'
               )}
            >
               {label}
               {sortMark(key)}
            </button>
         </div>
      );
   };

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

   if (rows.length === 0) {
      if (narrowed) {
         return (
            <EmptyState icon={<EmptyStateMark label={t('noMatch')} />}>
               <EmptyStateText>{t('noMatch')}</EmptyStateText>
            </EmptyState>
         );
      }
      return (
         <div className="flex h-full min-h-64 w-full items-center justify-center px-6 py-12">
            <div className="flex w-full max-w-2xl flex-col items-center text-center">
               <EmptyStateMark label={t('empty.mark')} />
               <EmptyStateTitle>{t('empty.title')}</EmptyStateTitle>
               <EmptyStateText>{t('empty.body')}</EmptyStateText>
               {canEdit ? (
                  <div className="mt-10 w-full text-left">
                     <p className="font-medium">{t('templates.title')}</p>
                     <p className="text-muted-foreground">{t('templates.hint')}</p>
                     <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                        {TEMPLATES.map((key) => (
                           <button
                              key={key}
                              type="button"
                              className="cursor-pointer rounded-md border p-3 text-left hover:bg-sidebar/50"
                              onClick={() =>
                                 onUseTemplate({
                                    name: t(`templates.${key}_name`),
                                    prompt: t(`templates.${key}_prompt`),
                                 })
                              }
                           >
                              <span className="block font-medium">
                                 {t(`templates.${key}_name`)}
                              </span>
                              <span className="mt-0.5 block line-clamp-2 text-muted-foreground">
                                 {t(`templates.${key}_prompt`)}
                              </span>
                           </button>
                        ))}
                     </div>
                  </div>
               ) : null}
            </div>
         </div>
      );
   }

   return (
      <div className="flex h-full min-h-0 w-full flex-col">
         <div className="min-h-0 flex-1 overflow-y-auto">
            <div className="sticky top-0 z-10 flex items-center gap-3 border-b bg-container px-4 py-[6px] font-medium tracking-wider text-muted-foreground uppercase">
               {canEdit ? (
                  <Checkbox
                     className="shrink-0"
                     aria-label={t('bulk.selectAll')}
                     checked={allSelected}
                     onCheckedChange={() =>
                        setSelection(allSelected ? [] : rows.map((row) => row.id))
                     }
                  />
               ) : null}
               {onCriteriaChange ? (
                  <button
                     type="button"
                     onClick={() => sortBy('name')}
                     className={cn(
                        'min-w-0 flex-1 text-left uppercase hover:text-foreground',
                        criteria.sort === 'name' && 'text-foreground'
                     )}
                  >
                     {t('columns.autopilot')}
                     {sortMark('name')}
                  </button>
               ) : (
                  <div className="min-w-0 flex-1">{t('columns.autopilot')}</div>
               )}
               {header('status', t('columns.status'))}
               {header('mode', t('columns.mode'))}
               {header('quota', t('columns.quota'))}
               {header('updated', t('columns.updated'))}
               <span className="size-6 shrink-0" aria-hidden />
            </div>

            {rows.map((autopilot) => (
               <AutopilotLine
                  key={autopilot.id}
                  autopilot={autopilot}
                  columns={criteria.columns}
                  assigneeName={assigneeName(autopilot)}
                  canEdit={canEdit}
                  selected={selection.includes(autopilot.id)}
                  onToggleSelected={toggle}
                  onPauseOrResume={(row) =>
                     void setStatus(row, row.status === 'paused' ? 'active' : 'paused')
                  }
                  onConfirmDelete={setConfirming}
               />
            ))}
         </div>

         {canEdit && selected.length > 0 ? (
            <div className="sticky bottom-0 z-20 flex flex-wrap items-center gap-3 border-t bg-container px-6 py-2">
               <span className="font-medium">{t('bulk.selected', { count: selected.length })}</span>
               {progress ? (
                  <span className="flex items-center gap-2 text-muted-foreground">
                     <Progress
                        className="w-32"
                        value={(progress.done / Math.max(1, progress.total)) * 100}
                     />
                     {t('bulk.progress', { done: progress.done, total: progress.total })}
                  </span>
               ) : (
                  <>
                     <Button
                        size="xs"
                        variant="secondary"
                        onClick={() =>
                           void walk(
                              (autopilot) => updateAutopilot(autopilot.id, { status: 'paused' }),
                              t('bulk.pausedDone')
                           )
                        }
                     >
                        {t('bulk.pause')}
                     </Button>
                     <Button
                        size="xs"
                        variant="secondary"
                        onClick={() =>
                           void walk(
                              (autopilot) => updateAutopilot(autopilot.id, { status: 'active' }),
                              t('bulk.resumedDone')
                           )
                        }
                     >
                        {t('bulk.resume')}
                     </Button>
                     <Button size="xs" variant="secondary" onClick={() => setConfirmingBulk(true)}>
                        {t('bulk.delete')}
                     </Button>
                     <Button size="xs" variant="ghost" onClick={() => setSelection([])}>
                        {t('bulk.clear')}
                     </Button>
                  </>
               )}
            </div>
         ) : null}

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

         <AlertDialog open={confirmingBulk} onOpenChange={setConfirmingBulk}>
            <AlertDialogContent>
               <AlertDialogHeader>
                  <AlertDialogTitle>
                     {t('bulk.confirmDeleteTitle', { count: selected.length })}
                  </AlertDialogTitle>
                  <AlertDialogDescription>{t('bulk.confirmDeleteBody')}</AlertDialogDescription>
               </AlertDialogHeader>
               <AlertDialogFooter>
                  <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
                  <AlertDialogAction
                     onClick={() =>
                        void walk(
                           (autopilot) => archiveAutopilot(autopilot.id),
                           t('bulk.deletedDone')
                        )
                     }
                  >
                     {t('bulk.delete')}
                  </AlertDialogAction>
               </AlertDialogFooter>
            </AlertDialogContent>
         </AlertDialog>
      </div>
   );
}
