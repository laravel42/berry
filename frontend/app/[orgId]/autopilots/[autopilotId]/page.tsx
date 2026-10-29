import AutopilotEditor from '@/components/common/autopilots/autopilot-editor';
import MainLayout from '@/components/layout/main-layout';

interface Props {
   params: Promise<{ orgId: string; autopilotId: string }>;
}

/** The editor in the content panel, opened from the Autopilots list. */
export default async function AutopilotEditorPage({ params }: Props) {
   const { autopilotId } = await params;
   return (
      <MainLayout>
         <AutopilotEditor autopilotId={autopilotId} />
      </MainLayout>
   );
}
