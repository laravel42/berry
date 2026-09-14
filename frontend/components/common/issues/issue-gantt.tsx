'use client';

import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import type { Issue } from '@/data/issues';
import { describePatchFailure, patchBoardIssue } from '@/lib/issues';
import { cn } from '@/lib/utils';
import { useFilterStore } from '@/store/filter-store';
import { useIssuesStore } from '@/store/issues-store';
import { IssueListEmpty } from './issue-list-empty';
import { AlertTriangle } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { toast } from 'sonner';

const DAY = 86_400_000;
const LABEL_COL = '360px';

type Zoom = 'day' | 'week' | 'month';

/** How many days the axis covers at each zoom (data span can push this higher). */
const WINDOW_DAYS: Record<Zoom, number> = { day: 28, week: 90, month: 210 };

/** Tick step in days for axis labels. */
const TICK_DAYS: Record<Zoom, number> = { day: 1, week: 7, month: 30 };

const startOfDay = (time: number): number => {
   const date = new Date(time);
   date.setHours(0, 0, 0, 0);
   return date.getTime();
};

/** RFC 3339 due date at noon UTC from a local calendar day (matches the properties picker). */
const dueIsoFromLocalDay = (time: number): string => {
   const date = new Date(time);
   const year = date.getFullYear();
   const month = String(date.getMonth() + 1).padStart(2, '0');
   const day = String(date.getDate()).padStart(2, '0');
   return new Date(`${year}-${month}-${day}T12:00:00.000Z`).toISOString();
};

const formatTick = (time: number, zoom: Zoom, weekIndex = 1): string => {
   const date = new Date(time);
   if (zoom === 'month') {
      return date.toLocaleDateString(undefined, { month: 'short' });
   }
   if (zoom === 'day') {
      return String(date.getDate());
   }
   if (zoom === 'week') {
      return `W${weekIndex}`;
   }
   return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};

/**
 * Created-to-due bars on a time axis.
 *
 * A task whose due date falls before it started cannot be drawn as a span, and
 * silently swapping the ends would hide a real scheduling mistake — so those
 * are counted and called out instead. The right edge of a bar can be dragged to
 * change the due date.
 */
