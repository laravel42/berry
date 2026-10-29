'use client';

import { useParams } from 'next/navigation';

import AutopilotEditor from '@/components/common/autopilots/autopilot-editor';
import DetailDrawerShell from '@/components/layout/detail-drawer-shell';

/** The editor draws its own breadcrumb bar, so the drawer adds no header. */
export default function AutopilotDrawerPage() {
   const { autopilotId } = useParams<{ orgId: string; autopilotId: string }>();

   return (
      <DetailDrawerShell>
         <AutopilotEditor autopilotId={autopilotId} />
      </DetailDrawerShell>
   );
}
