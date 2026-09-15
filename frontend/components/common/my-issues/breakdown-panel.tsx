'use client';

import { cn } from '@/lib/utils';
import { Issue } from '@/data/issues';
import { useRightPanelStore } from '@/store/right-panel-store';
import { X } from 'lucide-react';
import { useMemo, useState } from 'react';

type BreakdownTab = 'labels' | 'priority' | 'projects';

interface BreakdownRow {
   key: string;
   label: string;
   color?: string;
   count: number;
}

/**
 * A label's colour name is a hint from the workspace, not a hue Berry paints
 * with: the counters cycle the chart series so the swatches read as one set
 * in both themes.
 */
const LABEL_COLORS: Record<string, string> = {
   purple: 'var(--chart-1)',
   red: 'var(--chart-2)',
   green: 'var(--chart-3)',
   blue: 'var(--chart-4)',
   yellow: 'var(--chart-5)',
   orange: 'var(--chart-1)',
   pink: 'var(--chart-2)',
   gray: 'var(--chart-3)',
   indigo: 'var(--chart-4)',
   teal: 'var(--chart-5)',
   cyan: 'var(--chart-1)',
};

const PRIORITY_COLORS: Record<string, string> = {
   'no-priority': 'var(--status-neutral)',
   'urgent': 'var(--status-danger)',
   'high': 'var(--status-warning)',
   'medium': 'var(--chart-2)',
   'low': 'var(--status-success)',
};

/**
 * Right panel of My issues: Labels / Priority / Projects counters over the
 * currently displayed issues.
 */
export function BreakdownPanel({ issues }: { issues: Issue[] }) {
   const { closePanel } = useRightPanelStore();
   const [tab, setTab] = useState<BreakdownTab>('labels');

   const rows = useMemo<BreakdownRow[]>(() => {
      const counter = new Map<string, BreakdownRow>();
      const bump = (key: string, row: Omit<BreakdownRow, 'count'>) => {
         const existing = counter.get(key);
         if (existing) existing.count += 1;
         else counter.set(key, { ...row, count: 1 });
      };
      for (const issue of issues) {
         if (tab === 'labels') {
            for (const label of issue.labels) {
               bump(label.id, {
                  key: label.id,
                  label: label.name,
                  color: LABEL_COLORS[label.color] ?? 'var(--status-neutral)',
               });
            }
         } else if (tab === 'priority') {
            bump(issue.priority.id, {
               key: issue.priority.id,
               label: issue.priority.name,
               color: PRIORITY_COLORS[issue.priority.id] ?? 'var(--status-neutral)',
            });
         } else if (issue.project) {
            bump(issue.project.id, { key: issue.project.id, label: issue.project.name });
         }
      }
      return [...counter.values()].sort((a, b) => b.count - a.count);
   }, [tab, issues]);

   return (
      <div className="w-full h-full overflow-y-auto p-4 flex flex-col gap-4">
         <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 flex-wrap">
               {(
                  [
                     ['labels', 'Labels'],
                     ['priority', 'Priority'],
                     ['projects', 'Projects'],
                  ] as const
               ).map(([key, label]) => (
                  <button
                     key={key}
                     onClick={() => setTab(key)}
                     className={cn(
                        'px-2.5 py-1 rounded-full border font-medium transition-colors',
                        tab === key
                           ? 'bg-accent border-transparent'
                           : 'text-muted-foreground hover:bg-accent/50'
                     )}
                  >
                     {label}
                  </button>
               ))}
            </div>
            <button
               onClick={() => closePanel()}
               className="text-muted-foreground hover:text-foreground transition-colors shrink-0"
               aria-label="Close panel"
            >
               <X className="size-4" />
            </button>
         </div>
         <div className="flex flex-col gap-1">
            {rows.map((row) => (
               <div
                  key={row.key}
                  className="flex items-center gap-2 px-1.5 py-1.5 rounded-md hover:bg-accent/40"
               >
                  {row.color && (
                     <span
                        className="size-2.5 rounded-full shrink-0"
                        style={{ backgroundColor: row.color }}
                     />
                  )}
                  <span className="flex-1 truncate">{row.label}</span>
                  <span className="text-muted-foreground">{row.count}</span>
               </div>
            ))}
            {rows.length === 0 && (
               <span className="text-muted-foreground py-6 text-center">No data</span>
            )}
         </div>
      </div>
   );
}
