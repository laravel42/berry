'use client';

import AgentSettingsPage from '@/components/common/settings/agent-settings-page';
import Header from '@/components/layout/headers/settings/header';
import MainLayout from '@/components/layout/main-layout';
import { useParams } from 'next/navigation';

// Read from the route on the client, as the runtime detail page does.
export default function Page() {
   const { agentId } = useParams<{ orgId: string; agentId: string }>();
   return (
      <MainLayout header={<Header />} headersNumber={1}>
         <AgentSettingsPage agentId={agentId} />
      </MainLayout>
   );
}
