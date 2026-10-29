import AutopilotEditor from '@/components/common/autopilots/autopilot-editor';
import { isTemplateKey } from '@/components/common/autopilots/templates';
import MainLayout from '@/components/layout/main-layout';

interface Props {
   searchParams: Promise<{ template?: string }>;
}

export default async function NewAutopilotPage({ searchParams }: Props) {
   const { template } = await searchParams;
   return (
      <MainLayout>
         <AutopilotEditor template={isTemplateKey(template) ? template : null} />
      </MainLayout>
   );
}
