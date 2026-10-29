'use client';

import { Clock, Link2, Play } from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useFormatter, useTranslations } from 'next-intl';

import { BerryMark } from '@/components/brand/berry-mark';
import {
   ContextMenu,
   ContextMenuContent,
   ContextMenuItem,
   ContextMenuSeparator,
   ContextMenuTrigger,
} from '@/components/ui/context-menu';
import { Switch } from '@/components/ui/switch';
import type { AutopilotActivity } from '@/hooks/use-autopilot-activity';
import type { Autopilot, AutopilotRun } from '@/lib/autopilots';
import { WORKSPACE_SLUG } from '@/lib/config';
import { cn } from '@/lib/utils';

import type { AutopilotColumn } from './autopilots-filters';
import { useDescribeCron } from './schedule-editor';

/** Track widths per column; the name track and the switch track bracket them. */
export const COLUMN_TRACK: Record<AutopilotColumn, string> = {
   agent: 'minmax(0,1fr)',
   lastRun: 'minmax(0,1.3fr)',
   nextRun: 'minmax(0,1fr)',
   mode: 'minmax(0,1.2fr)',
   quota: 'minmax(0,0.9fr)',
   updated: 'minmax(0,0.9fr)',
};

/** Columns that drop out before the row starts crowding the name. */
export const COLUMN_BREAKPOINT: Partial<Record<AutopilotColumn, string>> = {
   nextRun: 'max-md:hidden',
   mode: 'max-lg:hidden',
   quota: 'max-xl:hidden',
   updated: 'max-lg:hidden',
   agent: 'max-sm:hidden',
};

/** The grid every row shares with the header, so the two line up. */
export function gridTemplate(columns: AutopilotColumn[]): string {
   return ['minmax(0,2.2fr)', ...columns.map((column) => COLUMN_TRACK[column]), '36px'].join(' ');
}

export type RunTone = 'success' | 'danger' | 'warning' | 'neutral';

/** How one firing turned out, for a dot and a word. */
export function runOutcome(run: AutopilotRun): {
   tone: RunTone;
   key: 'succeeded' | 'failed' | 'cancelled' | 'running' | 'queued' | 'skipped' | 'notQueued';
} {
   if (run.status === 'skipped') return { tone: 'neutral', key: 'skipped' };
   if (run.status === 'failed') return { tone: 'danger', key: 'notQueued' };
   switch (run.taskStatus) {
      case 'succeeded':
         return { tone: 'success', key: 'succeeded' };
      case 'failed':
         return { tone: 'danger', key: 'failed' };
      case 'cancelled':
         return { tone: 'neutral', key: 'cancelled' };
      case 'running':
         return { tone: 'warning', key: 'running' };
      default:
         return { tone: 'warning', key: 'queued' };
   }
}

export const DOT_TONE: Record<RunTone, string> = {
   success: 'bg-status-success',
   danger: 'bg-status-danger',
   warning: 'bg-status-warning',
   neutral: 'bg-status-neutral',
};

/** The Berry bracket glyph in the agent colour, beside an agent's name. */
export function AgentMark({ className }: { className?: string }) {
   return (
      <BerryMark
         tone="working"
         bracketClassName="text-status-info"
         className={cn('size-3', className)}
         aria-hidden
      />
   );
}

interface AutopilotLineProps {
   autopilot: Autopilot;
   activity: AutopilotActivity | undefined;
   columns: AutopilotColumn[];
   assigneeName: string;
   canEdit: boolean;
   onPauseOrResume: (autopilot: Autopilot) => void;
   onConfirmDelete: (autopilot: Autopilot) => void;
   onRestore: (autopilot: Autopilot) => void;
}

function Cell({
   column,
   columns,
   className,
   children,
}: {
   column: AutopilotColumn;
   columns: AutopilotColumn[];
   className?: string;
   children: React.ReactNode;
}) {
   if (!columns.includes(column)) return null;
   return (
      <div
         className={cn(
            'flex min-w-0 items-center gap-2 text-muted-foreground',
            COLUMN_BREAKPOINT[column],
            className
         )}
      >
         {children}
      </div>
   );
}

function Truncate({ children, className }: { children: React.ReactNode; className?: string }) {
   return <span className={cn('min-w-0 truncate', className)}>{children}</span>;
}

/**
 * One autopilot in the list: name over what sets it off, then agent, last run,
 * next run and the on/off switch. The whole row opens the editor; the switch
 * pauses or resumes in place. Archive and restore sit on the context menu.
 */
