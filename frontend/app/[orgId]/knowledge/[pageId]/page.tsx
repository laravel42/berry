import { KnowledgeBase } from '@/components/common/knowledge/knowledge';
import MainLayout from '@/components/layout/main-layout';

interface KnowledgePageProps {
   params: Promise<{ pageId: string }>;
}

export default async function KnowledgeBasePage({ params }: KnowledgePageProps) {
   const { pageId } = await params;
   return (
      <MainLayout>
         <KnowledgeBase pageId={pageId} />
      </MainLayout>
   );
}
