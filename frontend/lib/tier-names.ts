'use client';

import { TIER_NAMES, type Tier } from '@/lib/agents';
import { getTierModels, type TierNames } from '@/lib/runtimes';
import { useEffect, useState } from 'react';

const listeners = new Set<(names: TierNames) => void>();
let current: TierNames = { ...TIER_NAMES };
let loaded: Promise<TierNames> | null = null;

/** The names last read for this workspace. Product names until the first read. */
export function tierNamesNow(): TierNames {
   return current;
}

export function publishTierNames(names: TierNames): void {
   current = names;
   loaded = Promise.resolve(names);
   for (const listener of listeners) listener(names);
}

function ensureTierNames(): Promise<TierNames> {
   if (!loaded) {
      loaded = getTierModels()
         .then((stored) => {
            publishTierNames(stored.names);
            return stored.names;
         })
         .catch(() => current);
   }
   return loaded;
}

/** Display names for the five tiers, including a workspace's renames. */
export function useTierNames(): TierNames {
   const [names, setNames] = useState(current);
   useEffect(() => {
      const listener = (next: TierNames) => setNames(next);
      listeners.add(listener);
      void ensureTierNames().then(listener);
      return () => {
         listeners.delete(listener);
      };
   }, []);
   return names;
}

export function tierLabel(names: TierNames, tier: Tier): string {
   return names[tier];
}
