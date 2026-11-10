import { Suspense } from 'react';

import Loops from '@/components/common/loops/loops';

/** `?project=` narrows the list, and query parameters need a Suspense boundary. */
export default function LoopsPage() {
   return (
      <Suspense fallback={null}>
         <Loops />
      </Suspense>
   );
}
