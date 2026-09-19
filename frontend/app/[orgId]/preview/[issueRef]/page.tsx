import { SitePreviewPage } from '@/components/common/issues/details/site-preview-page';
import MainLayout from '@/components/layout/main-layout';

/** A task's built site, full size, in its own "Preview" tab. */
export default function PreviewPage() {
   return (
      <MainLayout>
         <SitePreviewPage />
      </MainLayout>
   );
}
