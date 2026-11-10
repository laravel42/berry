'use client';

import { BerryMark } from '@/components/brand/berry-mark';
import { SegmentedControl } from '@/components/common/segmented-control';
import { ProjectDateSelector } from '@/components/common/projects/create-project/date-selector';
import { Button } from '@/components/ui/button';
import {
   Dialog,
   DialogClose,
   DialogContent,
   DialogDescription,
   DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import {
   addDays,
   daysBetween,
   formatDate,
   formatDay,
   isWeekend,
   nextCycleStart,
   todayIso,
} from '@/lib/cycle-math';
import { WORKSPACE_NAME } from '@/lib/config';
import { createWorkspaceCycle, cycleFailureDetail, type Cycle } from '@/lib/cycles';
import { cn } from '@/lib/utils';
import { useCyclesStore } from '@/store/cycles-store';
import { useSessionStore } from '@/store/session-store';
import { ArrowRight, Check, ChevronRight, Play, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useState, type FormEvent } from 'react';
import { toast } from 'sonner';

const PRESETS = [
   { days: 7, key: 'oneWeek' },
   { days: 14, key: 'twoWeeks' },
   { days: 21, key: 'threeWeeks' },
] as const;

/** The segment shown when the dates match no preset. */
const CUSTOM = 0;

/** Past this many days the preview stops drawing one cell per day. */
const MAX_PREVIEW_DAYS = 63;

interface Draft {
   name: string;
   startsOn: string;
   endsOn: string;
   activate: boolean;
}

/** Starts the day after the last cycle ends, two weeks long, active if none is. */
function freshDraft(cycles: Cycle[]): Draft {
   const startsOn = nextCycleStart(cycles, todayIso());
   return {
      name: '',
      startsOn,
      endsOn: addDays(startsOn, 13),
      activate: !cycles.some((cycle) => cycle.status === 'active'),
   };
}

/** A `YYYY-MM-DD` day as a local Date, for the calendar. */
function dayToDate(iso: string): Date | undefined {
   if (!iso) return undefined;
   const parsed = new Date(`${iso}T00:00:00`);
   return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

export function CreateCycleDialog({
   open,
   onOpenChange,
   onCreated,
}: {
   open: boolean;
   onOpenChange: (open: boolean) => void;
   /** The new cycle, once the server has it. */
   onCreated?: (cycle: Cycle) => void;
}) {
   const t = useTranslations('cycles.create');
   const workspaceId = useSessionStore((state) => state.workspace?.id);
   const workspaceName = useSessionStore((state) => state.workspace?.name) ?? WORKSPACE_NAME;
   const cycles = useCyclesStore((state) => state.cycles);
   const upsertCycle = useCyclesStore((state) => state.upsertCycle);
   const [draft, setDraft] = useState<Draft>(() => freshDraft(cycles));
   const [saving, setSaving] = useState(false);

   // Every opening starts from the calendar as it is now.
   useEffect(() => {
      if (open) setDraft(freshDraft(useCyclesStore.getState().cycles));
   }, [open]);

   const active = cycles.find((cycle) => cycle.status === 'active');
   const nextNumber = cycles.reduce((max, cycle) => Math.max(max, cycle.number), 0) + 1;
   const length =
      draft.startsOn && draft.endsOn ? daysBetween(draft.startsOn, draft.endsOn) + 1 : 0;
   const datesValid = Boolean(draft.startsOn && draft.endsOn) && length >= 1;
   const willActivate = draft.activate && !active;
   const preset = PRESETS.find((entry) => entry.days === length)?.days ?? CUSTOM;
   const startDate = dayToDate(draft.startsOn);
   const endDate = dayToDate(draft.endsOn);

   const durationOptions = [
      ...PRESETS.map((entry) => ({ value: entry.days as number, label: t(entry.key) })),
      ...(preset === CUSTOM ? [{ value: CUSTOM, label: t('custom') }] : []),
   ];

   // Moving the start keeps the length the person already chose.
   const moveStart = (date: Date | undefined) => {
      if (!date) return;
      const startsOn = todayIso(date);
      setDraft({
         ...draft,
         startsOn,
         endsOn: datesValid ? addDays(startsOn, length - 1) : draft.endsOn,
      });
   };

   const submit = async (event?: FormEvent) => {
      event?.preventDefault();
      if (!workspaceId || saving || !datesValid) return;
      setSaving(true);
      try {
         const name = draft.name.trim();
         const cycle = await createWorkspaceCycle({
            workspaceId,
            startsOn: draft.startsOn,
            endsOn: draft.endsOn,
            ...(name ? { name } : {}),
            ...(willActivate ? { status: 'active' as const } : {}),
         });
         upsertCycle(cycle);
         toast.success(t('created', { name: cycle.name }));
         onOpenChange(false);
         onCreated?.(cycle);
      } catch (error) {
         toast.error(t('failed'), cycleFailureDetail(error));
      } finally {
         setSaving(false);
      }
   };

   return (
      <Dialog open={open} onOpenChange={onOpenChange}>
         <DialogContent
            showCloseButton={false}
            className="top-[12vh] flex w-[560px] max-w-[calc(100vw-48px)] translate-y-0 flex-col gap-0 overflow-hidden rounded-xl p-0 shadow-xl sm:max-w-[calc(100vw-48px)]"
         >
            <form onSubmit={(event) => void submit(event)} className="flex flex-col">
               <div className="flex items-center justify-between gap-3 px-5 pt-4">
                  <div className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
                     <BerryMark size="sm" />
                     <span className="truncate font-medium text-foreground">{workspaceName}</span>
                     <ChevronRight className="size-3.5 shrink-0" aria-hidden />
                     <span className="truncate">{t('title')}</span>
                  </div>
                  {/* The breadcrumb is the visible title; an h2 here would restyle it. */}
                  <DialogTitle className="sr-only">{t('title')}</DialogTitle>
                  <DialogDescription className="sr-only">{t('activateHint')}</DialogDescription>
                  <DialogClose asChild>
                     <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-8 shrink-0"
                        aria-label={t('close')}
                     >
                        <X className="size-4" aria-hidden />
                     </Button>
                  </DialogClose>
               </div>

               <div className="flex flex-col gap-5 px-5 pt-4 pb-5">
                  <label htmlFor="cycle-name" className="sr-only">
                     {t('name')}
                  </label>
                  <Input
                     id="cycle-name"
                     data-heading="h1"
                     data-create-title
                     autoFocus
                     plain
                     className="h-auto border-none bg-transparent px-0 font-medium text-foreground shadow-none placeholder:font-normal placeholder:text-placeholder"
                     value={draft.name}
                     maxLength={500}
                     onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                     placeholder={`Cycle ${nextNumber}`}
                  />

                  <div className="flex flex-wrap items-center gap-2">
                     <ProjectDateSelector
                        label={t('startsOn')}
                        date={startDate}
                        onChange={moveStart}
                     />
                     <ArrowRight className="size-3.5 text-subtle-foreground" aria-hidden />
                     <ProjectDateSelector
                        label={t('endsOn')}
                        date={endDate}
                        disabled={startDate ? { before: startDate } : undefined}
                        onChange={(date) => date && setDraft({ ...draft, endsOn: todayIso(date) })}
                     />
                     <SegmentedControl
                        aria-label={t('duration')}
                        className="ml-auto"
                        options={durationOptions}
                        value={preset}
                        onValueChange={(days) => {
                           if (days === CUSTOM) return;
                           setDraft({
                              ...draft,
                              endsOn: addDays(draft.startsOn || todayIso(), days - 1),
                           });
                        }}
                     />
                  </div>

                  <CyclePreview
                     startsOn={draft.startsOn}
                     length={datesValid ? length : 0}
                     summary={
                        datesValid
                           ? `${formatDay(draft.startsOn)} → ${formatDate(draft.endsOn)}`
                           : t('endsBeforeStart')
                     }
                     lengthLabel={datesValid ? t('length', { count: length }) : null}
                  />

                  <label
                     htmlFor="cycle-activate"
                     className={cn(
                        'flex items-center gap-3 rounded-[10px] border px-3.5 py-3 transition-colors',
                        active ? 'cursor-default' : 'cursor-pointer hover:bg-accent/60',
                        willActivate && 'border-status-success/40 bg-status-success/10'
                     )}
                  >
                     <span
                        className={cn(
                           'flex size-8 shrink-0 items-center justify-center rounded-full',
                           willActivate
                              ? 'bg-status-success/20 text-status-success'
                              : 'bg-accent text-subtle-foreground'
                        )}
                     >
                        <Play className="size-3.5" aria-hidden />
                     </span>
                     <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <span
                           className={cn(
                              'font-medium',
                              active ? 'text-subtle-foreground' : 'text-foreground'
                           )}
                        >
                           {t('activate')}
                        </span>
                        <span className="text-pretty text-subtle-foreground">
                           {active ? t('activeTaken', { name: active.name }) : t('activateHint')}
                        </span>
                     </span>
                     <Switch
                        id="cycle-activate"
                        checked={willActivate}
                        disabled={Boolean(active)}
                        onCheckedChange={(checked) => setDraft({ ...draft, activate: checked })}
                     />
                  </label>
               </div>

               <div className="flex items-center justify-end gap-2 border-t px-5 py-3">
                  <DialogClose asChild>
                     <Button type="button" variant="ghost" disabled={saving}>
                        {t('cancel')}
                     </Button>
                  </DialogClose>
                  <Button type="submit" disabled={saving || !datesValid || !workspaceId}>
                     <Check className="size-4" aria-hidden />
                     {saving ? t('creating') : t('submit')}
                  </Button>
               </div>
            </form>
         </DialogContent>
      </Dialog>
   );
}

/**
 * The cycle drawn as its days: one cell each, weekends quieter, so a person
 * sees how many working days they are signing up for before they commit.
 */
function CyclePreview({
   startsOn,
   length,
   summary,
   lengthLabel,
}: {
   startsOn: string;
   length: number;
   summary: string;
   lengthLabel: string | null;
}) {
   const days =
      length > 0 && length <= MAX_PREVIEW_DAYS
         ? Array.from({ length }, (_, index) => addDays(startsOn, index))
         : [];
   const today = todayIso();

   return (
      <div className="flex flex-col gap-2.5 rounded-[10px] bg-accent/50 px-3.5 py-3">
         <div className="flex items-center justify-between gap-3">
            <span
               id="cycle-length"
               aria-live="polite"
               className={cn('truncate', lengthLabel ? 'text-foreground' : 'text-status-danger')}
            >
               {summary}
            </span>
            {lengthLabel ? (
               <span className="shrink-0 tabular-nums text-subtle-foreground">{lengthLabel}</span>
            ) : null}
         </div>
         <div className="flex h-6 items-stretch gap-[3px]" aria-hidden>
            {days.length > 0 ? (
               days.map((day) => (
                  <span
                     key={day}
                     title={formatDay(day)}
                     className={cn(
                        'min-w-0 flex-1 rounded-[3px]',
                        isWeekend(day) ? 'bg-primary/25' : 'bg-primary/70',
                        day === today &&
                           'ring-2 ring-foreground/60 ring-offset-1 ring-offset-background'
                     )}
                  />
               ))
            ) : (
               <span
                  className={cn(
                     'flex-1 rounded-[3px]',
                     length > 0 ? 'bg-primary/60' : 'bg-status-danger/20'
                  )}
               />
            )}
         </div>
      </div>
   );
}
