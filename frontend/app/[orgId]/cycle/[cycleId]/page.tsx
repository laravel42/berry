import MainLayout from '@/components/layout/main-layout';
import CycleDetail from '@/components/common/cycles/cycle-detail';

export default async function CycleDetailPage({
   params,
}: {
   params: Promise<{ cycleId: string }>;
}) {
   const { cycleId } = await params;
   return (
      <MainLayout>
         <CycleDetail cycleId={cycleId} />
      </MainLayout>
   );
}
