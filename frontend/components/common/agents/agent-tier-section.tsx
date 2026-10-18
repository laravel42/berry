'use client';

import { Check } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';
import { gatewayPin, isTier, MAIN_TIERS, type Agent, type Tier } from '@/lib/agents';
import { useTierNames } from '@/lib/tier-names';
import { cn } from '@/lib/utils';

/** The list's order: the paid tiers, best first. */
export const TIER_ORDER = MAIN_TIERS;

/**
 * Each tier's card in its own colour, the one its chip uses (`TIER_STYLE`): a
 * light tint while it waits, a solid border and a deeper tint when chosen.
 * Written out whole so the class names are in the source.
 */
const TIER_CARD: Record<Tier, { idle: string; chosen: string; check: string }> = {
   berry_max: {
      idle: 'border-primary/30 bg-primary/5 enabled:hover:bg-primary/10',
      chosen: 'border-primary bg-primary/15',
      check: 'text-primary-text',
   },
   berry_xhigh: {
      idle: 'border-iris/30 bg-iris/5 enabled:hover:bg-iris/10',
      chosen: 'border-iris bg-iris/15',
      check: 'text-iris',
   },
   berry_high: {
      idle: 'border-review-pending/30 bg-review-pending/5 enabled:hover:bg-review-pending/10',
      chosen: 'border-review-pending bg-review-pending/15',
      check: 'text-review-pending',
   },
   berry_mid: {
      idle: 'border-status-info/30 bg-status-info/5 enabled:hover:bg-status-info/10',
      chosen: 'border-status-info bg-status-info/15',
      check: 'text-status-info',
   },
   berry_low: {
      idle: 'border-status-success/30 bg-status-success/5 enabled:hover:bg-status-success/10',
      chosen: 'border-status-success bg-status-success/15',
      check: 'text-status-success',
   },
};

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
               'relative flex min-w-0 items-center justify-between gap-2 rounded-md border px-4 py-3 text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-default',
               selected ? TIER_CARD[name].chosen : TIER_CARD[name].idle
            )}
         >
            <span className="truncate">{names[name]}</span>
            {selected ? (
               <Check aria-hidden className={cn('size-4 shrink-0', TIER_CARD[name].check)} />
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

         <div role="radiogroup" aria-label={t('title')} className="grid grid-cols-5 gap-2">
            {TIER_ORDER.map(option)}
         </div>

         {pinned && pinnedModel ? (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
               <span>{t('pinned', { model: nameOf(pinnedModel) })}</span>
               {disabled ? null : (
                  <Button variant="secondary" size="xs" onClick={onUnpin}>
                     {t('useTier')}
                  </Button>
               )}
            </div>
         ) : null}
      </section>
   );
}
