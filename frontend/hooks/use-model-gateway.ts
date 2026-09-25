'use client';

import { fetchModelGatewayAvailable } from '@/lib/auth';
import { useEffect, useState } from 'react';

/**
 * Whether agents run on Berry tiers through a model gateway (ADR-0017).
 *
 * Null while it loads, so a screen can hold its model controls rather than
 * flash the wrong ones. Each caller asks for itself: `/api/v1/config` is
 * cheap, and a request shared across mounts could hand a new screen the
 * answer to one asked before — the wrong controls after a deployment changes.
 */
export function useModelGateway(): boolean | null {
   const [available, setAvailable] = useState<boolean | null>(null);

   useEffect(() => {
      let alive = true;
      void fetchModelGatewayAvailable().then((value) => {
         if (alive) setAvailable(value);
      });
      return () => {
         alive = false;
      };
   }, []);

   return available;
}
