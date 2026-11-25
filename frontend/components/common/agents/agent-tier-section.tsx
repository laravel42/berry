'use client';

import { Check } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';
import {
   gatewayPin,
   isTier,
   MAIN_TIERS,
   TIER_OPTION_STYLE,
   type Agent,
   type Tier,
} from '@/lib/agents';
import { useTierNames } from '@/lib/tier-names';
import { cn } from '@/lib/utils';

/** The list's order: the paid tiers, best first. */
export const TIER_ORDER = MAIN_TIERS;

/**
 * The tier an agent runs on when it names none, as the server resolves it
 * (its contract's, else its role's in the catalogue, else BerryLow); read
 * from the contract only when the server did not say.
 */
export function roleDefaultTier(agent: Pick<Agent, 'contract' | 'defaultTier'>): Tier {
   if (isTier(agent.defaultTier)) return agent.defaultTier;
   return agent.contract?.tier ?? 'berry_low';
}

interface AgentTierSectionProps {
   agent: Pick<Agent, 'contract' | 'defaultTier'>;
   /** Draft: the agent's own tier, or null to run on its role's. */
   tier: Tier | null;
   /** Draft pinned model; a gateway id (`vendor/model`) overrides the tier. */
   model: string | null;
   disabled?: boolean;
   onTierChange: (tier: Tier | null) => void;
   /** Clear the pinned model so the tier chooses again. */
   onUnpin: () => void;
   /** Leave out the section's own heading, when a form row already names it. */
   bare?: boolean;
}

/**
 * Which Berry tier an agent runs on: the paid tiers in one row, each only
 * its name. Choosing the role's own tier stores none, so the agent follows
 * its role. Every change is a draft the settings tab saves.
 */
export function AgentTierSection({
   agent,
   tier,
   model,
   disabled = false,
   onTierChange,
   onUnpin,
   bare = false,
}: AgentTierSectionProps) {
   const t = useTranslations('agentsChat.detail.tiers');

   const recommended = roleDefaultTier(agent);
   const effective = tier ?? recommended;

   const nameOf = (id: string): string => id;

   const names = useTierNames();

   const choose = (next: Tier) => {
      if (disabled) return;
      onTierChange(next === recommended ? null : next);
   };

   const option = (name: Tier) => {
      const selected = name === effective;
      return (
         <button
            key={name}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={disabled}
            onClick={() => choose(name)}
            className={cn(
               'relative flex h-(--field-h) min-w-0 items-center justify-between gap-2 rounded-pill border px-3 text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-default',
               selected ? TIER_OPTION_STYLE[name].chosen : TIER_OPTION_STYLE[name].idle
            )}
         >
            <span className="truncate">{names[name]}</span>
            {selected ? (
               <Check
                  aria-hidden
                  className={cn('size-4 shrink-0', TIER_OPTION_STYLE[name].check)}
               />
            ) : null}
         </button>
      );
   };

   const pinnedModel = gatewayPin({ modelName: model });
   const pinned = pinnedModel !== null;

   return (
      <section className="flex flex-col gap-3">
         {bare ? null : (
            <div className="flex flex-wrap items-baseline gap-2">
               <h3 className="font-medium">{t('title')}</h3>
            </div>
         )}

         <div
            role="radiogroup"
            aria-label={t('title')}
            className="grid grid-cols-5 gap-2 max-sm:grid-cols-1"
         >
            {TIER_ORDER.map(option)}
         </div>

         {pinned && pinnedModel ? (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
               <span>{t('pinned', { model: nameOf(pinnedModel) })}</span>
               {disabled ? null : (
                  <Button variant="secondary" size="sm" onClick={onUnpin}>
                     {t('useTier')}
                  </Button>
               )}
            </div>
         ) : null}
      </section>
   );
}
