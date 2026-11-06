'use client';

import { CapacityRing } from '@/components/common/cycles/capacity-ring';
import { Button } from '@/components/ui/button';
import {
   archiveCycle,
   formatCycleRange,
   getCycle,
   listCycleIssues,
   updateWorkspaceCycle,
   type Cycle,
   type CycleIssueRef,
} from '@/lib/cycles';
import { useCyclesStore } from '@/store/cycles-store';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

export default function CycleDetail({ cycleId }: { cycleId: string }) {
   const t = useTranslations('cycles');
   const tStatus = useTranslations('cycles.status');
   const orgId = useParams<{ orgId: string }>().orgId;
   const router = useRouter();
   const upsertCycle = useCyclesStore((state) => state.upsertCycle);
   const removeCycle = useCyclesStore((state) => state.removeCycle);
   const cached = useCyclesStore((state) => state.getCycleById(cycleId));
   const [cycle, setCycle] = useState<Cycle | null>(cached ?? null);
   const [issues, setIssues] = useState<CycleIssueRef[]>([]);
   const [busy, setBusy] = useState(false);

   useEffect(() => {
      let cancelled = false;
      void getCycle(cycleId)
         .then((loaded) => {
            if (cancelled) return;
            setCycle(loaded);
            upsertCycle(loaded);
         })
         .catch(() => {
            if (!cancelled) setCycle(null);
         });
      void listCycleIssues(cycleId)
         .then((nodes) => {
            if (!cancelled) setIssues(nodes);
         })
         .catch(() => {
            if (!cancelled) setIssues([]);
         });
      return () => {
         cancelled = true;
      };
   }, [cycleId, upsertCycle]);

   if (!cycle) {
      return <div className="p-6 text-muted-foreground">{t('list.loading')}</div>;
   }

   const percent = cycle.progress?.percent ?? 0;

   const setStatus = async (status: Cycle['status']) => {
      if (busy) return;
      setBusy(true);
      try {
         const updated = await updateWorkspaceCycle(cycle.id, { status });
         setCycle(updated);
         upsertCycle(updated);
      } catch {
         toast.error(t('detail.failed'));
      } finally {
         setBusy(false);
      }
   };

   const remove = async () => {
      if (busy) return;
      setBusy(true);
      try {
         await archiveCycle(cycle.id);
         removeCycle(cycle.id);
         toast.success(t('detail.removed', { name: cycle.name }));
         router.push(`/${orgId}/cycles`);
      } catch {
         toast.error(t('detail.failed'));
         setBusy(false);
      }
   };

   return (
      <div className="flex h-full min-h-0 flex-col gap-4 p-6">
         <div className="flex flex-wrap items-center gap-3">
            <Button variant="ghost" size="sm" asChild>
               <Link href={`/${orgId}/cycles`}>
                  <ArrowLeft className="size-3.5" aria-hidden />
                  {t('detail.back')}
               </Link>
            </Button>
            <div className="min-w-0 flex-1">
               <h1 className="truncate font-medium">{cycle.name}</h1>
               <p className="text-muted-foreground">
                  {formatCycleRange(cycle)} · {tStatus(cycle.status)}
               </p>
            </div>
            <span className="inline-flex items-center gap-1.5 text-muted-foreground">
               <CapacityRing value={percent} size={16} />
               {percent}%
            </span>
         </div>
         <div className="flex flex-wrap gap-2">
            {cycle.status !== 'active' ? (
               <Button
                  size="sm"
                  variant="secondary"
                  disabled={busy}
                  onClick={() => void setStatus('active')}
               >
                  {t('detail.activate')}
               </Button>
            ) : null}
            {cycle.status !== 'completed' ? (
               <Button
                  size="sm"
                  variant="secondary"
                  disabled={busy}
                  onClick={() => void setStatus('completed')}
               >
                  {t('detail.complete')}
               </Button>
            ) : null}
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => void remove()}>
               {t('detail.remove')}
            </Button>
         </div>
         <section className="min-h-0 flex-1 overflow-auto">
            <h2 className="mb-2 font-medium text-muted-foreground">{t('detail.issues')}</h2>
            {issues.length === 0 ? (
               <p className="text-muted-foreground">{t('detail.noIssues')}</p>
            ) : (
               <ul className="flex flex-col gap-1">
                  {issues.map((issue) => (
                     <li key={issue.id}>
                        <Link
                           href={`/${orgId}/issue/${issue.identifier}`}
                           className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-muted/60"
                        >
                           <span className="text-muted-foreground">{issue.identifier}</span>
                           <span className="truncate">{issue.title}</span>
                           <span className="ml-auto text-muted-foreground">{issue.status}</span>
                        </Link>
                     </li>
                  ))}
               </ul>
            )}
         </section>
      </div>
   );
}