export default function AutopilotLine({
   autopilot,
   activity,
   columns,
   assigneeName,
   canEdit,
   onPauseOrResume,
   onConfirmDelete,
   onRestore,
}: AutopilotLineProps) {
   const t = useTranslations('areas.autopilots');
   const format = useFormatter();
   const router = useRouter();
   const describeCron = useDescribeCron();
   const params = useParams<{ orgId?: string }>();
   const orgId = params?.orgId || WORKSPACE_SLUG;
   const href = `/${orgId}/autopilots/${autopilot.id}`;
   const archived = autopilot.status === 'archived';
   const on = autopilot.status === 'active';

   const triggers = activity?.triggers ?? [];
   const cron = triggers.find((trigger) => trigger.kind === 'cron' && trigger.enabled);
   const webhook = triggers.find((trigger) => trigger.kind === 'webhook' && trigger.enabled);
   const kind: 'cron' | 'webhook' | 'manual' = autopilot.triggerKinds.includes('cron')
      ? 'cron'
      : autopilot.triggerKinds.includes('webhook')
        ? 'webhook'
        : 'manual';
   const KindIcon = kind === 'cron' ? Clock : kind === 'webhook' ? Link2 : Play;
   const triggerText =
      kind === 'cron'
         ? cron?.cronExpression
            ? describeCron(cron.cronExpression)
            : t('trigger.schedule')
         : kind === 'webhook'
           ? webhook && webhook.eventFilters.length > 0
              ? t('trigger.webhookEvents', { events: webhook.eventFilters.join(', ') })
              : t('trigger.webhook')
           : t('trigger.manual');

   const nextFire = triggers
      .filter((trigger) => trigger.enabled && trigger.nextFireAt)
      .map((trigger) => trigger.nextFireAt as string)
      .sort()[0];
   const nextText = archived
      ? t('status.archived')
      : !on
        ? t('status.paused')
        : nextFire
          ? format.dateTime(new Date(nextFire), { dateStyle: 'medium', timeStyle: 'short' })
          : kind === 'webhook'
            ? t('next.webhook')
            : kind === 'manual'
              ? t('next.manual')
              : '—';

   const last = activity?.lastRun ?? null;
   const outcome = last ? runOutcome(last) : null;

   const open = () => router.push(href);

   return (
      <ContextMenu>
         <ContextMenuTrigger asChild>
            <div
               onClick={open}
               className="grid cursor-pointer items-center gap-4 border-t border-settings-divider px-4 py-3 transition-colors hover:bg-settings-row-hover"
               style={{ gridTemplateColumns: gridTemplate(columns) }}
            >
               <div className="flex min-w-0 flex-col gap-[3px]">
                  <Link
                     href={href}
                     onClick={(event) => event.stopPropagation()}
                     className={cn(
                        'min-w-0 truncate font-semibold outline-none focus-visible:underline',
                        on ? 'text-foreground' : 'text-status-neutral'
                     )}
                  >
                     {autopilot.name}
                  </Link>
                  <span
                     data-settings-type="caption"
                     className="flex min-w-0 items-center gap-1.5 text-subtle-foreground"
                  >
                     <KindIcon className="size-3 shrink-0" aria-hidden />
                     <Truncate>{triggerText}</Truncate>
                  </span>
               </div>

               <Cell column="agent" columns={columns}>
                  <AgentMark />
                  <Truncate>{assigneeName}</Truncate>
               </Cell>

               <Cell column="lastRun" columns={columns}>
                  {last && outcome ? (
                     <>
                        <span
                           aria-hidden
                           className={cn('size-1.5 shrink-0 rounded-full', DOT_TONE[outcome.tone])}
                        />
                        <Truncate
                           className={outcome.tone === 'danger' ? 'text-status-danger' : undefined}
                        >
                           {t('last.text', {
                              when: format.relativeTime(new Date(last.createdAt)),
                              outcome: t(`outcome.${outcome.key}`),
                           })}
                        </Truncate>
                     </>
                  ) : (
                     <Truncate className="text-subtle-foreground">
                        {activity ? t('last.never') : '—'}
                     </Truncate>
                  )}
               </Cell>

               <Cell column="nextRun" columns={columns}>
                  <Truncate className={on ? undefined : 'text-subtle-foreground'}>
                     {nextText}
                  </Truncate>
               </Cell>

               <Cell column="mode" columns={columns}>
                  <Truncate>{t(`mode.${autopilot.executionMode}`)}</Truncate>
               </Cell>

               <Cell column="quota" columns={columns}>
                  <Truncate>
                     {autopilot.quotaPeriod === 'none'
                        ? t('quota.none')
                        : t('quota.some', {
                             count: autopilot.quotaMax ?? 0,
                             period: t(`quota.${autopilot.quotaPeriod}`),
                          })}
                  </Truncate>
               </Cell>

               <Cell column="updated" columns={columns}>
                  <Truncate>{format.relativeTime(new Date(autopilot.updatedAt))}</Truncate>
               </Cell>

               <div className="flex justify-end" onClick={(event) => event.stopPropagation()}>
                  {archived ? null : (
                     <Switch
                        variant="settings"
                        checked={on}
                        disabled={!canEdit}
                        title={canEdit ? undefined : t('row.locked')}
                        aria-label={t('row.toggle', { name: autopilot.name })}
                        onCheckedChange={() => onPauseOrResume(autopilot)}
                     />
                  )}
               </div>
            </div>
         </ContextMenuTrigger>
         <ContextMenuContent className="min-w-48">
            <ContextMenuItem onClick={open}>{t('row.open')}</ContextMenuItem>
            {canEdit ? (
               archived ? (
                  <ContextMenuItem onClick={() => onRestore(autopilot)}>
                     {t('row.restore')}
                  </ContextMenuItem>
               ) : (
                  <>
                     <ContextMenuItem onClick={() => onPauseOrResume(autopilot)}>
                        {on ? t('row.pause') : t('row.resume')}
                     </ContextMenuItem>
                     <ContextMenuSeparator />
                     <ContextMenuItem onClick={() => onConfirmDelete(autopilot)}>
                        {t('row.delete')}
                     </ContextMenuItem>
                  </>
               )
            ) : null}
         </ContextMenuContent>
      </ContextMenu>
   );
}
