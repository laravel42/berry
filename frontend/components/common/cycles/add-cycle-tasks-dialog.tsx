'use client';

import { statusFill } from '@/components/common/cycles/cycle-visuals';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
   Command,
   CommandEmpty,
   CommandGroup,
   CommandInput,
   CommandItem,
   CommandList,
} from '@/components/ui/command';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { apiStatusFromUi } from '@/lib/catalog';
import { setIssueCycle, type Cycle } from '@/lib/cycles';
import { cn } from '@/lib/utils';
import { useCyclesStore } from '@/store/cycles-store';
import { useIssuesStore } from '@/store/issues-store';
import { useTranslations } from 'next-intl';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';

/** Open work first, then what is finished; newest first within each. */
const CLOSED = new Set(['done', 'cancelled']);

/**
 * Schedules tasks into a cycle. Lists the board's tasks that are not in this
 * cycle yet; a task in another cycle says so, and adding it moves it here —
 * a task belongs to one cycle at a time.
 */
export function AddCycleTasksDialog({
   cycle,
   open,
   onOpenChange,
   onAdded,
}: {
   cycle: Cycle;
   open: boolean;
   onOpenChange: (open: boolean) => void;
   onAdded: () => void;
}) {
   const t = useTranslations('cycles.add');
   const issues = useIssuesStore((state) => state.issues);
   const updateIssue = useIssuesStore((state) => state.updateIssue);
   const cycles = useCyclesStore((state) => state.cycles);
   const [selected, setSelected] = useState<Set<string>>(new Set());
   const [saving, setSaving] = useState(false);

   useEffect(() => {
      if (open) setSelected(new Set());
   }, [open]);

   const candidates = useMemo(() => {
      const outside = issues.filter((issue) => issue.cycleId !== cycle.id);
      const rank = (statusId: string) => (CLOSED.has(statusId) ? 1 : 0);
      return outside.sort(
         (left, right) =>
            rank(left.status.id) - rank(right.status.id) ||
            right.createdAt.localeCompare(left.createdAt)
      );
   }, [issues, cycle.id]);

   const cycleName = (id: string) => cycles.find((candidate) => candidate.id === id)?.name;

   const toggle = (id: string) =>
      setSelected((previous) => {
         const next = new Set(previous);
         if (next.has(id)) next.delete(id);
         else next.add(id);
         return next;
      });

   const submit = async () => {
      if (saving || selected.size === 0) return;
      setSaving(true);
      const chosen = candidates.filter((issue) => selected.has(issue.id));
      const results = await Promise.allSettled(
         chosen.map(async (issue) => {
            await setIssueCycle(cycle.id, issue.identifier);
            updateIssue(issue.id, { cycleId: cycle.id });
         })
      );
      setSaving(false);
      const added = results.filter((result) => result.status === 'fulfilled').length;
      if (added > 0) toast.success(t('added', { count: added }));
      if (added < chosen.length) toast.error(t('failed'));
      onAdded();
      if (added === chosen.length) onOpenChange(false);
   };

   return (
      <Dialog open={open} onOpenChange={onOpenChange}>
         <DialogContent
            showCloseButton={false}
            className="top-24 flex w-[560px] max-w-[calc(100vw-48px)] translate-y-0 flex-col gap-0 overflow-hidden rounded-xl p-0 sm:max-w-[calc(100vw-48px)]"
         >
            <div className="flex h-[52px] shrink-0 items-center border-b px-5">
               <DialogTitle className="truncate">{t('title', { name: cycle.name })}</DialogTitle>
               <DialogDescription className="sr-only">{t('search')}</DialogDescription>
            </div>
            <Command className="rounded-none bg-transparent">
               <CommandInput placeholder={t('search')} aria-label={t('search')} />
               <CommandList className="max-h-[min(420px,55vh)]">
                  <CommandEmpty>{candidates.length === 0 ? t('none') : t('empty')}</CommandEmpty>
                  <CommandGroup>
                     {candidates.map((issue) => {
                        const checked = selected.has(issue.id);
                        const elsewhere = issue.cycleId ? cycleName(issue.cycleId) : undefined;
                        return (
                           <CommandItem
                              key={issue.id}
                              value={`${issue.identifier} ${issue.title} ${issue.id}`}
                              onSelect={() => toggle(issue.id)}
                              className="flex items-center gap-3"
                           >
                              <Checkbox
                                 checked={checked}
                                 tabIndex={-1}
                                 aria-hidden
                                 className="pointer-events-none"
                              />
                              <span
                                 aria-hidden
                                 className={cn(
                                    'size-1.5 shrink-0 rounded-full',
                                    statusFill(apiStatusFromUi(issue.status.id))
                                 )}
                              />
                              <span className="w-16 shrink-0 text-subtle-foreground">
                                 {issue.identifier}
                              </span>
                              <span
                                 className={cn(
                                    'min-w-0 flex-1 truncate',
                                    CLOSED.has(issue.status.id) && 'text-subtle-foreground'
                                 )}
                              >
                                 {issue.title}
                              </span>
                              {elsewhere ? (
                                 <span className="shrink-0 whitespace-nowrap text-subtle-foreground">
                                    {t('inOther', { name: elsewhere })}
                                 </span>
                              ) : null}
                           </CommandItem>
                        );
                     })}
                  </CommandGroup>
               </CommandList>
            </Command>
            <div className="flex h-[60px] shrink-0 items-center gap-2 border-t px-5">
               <span className="text-subtle-foreground" aria-live="polite">
                  {t('selected', { count: selected.size })}
               </span>
               <Button
                  variant="soft"
                  className="ml-auto"
                  disabled={saving}
                  onClick={() => onOpenChange(false)}
               >
                  {t('cancel')}
               </Button>
               <Button disabled={saving || selected.size === 0} onClick={() => void submit()}>
                  {t('submit')}
               </Button>
            </div>
         </DialogContent>
      </Dialog>
   );
}
