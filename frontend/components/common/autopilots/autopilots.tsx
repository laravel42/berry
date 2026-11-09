'use client';

import { SettingsTile } from '@/components/common/settings/shared';
import { useTranslations } from 'next-intl';
import {
   Activity,
   Bug,
   CalendarClock,
   GitPullRequest,
   ListFilter,
   Newspaper,
   ShieldCheck,
   type LucideIcon,
} from 'lucide-react';
import { useParams, useRouter } from 'next/navigation';
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
   duplicateAutopilot,
   restoreAutopilot,
   updateAutopilot,
   type Autopilot,
   type LoopTemplate,
} from '@/lib/autopilots';
import { WORKSPACE_SLUG } from '@/lib/config';
import { cn } from '@/lib/utils';

import AutopilotLine, {
   COLUMN_BREAKPOINT,
   COLUMN_WIDTH,
   triggerSummaryKey,
} from './autopilot-line';
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
   /** The server's template catalogue, for the empty state. */
   templates: LoopTemplate[];
   onUseTemplate: (template: LoopTemplate) => void;
   /** Updates sort when a sortable column heading is clicked. */
   onCriteriaChange?: (criteria: AutopilotCriteria) => void;
   archived?: boolean;
}

/** A glyph per template category; the catalogue itself is the server's. */
export const TEMPLATE_ICON: Record<string, LucideIcon> = {
   triage: Bug,
   review: GitPullRequest,
   health: Activity,
   reporting: Newspaper,
   quality: ShieldCheck,
   schedule: CalendarClock,
};
export const FALLBACK_TEMPLATE_ICON: LucideIcon = ListFilter;

/** Same height as the card title (`h1` on the type scale). */
const titleHeight = 'size-[calc(var(--text-lg)*var(--text-lg--line-height))]';

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
      } else if (sort === 'trigger') {
         cmp = triggerSummaryKey(left).localeCompare(triggerSummaryKey(right));
      } else if (sort === 'lastRun') {
         cmp = (left.activity.lastRun?.createdAt ?? '').localeCompare(
            right.activity.lastRun?.createdAt ?? ''
         );
      } else if (sort === 'nextRun') {
         // A Loop with nothing scheduled sorts after every one that has a time.
         cmp = (left.activity.nextFireAt ?? '9999').localeCompare(
            right.activity.nextFireAt ?? '9999'
         );
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
   trigger: 'trigger',
   lastRun: 'lastRun',
   nextRun: 'nextRun',
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
   templates,
   onUseTemplate,
   onCriteriaChange,
   archived = false,
}: Props) {
   const t = useTranslations('loops');
   const router = useRouter();
   const params = useParams<{ orgId?: string }>();
   const orgId = params?.orgId || WORKSPACE_SLUG;
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

   /** A paused copy, opened so it can be adjusted before it runs. */
   const duplicate = async (autopilot: Autopilot) => {
      try {
         const copy = await duplicateAutopilot(autopilot.id);
         toast.success(t('row.duplicated', { name: autopilot.name }));
         onChanged();
         router.push(`/${orgId}/loop/${copy.id}`);
      } catch (failure) {
         fail(failure);
      }
   };

   const restore = async (autopilot: Autopilot) => {
      try {
         await restoreAutopilot(autopilot.id);
         toast.success(t('row.restored', { name: autopilot.name }));
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
         sortDescending: sort === 'updated' || sort === 'created' || sort === 'lastRun',
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
      if (archived) {
         return (
            <EmptyState icon={<EmptyStateMark label={t('empty.archived')} />}>
               <EmptyStateText>{t('empty.archived')}</EmptyStateText>
            </EmptyState>
         );
      }
      return (
         <div className="flex h-full min-h-64 w-full flex-col items-center px-5 py-12">
            <div className="flex w-full max-w-2xl flex-col items-center text-center">
               <EmptyStateMark label={t('empty.mark')} />
               <EmptyStateTitle>{t('empty.title')}</EmptyStateTitle>
               <EmptyStateText>{t('empty.body')}</EmptyStateText>
            </div>
            {canEdit ? (
               <div className="mt-[72px] w-full max-w-5xl">
                  <div className="grid grid-cols-1 items-start gap-3 sm:grid-cols-2 lg:grid-cols-3">
                     {templates.map((template) => {
                        const Icon = TEMPLATE_ICON[template.category] ?? FALLBACK_TEMPLATE_ICON;
                        return (
                           <section
                              key={template.key}
                              className="flex min-w-0 flex-col overflow-hidden rounded-[10px] bg-settings-group"
                              aria-label={template.name}
                           >
                              <button
                                 type="button"
                                 className="flex min-w-0 items-start gap-3 p-4 text-left transition-colors hover:bg-settings-row-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--ring)]"
                                 onClick={() => onUseTemplate(template)}
                              >
                                 <SettingsTile size="lg" className={titleHeight}>
                                    <Icon className="size-[55%]" aria-hidden />
                                 </SettingsTile>
                                 <div className="min-w-0 flex-1">
                                    <h3 data-heading="h1" className="m-0 min-w-0 truncate">
                                       {template.name}
                                    </h3>
                                    <p
                                       data-settings-type="caption"
                                       className="mt-1.5 line-clamp-3 min-h-[3lh] leading-[1.55] text-muted-foreground"
                                    >
                                       {template.description}
                                    </p>
                                    <p
                                       data-settings-type="caption"
                                       className="mt-2 truncate text-subtle-foreground"
                                    >
                                       {template.trigger.description}
                                    </p>
                                 </div>
                              </button>
                           </section>
                        );
                     })}
                  </div>
               </div>
            ) : null}
         </div>
      );
   }

   return (
      <div className="flex h-full min-h-0 w-full flex-col">
         <div className="min-h-0 flex-1 overflow-y-auto">
            <div
               data-heading="label"
               className="sticky top-0 z-10 flex h-9 items-center gap-3 border-b bg-container px-4 text-subtle-foreground"
            >
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
               {header('trigger', t('columns.trigger'))}
               {header('lastRun', t('columns.lastRun'))}
               {header('nextRun', t('columns.nextRun'))}
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
                  onRestore={restore}
                  onDuplicate={(row) => void duplicate(row)}
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
                     {archived ? (
                        <Button
                           size="xs"
                           variant="secondary"
                           onClick={() =>
                              void walk(
                                 (autopilot) => restoreAutopilot(autopilot.id),
                                 t('bulk.restoredDone')
                              )
                           }
                        >
                           {t('bulk.restore')}
                        </Button>
                     ) : (
                        <>
                           <Button
                              size="xs"
                              variant="secondary"
                              onClick={() =>
                                 void walk(
                                    (autopilot) =>
                                       updateAutopilot(autopilot.id, { status: 'paused' }),
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
                                    (autopilot) =>
                                       updateAutopilot(autopilot.id, { status: 'active' }),
                                    t('bulk.resumedDone')
                                 )
                              }
                           >
                              {t('bulk.resume')}
                           </Button>
                           <Button
                              size="xs"
                              variant="secondary"
                              onClick={() => setConfirmingBulk(true)}
                           >
                              {t('bulk.delete')}
                           </Button>
                        </>
                     )}
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
