'use client';

import { Lock, MoreHorizontal } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useFormatter, useTranslations } from 'next-intl';

import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import {
   DropdownMenu,
   DropdownMenuContent,
   DropdownMenuItem,
   DropdownMenuSeparator,
   DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { Autopilot } from '@/lib/autopilots';
import { WORKSPACE_SLUG } from '@/lib/config';
import { cn } from '@/lib/utils';

import type { AutopilotColumn } from './autopilots-filters';

/** The widths every cell shares with its header, so the two line up. */
export const COLUMN_WIDTH: Record<AutopilotColumn, string> = {
   status: 'w-20',
   mode: 'w-40',
   quota: 'w-32',
   updated: 'w-28',
};

/** Columns that drop out before the row starts crowding the name. */
export const COLUMN_BREAKPOINT: Partial<Record<AutopilotColumn, string>> = {
   mode: 'hidden lg:flex',
   quota: 'hidden xl:flex',
   updated: 'hidden sm:flex',
};

interface AutopilotLineProps {
   autopilot: Autopilot;
   columns: AutopilotColumn[];
   assigneeName: string;
   canEdit: boolean;
   selected: boolean;
   onToggleSelected: (id: string) => void;
   onPauseOrResume: (autopilot: Autopilot) => void;
   onConfirmDelete: (autopilot: Autopilot) => void;
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
            'shrink-0 items-center gap-1.5 text-muted-foreground',
            COLUMN_WIDTH[column],
            COLUMN_BREAKPOINT[column] ?? 'flex',
            className
         )}
      >
         {children}
      </div>
   );
}

/**
 * One autopilot in the list — same row shape as an agent line: checkbox,
 * name, optional cells, hover menu.
 */
export default function AutopilotLine({
   autopilot,
   columns,
   assigneeName,
   canEdit,
   selected,
   onToggleSelected,
   onPauseOrResume,
   onConfirmDelete,
}: AutopilotLineProps) {
   const t = useTranslations('areas.autopilots');
   const format = useFormatter();
   const params = useParams<{ orgId?: string }>();
   const orgId = params?.orgId || WORKSPACE_SLUG;
   const href = `/${orgId}/autopilot/${autopilot.id}`;
   const paused = autopilot.status === 'paused';

   return (
      <div
         className={cn(
            'group flex w-full items-center gap-3 border-b border-muted-foreground/5 px-6 py-3',
            'last:border-b-0 hover:bg-sidebar/50',
            selected && 'bg-sidebar/60'
         )}
      >
         {canEdit ? (
            <Checkbox
               checked={selected}
               onCheckedChange={() => onToggleSelected(autopilot.id)}
               aria-label={t('bulk.select', { name: autopilot.name })}
               className="shrink-0"
            />
         ) : null}

         <Link href={href} className="flex min-w-0 flex-1 items-center">
            <div className="min-w-0 flex-1 overflow-hidden">
               <span className="block truncate font-medium leading-none">{autopilot.name}</span>
               <p className="mt-0.5 truncate text-muted-foreground">{assigneeName}</p>
            </div>
         </Link>

         <Cell column="status" columns={columns}>
            <Badge
               variant="outline"
               className={
                  paused
                     ? 'border-status-neutral/40 bg-status-neutral/10 text-status-neutral'
                     : 'border-status-success/40 bg-status-success/10 text-status-success'
               }
            >
               {t(`status.${autopilot.status}`)}
            </Badge>
         </Cell>

         <Cell column="mode" columns={columns}>
            <span className="truncate">{t(`mode.${autopilot.executionMode}`)}</span>
         </Cell>

         <Cell column="quota" columns={columns}>
            <span className="truncate">
               {autopilot.quotaPeriod === 'none'
                  ? t('quota.none')
                  : t('quota.some', {
                       count: autopilot.quotaMax ?? 0,
                       period: t(`quota.${autopilot.quotaPeriod}`),
                    })}
            </span>
         </Cell>

         <Cell column="updated" columns={columns}>
            <span className="truncate">{format.relativeTime(new Date(autopilot.updatedAt))}</span>
         </Cell>

         {canEdit ? (
            <DropdownMenu>
               <DropdownMenuTrigger asChild>
                  <button
                     type="button"
                     aria-label={t('row.menu')}
                     className="shrink-0 rounded p-1 text-muted-foreground opacity-0 transition-colors hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 group-hover:opacity-100 data-[state=open]:opacity-100"
                  >
                     <MoreHorizontal className="size-4" />
                  </button>
               </DropdownMenuTrigger>
               <DropdownMenuContent align="end" className="min-w-52">
                  <DropdownMenuItem asChild>
                     <Link href={href}>{t('row.open')}</Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => onPauseOrResume(autopilot)}>
                     {paused ? t('row.resume') : t('row.pause')}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => onConfirmDelete(autopilot)}>
                     {t('row.delete')}
                  </DropdownMenuItem>
               </DropdownMenuContent>
            </DropdownMenu>
         ) : (
            <Lock className="size-4 shrink-0 text-muted-foreground" aria-label={t('row.locked')} />
         )}
      </div>
   );
}
