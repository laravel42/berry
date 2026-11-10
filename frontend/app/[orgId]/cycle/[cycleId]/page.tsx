import MainLayout from '@/components/layout/main-layout';
import CycleDetail from '@/components/common/cycles/cycle-detail';

/** A direct link to a cycle: the same view as the drawer, as the page. */
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
