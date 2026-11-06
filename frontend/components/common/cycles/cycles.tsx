'use client';

import { CapacityRing } from '@/components/common/cycles/capacity-ring';
import { CreateCycleDialog } from '@/components/common/cycles/create-cycle-dialog';
import { EmptyCycles } from '@/components/common/cycles/empty-cycles';
import { Button } from '@/components/ui/button';
import { formatCycleRange, type Cycle } from '@/lib/cycles';
import { useCyclesStore } from '@/store/cycles-store';
import { CalendarRange, Plus } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

function statusLabel(
   status: Cycle['status'],
   t: ReturnType<typeof useTranslations<'cycles.status'>>
): string {
   return t(status);
}

export default function Cycles() {
   const t = useTranslations('cycles');
   const tStatus = useTranslations('cycles.status');
   const orgId = useParams<{ orgId: string }>().orgId;
   const cycles = useCyclesStore((state) => state.cycles);
   const loaded = useCyclesStore((state) => state.loaded);
   const [createOpen, setCreateOpen] = useState(false);

   if (!loaded) {
      return <div className="p-6 text-muted-foreground">{t('list.loading')}</div>;
   }

   return (
      <div className="flex h-full min-h-0 flex-col">
         {cycles.length === 0 ? (
            <EmptyCycles />
         ) : (
            <ul className="flex flex-col gap-0 overflow-auto px-2 py-2">
               {cycles.map((cycle) => {
                  const percent = cycle.progress?.percent ?? 0;
                  return (
                     <li key={cycle.id}>
                        <Link
                           href={`/${orgId}/cycle/${cycle.id}`}
                           className="flex items-center gap-3 rounded-md px-3 py-2.5 transition-colors hover:bg-muted/60"
                        >
                           <CalendarRange
                              className="size-4 shrink-0 text-muted-foreground"
                              aria-hidden
                           />
                           <div className="min-w-0 flex-1">
                              <div className="truncate font-medium">{cycle.name}</div>
                              <div className="truncate text-muted-foreground">
                                 {formatCycleRange(cycle)} · {statusLabel(cycle.status, tStatus)}
                              </div>
                           </div>
                           <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                              <CapacityRing value={percent} size={14} />
                              {percent}%
                           </span>
                        </Link>
                     </li>
                  );
               })}
               <li className="px-3 py-2">
                  <Button size="sm" variant="ghost" onClick={() => setCreateOpen(true)}>
                     <Plus className="size-3.5" aria-hidden />
                     {t('create.title')}
                  </Button>
               </li>
            </ul>
         )}
         <CreateCycleDialog open={createOpen} onOpenChange={setCreateOpen} />
      </div>
   );
}
