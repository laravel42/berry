'use client';

import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';
import type { FileDiff } from '@/data/reviews';
import { ArrowDownToLine, ChevronDown, ChevronRight, FileCode2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { DiffStat } from './review-shared';

/** One file diff: header (name, path, stats, Reviewed) + unified code view. */
export function DiffView({ diff }: { diff: FileDiff }) {
   const t = useTranslations('reviews.diff');
   const [collapsed, setCollapsed] = useState(false);

   return (
      <div className="overflow-hidden rounded-lg border bg-container">
         <div
            className={cn(
               'flex items-center gap-2 bg-sidebar/50 px-3 py-2',
               !collapsed && 'border-b'
            )}
         >
            <FileCode2 className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            <span className="text-[12px] font-medium">{diff.name}</span>
            <span className="truncate text-[12px] text-muted-foreground">{diff.path}/</span>
            <span className="flex-1" />
            <DiffStat
               additions={diff.additions}
               deletions={diff.deletions}
               className="text-[12px]"
            />
            <label className="inline-flex cursor-pointer items-center gap-1.5 text-[12px] text-muted-foreground">
               <Checkbox className="size-3.5" />
               Reviewed
            </label>
            <button
               type="button"
               className="inline-flex size-5 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
               aria-expanded={!collapsed}
               aria-label={collapsed ? t('expand') : t('collapse')}
               title={collapsed ? t('expand') : t('collapse')}
               onClick={() => setCollapsed((value) => !value)}
            >
               {collapsed ? (
                  <ChevronRight className="size-3.5" aria-hidden />
               ) : (
                  <ChevronDown className="size-3.5" aria-hidden />
               )}
            </button>
         </div>
         {collapsed ? null : (
            <div className="overflow-x-auto font-mono text-[12px] leading-5">
               {diff.lines.map((line, index) => {
                  if (line.type === 'skip') {
                     return (
                        <div
                           key={index}
                           className="flex items-center justify-center gap-1.5 border-y border-border/40 bg-sidebar/40 py-1.5 text-muted-foreground"
                        >
                           <ArrowDownToLine className="size-3" aria-hidden />
                           {line.count} unchanged lines
                        </div>
                     );
                  }
                  return (
                     <div
                        key={index}
                        className={cn(
                           'flex',
                           line.type === 'add' && 'bg-status-success/10',
                           line.type === 'del' && 'bg-status-danger/10'
                        )}
                     >
                        <span
                           className={cn(
                              'w-10 shrink-0 select-none border-r border-border/40 pr-2 text-right text-muted-foreground/60',
                              line.type === 'add' && 'border-l border-l-status-success',
                              line.type === 'del' && 'border-l border-l-status-danger'
                           )}
                        >
                           {line.type === 'del' ? '-' : line.number}
                        </span>
                        <pre className="whitespace-pre px-3">{line.text}</pre>
                     </div>
                  );
               })}
            </div>
         )}
      </div>
   );
}
