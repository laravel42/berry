'use client';

import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';
import type { FileDiff } from '@/data/reviews';
import { ArrowDownToLine, FileCode2 } from 'lucide-react';
import { DiffStat } from './review-shared';

/** One file diff: header (name, path, stats, Reviewed) + unified code view. */
export function DiffView({ diff }: { diff: FileDiff }) {
   return (
      <div className="overflow-hidden rounded-lg border bg-container">
         <div className="flex items-center gap-2 border-b bg-sidebar/50 px-3 py-2">
            <FileCode2 className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            <span className="font-medium">{diff.name}</span>
            <span className="truncate text-muted-foreground">{diff.path}/</span>
            <span className="flex-1" />
            <DiffStat additions={diff.additions} deletions={diff.deletions} />
            <label className="inline-flex cursor-pointer items-center gap-1.5 text-muted-foreground">
               <Checkbox className="size-3.5" />
               Reviewed
            </label>
         </div>
         <div className="overflow-x-auto font-mono leading-5">
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
      </div>
   );
}
