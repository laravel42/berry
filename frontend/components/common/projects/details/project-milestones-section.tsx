'use client';

import { ProjectDateSelector } from '@/components/common/projects/create-project/date-selector';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { canEditProduct, canEditSettings } from '@/lib/workspace-role';
import {
   archiveMilestone,
   createWorkspaceMilestone,
   currentMilestoneId,
   describeMilestoneFailure,
   reorderProjectMilestones,
   updateWorkspaceMilestone,
   type Milestone,
} from '@/lib/milestones';
import { cn } from '@/lib/utils';
import { useMilestonesStore } from '@/store/milestones-store';
import { useSessionStore } from '@/store/session-store';
import { format, parseISO } from 'date-fns';
import { Check, Diamond, GripVertical, Plus, X } from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import {
   Fragment,
   useEffect,
   useMemo,
   useRef,
   useState,
   type PointerEvent as ReactPointerEvent,
} from 'react';
import { toast } from 'sonner';
import { DetailSectionLabel } from './detail-section-label';

/**
 * Authored stages for one project: progress %, current mark, target date,
 * drag reorder. Home for milestones (no workspace rail).
 */
export function ProjectGoalsSection({
   projectId,
   compact = false,
}: {
   projectId: string;
   /** Tighter list for the properties pane. */
   compact?: boolean;
}) {
   const { orgId } = useParams<{ orgId: string }>();
   const router = useRouter();
   const searchParams = useSearchParams();
   const role = useSessionStore((state) => state.workspace?.role);
   const workspaceId = useSessionStore((state) => state.workspace?.id);
   const milestones = useMilestonesStore((state) => state.milestones);
   const removeMilestone = useMilestonesStore((state) => state.removeMilestone);
   const upsertMilestone = useMilestonesStore((state) => state.upsertMilestone);
   const hydrateGoals = useMilestonesStore((state) => state.hydrateGoals);
   const canEdit = canEditProduct(role);
   const canRemove = canEditSettings(role);

   const listed = useMemo(() => {
      return milestones
         .filter((milestone) => milestone.projectId === projectId)
         .sort(
            (left, right) =>
               (left.sortOrder ?? 0) - (right.sortOrder ?? 0) || left.id.localeCompare(right.id)
         );
   }, [milestones, projectId]);

   const currentId = currentMilestoneId(listed);
   const activeFilter = searchParams.get('milestone');

   const listRef = useRef<HTMLDivElement>(null);
   const composeTitleRef = useRef<HTMLInputElement>(null);
   const fromRef = useRef<number | null>(null);
   const insertRef = useRef<number | null>(null);
   const [dragIndex, setDragIndex] = useState<number | null>(null);
   const [insertAt, setInsertAt] = useState<number | null>(null);
   const [busy, setBusy] = useState(false);
   const [composing, setComposing] = useState(false);
   const [draftTitle, setDraftTitle] = useState('');
   const [draftDate, setDraftDate] = useState<Date | undefined>();

   useEffect(() => {
      if (!composing) return;
      composeTitleRef.current?.focus();
   }, [composing]);

   const startCompose = () => {
      setDraftTitle('');
      setDraftDate(undefined);
      setComposing(true);
   };

   const cancelCompose = () => {
      setComposing(false);
      setDraftTitle('');
      setDraftDate(undefined);
   };

   const saveCompose = async () => {
      const trimmed = draftTitle.trim();
      if (!trimmed || !workspaceId || busy) return;
      setBusy(true);
      try {
         const created = await createWorkspaceMilestone({
            workspaceId,
            title: trimmed,
            projectId,
            targetDate: draftDate ? format(draftDate, 'yyyy-MM-dd') : null,
         });
         upsertMilestone(created);
         cancelCompose();
      } catch (error) {
         toast.error(describeMilestoneFailure(error));
      } finally {
         setBusy(false);
      }
   };

   const resetDrag = () => {
      fromRef.current = null;
      insertRef.current = null;
      setDragIndex(null);
      setInsertAt(null);
   };

   const slotFromY = (clientY: number) => {
      const root = listRef.current;
      if (!root) return null;
      const rows = root.querySelectorAll<HTMLElement>('[data-reorder-row]');
      for (let i = 0; i < rows.length; i++) {
         const rect = rows[i]!.getBoundingClientRect();
         if (clientY < rect.top + rect.height / 2) return i;
      }
      return rows.length;
   };

   const isNoopSlot = (from: number, slot: number) => slot === from || slot === from + 1;

   const applyOrder = async (ordered: Milestone[]) => {
      if (!workspaceId) return;
      const previous = milestones;
      hydrateGoals(
         milestones.map((milestone) => {
            const index = ordered.findIndex((row) => row.id === milestone.id);
            return index >= 0 ? { ...milestone, sortOrder: index + 1 } : milestone;
         })
      );
      setBusy(true);
      try {
         await reorderProjectMilestones({
            workspaceId,
            projectId,
            milestoneIds: ordered.map((row) => row.id),
         });
      } catch (error) {
         hydrateGoals(previous);
         toast.error(describeMilestoneFailure(error));
      } finally {
         setBusy(false);
      }
   };

   const onGripPointerDown = (index: number) => (event: ReactPointerEvent<HTMLSpanElement>) => {
      if (!canEdit || busy) return;
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      fromRef.current = index;
      insertRef.current = index;
      setDragIndex(index);
      setInsertAt(index);
   };

   const onGripPointerMove = (event: ReactPointerEvent<HTMLSpanElement>) => {
      if (fromRef.current === null) return;
      const next = slotFromY(event.clientY);
      if (next === null || next === insertRef.current) return;
      insertRef.current = next;
      setInsertAt(next);
   };

   const onGripPointerUp = () => {
      const from = fromRef.current;
      const slot = insertRef.current;
      if (from !== null && slot !== null && !isNoopSlot(from, slot)) {
         const next = [...listed];
         const [moved] = next.splice(from, 1);
         if (moved) {
            next.splice(from < slot ? slot - 1 : slot, 0, moved);
            void applyOrder(next);
         }
      }
      resetDrag();
   };

   const setTargetDate = async (milestone: Milestone, date: Date | undefined) => {
      const targetDate = date ? format(date, 'yyyy-MM-dd') : null;
      setBusy(true);
      try {
         const updated = await updateWorkspaceMilestone(milestone.id, { targetDate });
         upsertMilestone(updated);
      } catch (error) {
         toast.error(describeMilestoneFailure(error));
      } finally {
         setBusy(false);
      }
   };

   const remove = async (milestone: Milestone) => {
      setBusy(true);
      try {
         await archiveMilestone(milestone.id);
         removeMilestone(milestone.id);
         if (activeFilter === milestone.id) {
            router.replace(`/${orgId}/project/${projectId}/overview`);
         }
         toast.success(`Removed ${milestone.title}`);
      } catch (error) {
         toast.error(describeMilestoneFailure(error));
      } finally {
         setBusy(false);
      }
   };

   const dragging = dragIndex !== null;
   const dropSlot =
      dragging && insertAt !== null && !isNoopSlot(dragIndex, insertAt) ? insertAt : null;
   const canSaveDraft = Boolean(draftTitle.trim() && workspaceId && !busy);

   return (
      <div className={cn(!compact && 'mt-4 border-t border-border/60 pt-4')}>
         <div className="mb-1 flex items-center justify-between gap-2">
            <DetailSectionLabel className="mb-0 pb-[7px]">Milestones</DetailSectionLabel>
            {canEdit ? (
               <Button
                  type="button"
                  variant="ghost"
                  size="xxs"
                  className="-mt-1 text-ripe hover:bg-card hover:text-ripe"
                  onClick={startCompose}
                  disabled={composing}
                  aria-label="New milestone"
               >
                  <Plus className="size-3.5" />
                  {!compact ? 'New milestone' : null}
               </Button>
            ) : null}
         </div>
         {listed.length === 0 && !composing ? (
            <p className="text-muted-foreground">No milestones in this project yet.</p>
         ) : (
            <div
               ref={listRef}
               className={cn('flex flex-col', dragging && 'cursor-grabbing select-none')}
            >
               {listed.map((milestone, index) => {
                  const percent = milestone.progress?.percent ?? 0;
                  const isCurrent = milestone.id === currentId;
                  const isFiltered = activeFilter === milestone.id;
                  return (
                     <Fragment key={milestone.id}>
                        {dropSlot === index ? (
                           <div className="my-0.5 h-0.5 rounded-full bg-amber-400" />
                        ) : null}
                        <div
                           data-reorder-row
                           className={cn(
                              'group flex items-center gap-1.5 rounded-sm px-1 py-1',
                              isFiltered && 'bg-accent/60',
                              dragIndex === index && 'opacity-40'
                           )}
                        >
                           {canEdit ? (
                              <span
                                 className="cursor-grab touch-none text-muted-foreground opacity-0 group-hover:opacity-100"
                                 onPointerDown={onGripPointerDown(index)}
                                 onPointerMove={onGripPointerMove}
                                 onPointerUp={onGripPointerUp}
                                 onPointerCancel={resetDrag}
                                 aria-label={`Reorder ${milestone.title}`}
                              >
                                 <GripVertical className="size-3.5" />
                              </span>
                           ) : (
                              <span className="w-3.5" />
                           )}
                           <Diamond
                              className={cn(
                                 'size-3.5 shrink-0',
                                 isCurrent
                                    ? 'fill-amber-400 text-amber-500'
                                    : 'text-muted-foreground'
                              )}
                              aria-hidden
                           />
                           <Link
                              href={`/${orgId}/project/${projectId}/overview?milestone=${milestone.id}`}
                              className="min-w-0 flex-1 truncate outline-none hover:underline focus-visible:underline"
                           >
                              {milestone.title}
                           </Link>
                           {canEdit ? (
                              <ProjectDateSelector
                                 label="Target date"
                                 layout="plain"
                                 emptyLabel="Date"
                                 date={
                                    milestone.targetDate
                                       ? parseISO(milestone.targetDate)
                                       : undefined
                                 }
                                 onChange={(date) => void setTargetDate(milestone, date)}
                              />
                           ) : milestone.targetDate ? (
                              <span className="hidden shrink-0 tabular-nums text-muted-foreground sm:inline">
                                 {format(parseISO(milestone.targetDate), 'MMM d')}
                              </span>
                           ) : null}
                           <span className="shrink-0 tabular-nums text-muted-foreground">
                              {percent}%
                           </span>
                           {canRemove ? (
                              <Button
                                 type="button"
                                 variant="ghost"
                                 size="icon"
                                 className="size-6 shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-destructive"
                                 aria-label={`Delete ${milestone.title}`}
                                 disabled={busy}
                                 onClick={() => void remove(milestone)}
                              >
                                 <X className="size-3.5" />
                              </Button>
                           ) : null}
                        </div>
                     </Fragment>
                  );
               })}
               {dropSlot === listed.length ? (
                  <div className="my-0.5 h-0.5 rounded-full bg-amber-400" />
               ) : null}
               {composing ? (
                  <div className="group flex items-center gap-1.5 rounded-sm px-1 py-1">
                     <span className="w-3.5" />
                     <Diamond className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                     <Input
                        ref={composeTitleRef}
                        value={draftTitle}
                        onChange={(event) => setDraftTitle(event.target.value)}
                        onKeyDown={(event) => {
                           if (event.key === 'Escape') {
                              event.preventDefault();
                              cancelCompose();
                              return;
                           }
                           if (event.key === 'Enter') {
                              event.preventDefault();
                              void saveCompose();
                           }
                        }}
                        placeholder="Milestone title"
                        aria-label="Milestone title"
                        className="h-7 min-w-0 flex-1 border-none bg-transparent px-0 shadow-none focus-visible:border-transparent focus-visible:shadow-none"
                        disabled={busy}
                     />
                     <ProjectDateSelector
                        label="Date"
                        date={draftDate}
                        onChange={setDraftDate}
                        iconOnly
                     />
                     <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-6 shrink-0 text-muted-foreground hover:text-foreground"
                        aria-label="Save milestone"
                        disabled={!canSaveDraft}
                        onClick={() => void saveCompose()}
                     >
                        <Check className="size-3.5" />
                     </Button>
                     <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-6 shrink-0 text-muted-foreground hover:text-foreground"
                        aria-label="Cancel"
                        disabled={busy}
                        onClick={cancelCompose}
                     >
                        <X className="size-3.5" />
                     </Button>
                  </div>
               ) : null}
            </div>
         )}
      </div>
   );
}