export function IssueGantt({ issues }: { issues: Issue[] }) {
   const t = useTranslations('issueLists');
   const { orgId } = useParams<{ orgId: string }>();
   const updateIssue = useIssuesStore((state) => state.updateIssue);
   const { filters } = useFilterStore();
   const [zoom, setZoom] = useState<Zoom>('week');
   const [showCompleted, setShowCompleted] = useState(true);
   const [draftDue, setDraftDue] = useState<{ id: string; due: number } | null>(null);
   const dragRef = useRef<{
      issueId: string;
      previous: string | undefined;
      created: number;
      track: HTMLElement;
   } | null>(null);

   const visible = useMemo(
      () =>
         showCompleted
            ? issues
            : issues.filter(
                 (issue) =>
                    issue.status.category !== 'completed' && issue.status.category !== 'canceled'
              ),
      [issues, showCompleted]
   );

   const { dated, undated, inverted, start, days } = useMemo(() => {
      const withDue = visible.filter((issue) => issue.dueDate);
      const invertedRows = withDue.filter(
         (issue) => Date.parse(issue.dueDate ?? '') < Date.parse(issue.createdAt)
      );
      const today = Date.now();
      const starts = withDue.map((issue) => Date.parse(issue.createdAt));
      const ends = withDue.map((issue) => Date.parse(issue.dueDate ?? issue.createdAt));
      const first = startOfDay(Math.min(...(starts.length > 0 ? starts : [today]), today));
      const last = Math.max(...(ends.length > 0 ? ends : [today]), today);
      const dataDays = Math.ceil((last - first) / DAY) + 2;
      const span = Math.min(400, Math.max(WINDOW_DAYS[zoom], dataDays));
      return {
         dated: withDue,
         undated: visible.filter((issue) => !issue.dueDate),
         inverted: invertedRows,
         start: first,
         days: span,
      };
   }, [visible, zoom]);

   const range = days * DAY;
   const pctOf = (time: number) => ((time - start) / range) * 100;

   const dayAtClientX = useCallback(
      (track: HTMLElement, clientX: number) => {
         const rect = track.getBoundingClientRect();
         if (rect.width <= 0) return start;
         const pct = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
         return startOfDay(start + pct * range);
      },
      [range, start]
   );

   const commitDueDate = useCallback(
      (issueId: string, previous: string | undefined, due: number) => {
         const next = dueIsoFromLocalDay(due);
         if (next === previous) {
            setDraftDue(null);
            return;
         }
         updateIssue(issueId, { dueDate: next });
         setDraftDue(null);
         void patchBoardIssue(issueId, { dueDate: next }).catch((cause: unknown) => {
            updateIssue(issueId, { dueDate: previous });
            toast.error(describePatchFailure(cause) || t('gantt.dueSaveFailed'));
         });
      },
      [t, updateIssue]
   );

   const onResizePointerDown = useCallback(
      (event: ReactPointerEvent<HTMLButtonElement>, issue: Issue) => {
         event.preventDefault();
         event.stopPropagation();
         const track = event.currentTarget.closest('[data-gantt-track]');
         if (!(track instanceof HTMLElement)) return;
         const created = startOfDay(Date.parse(issue.createdAt));
         dragRef.current = {
            issueId: issue.id,
            previous: issue.dueDate,
            created,
            track,
         };
         const due = Math.max(created, dayAtClientX(track, event.clientX));
         setDraftDue({ id: issue.id, due });
         event.currentTarget.setPointerCapture(event.pointerId);
      },
      [dayAtClientX]
   );

   const onResizePointerMove = useCallback(
      (event: ReactPointerEvent<HTMLButtonElement>) => {
         const drag = dragRef.current;
         if (!drag) return;
         const due = Math.max(drag.created, dayAtClientX(drag.track, event.clientX));
         setDraftDue({ id: drag.issueId, due });
      },
      [dayAtClientX]
   );

   const onResizePointerUp = useCallback(
      (event: ReactPointerEvent<HTMLButtonElement>) => {
         const drag = dragRef.current;
         if (!drag) return;
         dragRef.current = null;
         try {
            event.currentTarget.releasePointerCapture(event.pointerId);
         } catch {
            // Capture may already be released.
         }
         const due = Math.max(drag.created, dayAtClientX(drag.track, event.clientX));
         commitDueDate(drag.issueId, drag.previous, due);
      },
      [commitDueDate, dayAtClientX]
   );

   const ticks = useMemo(() => {
      const step = TICK_DAYS[zoom];
      const marks: { left: number; label: string }[] = [];
      for (let index = 0; index <= days; index += step) {
         const weekIndex = Math.floor(index / step) + 1;
         marks.push({
            left: (index / days) * 100,
            label: formatTick(start + index * DAY, zoom, weekIndex),
         });
      }
      return marks;
   }, [days, start, zoom]);

   /** Top axis band: months for day/week zoom, years for month zoom. */
   const axisBands = useMemo(() => {
      const spans: { left: number; width: number; label: string }[] = [];
      let spanStart = 0;
      if (zoom === 'month') {
         let year = new Date(start).getFullYear();
         for (let index = 1; index <= days; index += 1) {
            const next = index < days ? new Date(start + index * DAY) : null;
            const crossed = next === null || next.getFullYear() !== year;
            if (!crossed) continue;
            spans.push({
               left: (spanStart / days) * 100,
               width: ((index - spanStart) / days) * 100,
               label: String(new Date(start + spanStart * DAY).getFullYear()),
            });
            if (next) {
               spanStart = index;
               year = next.getFullYear();
            }
         }
         return spans;
      }
      let month = new Date(start).getMonth();
      let year = new Date(start).getFullYear();
      for (let index = 1; index <= days; index += 1) {
         const next = index < days ? new Date(start + index * DAY) : null;
         const crossed =
            next === null || next.getMonth() !== month || next.getFullYear() !== year;
         if (!crossed) continue;
         spans.push({
            left: (spanStart / days) * 100,
            width: ((index - spanStart) / days) * 100,
            label: new Date(start + spanStart * DAY).toLocaleDateString(undefined, {
               month: 'short',
            }),
         });
         if (next) {
            spanStart = index;
            month = next.getMonth();
            year = next.getFullYear();
         }
      }
      return spans;
   }, [days, start, zoom]);

   const weekendBands = useMemo(() => {
      if (zoom !== 'day') return [];
      const bands: { left: number; width: number }[] = [];
      for (let index = 0; index < days; index += 1) {
         const day = new Date(start + index * DAY).getDay();
         if (day === 0 || day === 6) {
            bands.push({ left: (index / days) * 100, width: (1 / days) * 100 });
         }
      }
      return bands;
   }, [days, start, zoom]);

   const todayLeft = pctOf(startOfDay(Date.now()));

   if (visible.length === 0) {
      return (
         <IssueListEmpty filtered={filters.length > 0 || issues.length > 0} />
      );
   }

   return (
      <div className="flex h-full flex-col overflow-hidden">
         <div className="flex flex-wrap items-center gap-3 border-b px-4 py-1.5">
            <span className="text-muted-foreground">{t('gantt.zoom')}</span>
            <div className="flex items-center gap-1">
               {(['day', 'week', 'month'] as Zoom[]).map((option) => (
                  <Button
                     key={option}
                     size="xs"
                     variant={zoom === option ? 'secondary' : 'ghost'}
                     onClick={() => setZoom(option)}
                  >
                     {option === 'day'
                        ? t('gantt.day')
                        : option === 'week'
                          ? t('gantt.week')
                          : t('gantt.month')}
                  </Button>
               ))}
            </div>
            <div className="ml-auto flex items-center gap-2">
               <Label htmlFor="gantt-completed" className="font-normal text-muted-foreground">
                  {t('gantt.showCompleted')}
               </Label>
               <Switch
                  id="gantt-completed"
                  checked={showCompleted}
                  onCheckedChange={setShowCompleted}
               />
            </div>
         </div>

         {inverted.length > 0 ? (
            <div className="flex items-center gap-2 border-b bg-status-warning/10 px-4 py-1.5 text-status-warning">
               <AlertTriangle className="size-3.5 shrink-0" />
               {t('gantt.inverted', { count: inverted.length })}
            </div>
         ) : null}

         <div className="min-h-0 flex-1 overflow-auto px-4 py-3">
            <div className="grid w-full" style={{ gridTemplateColumns: `${LABEL_COL} minmax(0, 1fr)` }}>
               <div className="sticky left-0 z-10 bg-container" />
               <div className="mb-2 text-muted-foreground">
                  {axisBands.length > 0 ? (
                     <div className="relative mb-0.5 h-4">
                        {axisBands.map((span) => (
                           <span
                              key={`${span.left}-${span.label}`}
                              className="absolute truncate text-center font-medium"
                              style={{ left: `${span.left}%`, width: `${span.width}%` }}
                           >
                              {span.label}
                           </span>
                        ))}
                     </div>
                  ) : null}
                  <div className="relative h-5">
                     {ticks.map((tick, index) => (
                        <span
                           key={`${tick.left}-${tick.label}`}
                           className={cn(
                              'absolute tabular-nums',
                              index === ticks.length - 1 && 'translate-x-[-100%]'
                           )}
                           style={{
                              left: index === ticks.length - 1 ? '100%' : `${tick.left}%`,
                           }}
                        >
                           {tick.label}
                        </span>
                     ))}
                  </div>
               </div>

               {dated.map((issue) => {
                  const from = Date.parse(issue.createdAt);
                  const dueTime =
                     draftDue?.id === issue.id
                        ? draftDue.due
                        : Date.parse(issue.dueDate ?? issue.createdAt);
                  const backwards = dueTime < from;
                  const left = pctOf(Math.min(from, dueTime));
                  const right = pctOf(Math.max(from, dueTime));
                  const span = Math.max(0.8, right - left);
                  const dueLabel = new Date(dueTime).toLocaleDateString(undefined, {
                     month: 'short',
                     day: 'numeric',
                  });
                  return (
                     <div key={issue.id} className="contents">
                        <Link
                           href={`/${orgId}/issue/${issue.identifier}`}
                           className="sticky left-0 z-10 truncate bg-container pr-3 leading-6 hover:underline"
                        >
                           <span className="text-muted-foreground">{issue.identifier}</span>{' '}
                           {issue.title}
                        </Link>
                        <div className="relative h-6" data-gantt-track>
                           {weekendBands.map((band) => (
                              <div
                                 key={band.left}
                                 className="absolute inset-y-0 bg-muted/40"
                                 style={{ left: `${band.left}%`, width: `${band.width}%` }}
                              />
                           ))}
                           <div className="absolute inset-x-0 top-0.5 h-5 rounded bg-accent/40" />
                           <div
                              className={cn(
                                 'absolute top-0.5 h-5 rounded',
                                 backwards ? 'bg-status-danger/70' : 'bg-primary/70',
                                 draftDue?.id === issue.id && 'ring-1 ring-ring'
                              )}
                              style={{ left: `${left}%`, width: `${span}%` }}
                              title={`${issue.createdAt.slice(0, 10)} → ${dueLabel}`}
                           >
                              <button
                                 type="button"
                                 aria-label={t('gantt.resizeDue')}
                                 className="absolute inset-y-0 right-0 z-10 w-2.5 cursor-ew-resize rounded-r border-0 bg-transparent p-0 hover:bg-foreground/20"
                                 onPointerDown={(event) => onResizePointerDown(event, issue)}
                                 onPointerMove={onResizePointerMove}
                                 onPointerUp={onResizePointerUp}
                                 onPointerCancel={onResizePointerUp}
                              />
                           </div>
                           {todayLeft >= 0 && todayLeft <= 100 ? (
                              <div
                                 className="absolute inset-y-0 w-px bg-status-warning"
                                 style={{ left: `${todayLeft}%` }}
                                 title={t('gantt.today')}
                              />
                           ) : null}
                        </div>
                     </div>
                  );
               })}
            </div>

            {undated.length > 0 ? (
               <div className="mt-8 border-t border-[var(--shell-line)] pt-5">
                  <div className="mb-3 flex items-baseline gap-2">
                     <div className="font-medium uppercase tracking-[0.14em] text-[var(--shell-text-dim)]">
                        {t('gantt.noDueDate')}
                     </div>
                     <span className="tabular-nums text-muted-foreground">{undated.length}</span>
                  </div>
                  <div
                     className="grid w-full"
                     style={{ gridTemplateColumns: `${LABEL_COL} minmax(0, 1fr)` }}
                  >
                     {undated.map((issue) => (
                        <div key={issue.id} className="contents">
                           <Link
                              href={`/${orgId}/issue/${issue.identifier}`}
                              className="sticky left-0 z-10 truncate bg-container pr-3 leading-6 hover:underline"
                           >
                              <span className="text-muted-foreground">{issue.identifier}</span>{' '}
                              {issue.title}
                           </Link>
                           <div className="relative h-6">
                              <div
                                 className="absolute inset-x-0 top-0.5 h-5 rounded border border-dashed border-border/70 bg-muted/20"
                                 title={t('gantt.noDueDate')}
                              />
                           </div>
                        </div>
                     ))}
                  </div>
               </div>
            ) : null}
         </div>
      </div>
   );
}
