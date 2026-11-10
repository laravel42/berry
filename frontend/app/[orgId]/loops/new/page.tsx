import { Suspense } from 'react';

import NewLoop from '@/components/common/loops/new-loop';

/** A template or project arrives as a query parameter, which needs a Suspense boundary. */
export default function NewLoopPage() {
   return (
      <Suspense fallback={null}>
         <NewLoop />
      </Suspense>
   );
}
