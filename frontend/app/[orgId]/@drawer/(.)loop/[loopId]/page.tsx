'use client';

import { useParams } from 'next/navigation';
import { Suspense } from 'react';

import AutopilotDetail from '@/components/common/autopilots/autopilot-detail';
import DetailDrawerShell from '@/components/layout/detail-drawer-shell';
import AutopilotDetailHeader from '@/components/layout/headers/autopilots/detail-header';

export default function LoopDrawerPage() {
   const { loopId } = useParams<{ orgId: string; loopId: string }>();

   return (
      <DetailDrawerShell header={<AutopilotDetailHeader autopilotId={loopId} />}>
         <Suspense fallback={null}>
            <AutopilotDetail autopilotId={loopId} />
         </Suspense>
      </DetailDrawerShell>
   );
}
