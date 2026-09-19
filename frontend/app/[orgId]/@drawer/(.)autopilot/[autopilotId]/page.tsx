'use client';

import { useParams } from 'next/navigation';
import { Suspense } from 'react';

import AutopilotDetail from '@/components/common/autopilots/autopilot-detail';
import DetailDrawerShell from '@/components/layout/detail-drawer-shell';
import AutopilotDetailHeader from '@/components/layout/headers/autopilots/detail-header';

export default function AutopilotDrawerPage() {
   const { autopilotId } = useParams<{ orgId: string; autopilotId: string }>();

   return (
      <DetailDrawerShell header={<AutopilotDetailHeader autopilotId={autopilotId} />}>
         <Suspense fallback={null}>
            <AutopilotDetail autopilotId={autopilotId} />
         </Suspense>
      </DetailDrawerShell>
   );
}
