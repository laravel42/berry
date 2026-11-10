import AutopilotDetail from '@/components/common/autopilots/autopilot-detail';
import MainLayout from '@/components/layout/main-layout';
import { Suspense } from 'react';

interface Props {
   params: Promise<{ orgId: string; loopId: string }>;
}

export default async function LoopPage({ params }: Props) {
   const { loopId } = await params;
   return (
      <MainLayout>
         {/* The open tab is a query parameter, which Next requires to sit
             under a Suspense boundary. */}
         <Suspense fallback={null}>
            <AutopilotDetail autopilotId={loopId} />
         </Suspense>
      </MainLayout>
   );
}
