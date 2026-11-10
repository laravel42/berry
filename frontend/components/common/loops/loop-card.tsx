'use client';

import { CalendarClock, MoreHorizontal } from 'lucide-react';
import Link from 'next/link';
import { useFormatter, useTranslations } from 'next-intl';

import LoopRunStateBadge from '@/components/common/loops/run-state-badge';
import {
   HealthBar,
   LoopGlyph,
   TRIGGER_ICON,
   triggerSummaryKey,
} from '@/components/common/loops/loop-visuals';
import {
   DropdownMenu,
   DropdownMenuContent,
   DropdownMenuItem,
   DropdownMenuSeparator,
   DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Switch } from '@/components/ui/switch';
import type { Autopilot } from '@/lib/autopilots';
import { cn } from '@/lib/utils';

interface Props {
   loop: Autopilot;
   href: string;
   runHref: (runId: string) => string;
   assigneeName: string;
   canEdit: boolean;
   busy: boolean;
   onToggle: (loop: Autopilot, on: boolean) => void;
   onDuplicate: (loop: Autopilot) => void;
   onArchive: (loop: Autopilot) => void;
   onRestore: (loop: Autopilot) => void;
}

/**
 * One Loop as a card: what it is, who runs it, what starts it, and how its
 * week went. The switch turns it on and off where it stands; everything else
 * opens the Loop.
 *
 * The card is one link (stretched under the content) with the switch, the
 * menu and the last-run link raised above it, so each stays its own target.
 */
export default function LoopCard({
   loop,
   href,
   runHref,
   assigneeName,
   canEdit,
   busy,
   onToggle,
   onDuplicate,
   onArchive,
   onRestore,
}: Props) {
   const t = useTranslations('loops');
   const format = useFormatter();
   const archived = loop.status === 'archived';
   const on = loop.status === 'active';
   const trigger = triggerSummaryKey(loop);
   const TriggerIcon = TRIGGER_ICON[trigger];
   const lastRun = loop.activity.lastRun;
   const nextFireAt = on ? loop.activity.nextFireAt : null;
   const { runsLast7Days: runs, failedLast7Days: failed } = loop.activity;

   return (
      <article
         className={cn(
            'group relative flex min-w-0 flex-col rounded-xl border bg-card shadow-xs transition-[box-shadow,border-color]',
            'hover:border-foreground/15 hover:shadow-md focus-within:border-foreground/20',
            !on && 'bg-card/60'
         )}
      >
         <Link
            href={href}
            className="absolute inset-0 rounded-xl outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
            aria-label={loop.name}
         />

         <div className="flex min-w-0 items-start gap-3 p-4 pb-3">
            <LoopGlyph loop={loop} />
            <div className="min-w-0 flex-1">
               <h3 className={cn('truncate font-medium', !on && 'text-muted-foreground')}>
                  {loop.name}
               </h3>
               <p className="truncate text-muted-foreground">{assigneeName}</p>
            </div>
            <div className="relative z-10 flex shrink-0 items-center gap-1">
               {canEdit ? (
                  <DropdownMenu>
                     <DropdownMenuTrigger asChild>
                        <button
                           type="button"
                           aria-label={t('row.menu')}
                           className="rounded-md p-1 text-muted-foreground opacity-0 transition-opacity hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 group-hover:opacity-100 data-[state=open]:opacity-100"
                        >
                           <MoreHorizontal className="size-4" />
                        </button>
                     </DropdownMenuTrigger>
                     <DropdownMenuContent align="end" className="min-w-44">
                        <DropdownMenuItem asChild>
                           <Link href={href}>{t('row.open')}</Link>
                        </DropdownMenuItem>
                        {archived ? (
                           <DropdownMenuItem onClick={() => onRestore(loop)}>
                              {t('row.restore')}
                           </DropdownMenuItem>
                        ) : (
                           <>
                              <DropdownMenuItem onClick={() => onDuplicate(loop)}>
                                 {t('row.duplicate')}
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem onClick={() => onArchive(loop)}>
                                 {t('row.delete')}
                              </DropdownMenuItem>
                           </>
                        )}
                     </DropdownMenuContent>
                  </DropdownMenu>
               ) : null}
               {archived ? null : (
                  <Switch
                     checked={on}
                     disabled={!canEdit || busy}
                     onCheckedChange={(next) => onToggle(loop, next)}
                     aria-label={on ? t('row.pause') : t('row.resume')}
                     title={canEdit ? undefined : t('row.locked')}
                  />
               )}
            </div>
         </div>

         <p
            className={cn(
               'line-clamp-2 min-h-[2lh] px-4 text-pretty',
               loop.description ? 'text-muted-foreground' : 'text-subtle-foreground'
            )}
         >
            {loop.description || t('card.noDescription')}
         </p>

         <div className="flex flex-wrap items-center gap-1.5 px-4 pt-3">
            <span className="inline-flex h-6 items-center gap-1.5 rounded-full border border-border/70 px-2.5 leading-none text-muted-foreground">
               <TriggerIcon className="size-3.5" aria-hidden />
               {t(`trigger.${trigger}`)}
            </span>
            {archived ? (
               <span className="inline-flex h-6 items-center rounded-full bg-accent px-2.5 leading-none text-muted-foreground">
                  {t('status.archived')}
               </span>
            ) : !on ? (
               <span className="inline-flex h-6 items-center rounded-full bg-accent px-2.5 leading-none text-muted-foreground">
                  {t('status.paused')}
               </span>
            ) : nextFireAt ? (
               <span className="inline-flex h-6 items-center gap-1.5 rounded-full border border-border/70 px-2.5 leading-none text-muted-foreground">
                  <CalendarClock className="size-3.5" aria-hidden />
                  {t('card.next', { when: format.relativeTime(new Date(nextFireAt)) })}
               </span>
            ) : null}
         </div>

         <div className="mt-4 flex flex-col gap-2 border-t px-4 py-3">
            <div className="flex min-w-0 items-center justify-between gap-3">
               {lastRun ? (
                  <Link
                     href={runHref(lastRun.id)}
                     className="relative z-10 flex min-w-0 items-center gap-1.5 rounded text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                  >
                     <LoopRunStateBadge state={lastRun.state} compact />
                     <span className="truncate">
                        {t('card.lastRun', {
                           when: format.relativeTime(new Date(lastRun.createdAt)),
                        })}
                     </span>
                  </Link>
               ) : (
                  <span className="truncate text-subtle-foreground">{t('row.neverRan')}</span>
               )}
               <span className="shrink-0 tabular-nums text-subtle-foreground">
                  {failed > 0
                     ? t('card.weekFailed', { runs, failed })
                     : t('card.week', { count: runs })}
               </span>
            </div>
            <HealthBar runs={runs} failed={failed} />
         </div>
      </article>
   );
}
