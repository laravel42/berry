import Reviews from '@/components/common/reviews/reviews';
import MainLayout from '@/components/layout/main-layout';

export default async function ReviewPreviewPage({
   params,
   searchParams,
}: {
   params: Promise<{ reviewId: string }>;
   searchParams: Promise<{ list?: string }>;
}) {
   const { reviewId } = await params;
   const { list } = await searchParams;
   return (
      <MainLayout>
         <Reviews
            selectedReviewId={reviewId}
            section="preview"
            listTab={list === 'created' ? 'created' : 'for-you'}
         />
      </MainLayout>
   );
}
