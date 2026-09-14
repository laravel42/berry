import Reviews from '@/components/common/reviews/reviews';
import MainLayout from '@/components/layout/main-layout';

export default async function ReviewOverviewPage({
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
            section="overview"
            listTab={list === 'created' ? 'created' : 'for-you'}
         />
      </MainLayout>
   );
}
