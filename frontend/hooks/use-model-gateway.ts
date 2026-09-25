'use client';

import { fetchModelGatewayAvailable } from '@/lib/auth';
import { useEffect, useState } from 'react';

/**
 * Whether agents run on Berry tiers through a model gateway (ADR-0017).
 *
 * Null while it loads, so a screen can hold its model controls rather than
 * flash the wrong ones. Components asking at once share one request; it is not
 * kept after it settles, because `/api/v1/config` is cheap and a stale answer
 * would show the wrong controls after a deployment changes.
 */
let inFlight: Promise<boolean> | null = null;

export function useModelGateway(): boolean | null {
   const [available, setAvailable] = useState<boolean | null>(null);

   useEffect(() => {
      let alive = true;
      const request = (inFlight ??= fetchModelGatewayAvailable().finally(() => {
         inFlight = null;
      }));
      void request.then((value) => {
         if (alive) setAvailable(value);
      });
      return () => {
         alive = false;
      };
   }, []);

   return available;
}
