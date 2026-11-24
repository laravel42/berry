import { KnowledgeBase } from '@/components/common/knowledge/knowledge';
import MainLayout from '@/components/layout/main-layout';

export default function KnowledgePage() {
   return (
      <MainLayout>
         <KnowledgeBase pageId={null} />
      </MainLayout>
   );
}
