'use client';

import { useParams } from 'next/navigation';

import CycleDetail from '@/components/common/cycles/cycle-detail';
import DetailDrawerShell from '@/components/layout/detail-drawer-shell';

/** Soft-nav into a cycle (from the Cycles page) opens it over the list. */
export default function CycleDrawerPage() {
   const { cycleId } = useParams<{ orgId: string; cycleId: string }>();

   return (
      <DetailDrawerShell>
         <CycleDetail cycleId={cycleId} />
      </DetailDrawerShell>
   );
}
