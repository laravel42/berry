import { useEffect, useState } from 'react';

import { fetchVoiceAgentsAvailable } from '@/lib/auth';

/** Whether Connect can open a LiveKit voice room. Asked once per mount. */
export function useVoiceAgentsAvailable(): boolean {
   const [available, setAvailable] = useState(false);
   useEffect(() => {
      let cancelled = false;
      void fetchVoiceAgentsAvailable()
         .then((value) => {
            if (!cancelled) setAvailable(value);
         })
         .catch(() => {
            if (!cancelled) setAvailable(false);
         });
      return () => {
         cancelled = true;
      };
   }, []);
   return available;
}
