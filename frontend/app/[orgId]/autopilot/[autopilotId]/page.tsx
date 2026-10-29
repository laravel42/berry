import AutopilotEditor from '@/components/common/autopilots/autopilot-editor';
import MainLayout from '@/components/layout/main-layout';

interface Props {
   params: Promise<{ orgId: string; autopilotId: string }>;
}

/** Links from elsewhere (inbox, run history) still land here; same editor. */
export default async function AutopilotPage({ params }: Props) {
   const { autopilotId } = await params;
   return (
      <MainLayout>
         <AutopilotEditor autopilotId={autopilotId} />
      </MainLayout>
   );
}
