'use client';

import { BerryMark } from '@/components/brand/berry-mark';
import { planLook } from '@/components/common/plans/plan-status-badge';
import { usePlanStore } from '@/store/plan-store';
import { WORKSPACE_SLUG } from '@/lib/config';
import { ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';

/**
 * Plan page header: crumb (plans › mark + goal title). "Plans" goes back to
 * the Plans list. Status lives on the plan body, not here.
 */
export default function Header({ planId }: { planId: string }) {
   const record = usePlanStore((state) => state.records[planId]);
   const params = useParams<{ orgId?: string }>();
   const orgId = params?.orgId || WORKSPACE_SLUG;

   const look = record ? planLook(record) : null;
   const title =
      record?.plan?.goal.title ??
      record?.sourcePrompt?.replace(/\s+/g, ' ').trim() ??
      (record ? 'Plan' : 'Loading plan…');

   return (
      <div className="flex h-10 w-full items-center justify-between gap-4 border-b px-6 py-1.5">
         <div className="flex min-w-0 items-center gap-1.5">
            <Link href={`/${orgId}/plans`} className="text-muted-foreground hover:text-foreground">
               Plans
            </Link>
            <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
            <BerryMark
               size="sm"
               tone={look?.tone ?? 'neutral'}
               state={look?.state ?? 'hollow'}
               pulse={look?.pulse}
            />
            <span className="truncate font-medium">{title}</span>
         </div>
      </div>
   );
}
