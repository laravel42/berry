'use client';

import { Check } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';

import { TierChip } from '@/components/common/agents/tier-chip';
import { Button } from '@/components/ui/button';
import {
   gatewayPin,
   isTier,
   getModelTiers,
   MAIN_TIERS,
   type Agent,
   type ModelTiers,
   type RankedModel,
   type Tier,
} from '@/lib/agents';
import {
   aiRuntimeModelsFrom,
   connectedAiRuntimes,
   EMPTY_AGENT_TIERS,
   getTierModels,
   type RuntimeAgentTierPlacement,
} from '@/lib/runtimes';
import { cn } from '@/lib/utils';

/** The list's order: the three tiers, best first. */
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
      check: 'text-primary',
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

type Leaderboard =
   { status: 'loading' } | { status: 'ready'; data: ModelTiers } | { status: 'unavailable' };

/** A model's name without Kilo's vendor prefix and price marker: "Anthropic: Claude Opus 5 ($$$$)" → "Claude Opus 5". */
function modelName(name: string): string {
   return name.replace(/\s*\(\$+\)\s*$/, '').replace(/^[^:]+:\s*/, '');
}

/**
 * Which Berry tier an agent runs on (ADR-0017), for a deployment whose models
 * go through the gateway: three large choices, each only the tier's name and
 * the models it runs today, best first. Choosing the role's own tier stores
 * none, so the agent follows its role. Every change is a draft the settings
 * tab saves.
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
   const [board, setBoard] = useState<Leaderboard>({ status: 'loading' });
   const [subscriptions, setSubscriptions] = useState<string[]>([]);
   const [placedModels, setPlacedModels] = useState<RuntimeAgentTierPlacement>(EMPTY_AGENT_TIERS);
   const [modelNames, setModelNames] = useState<Map<string, string>>(new Map());

   const recommended = roleDefaultTier(agent);
   const effective = tier ?? recommended;

   useEffect(() => {
      let alive = true;
      getModelTiers().then(
         (data) => {
            if (alive) setBoard(data.stale ? { status: 'unavailable' } : { status: 'ready', data });
         },
         () => {
            if (alive) setBoard({ status: 'unavailable' });
         }
      );
      return () => {
         alive = false;
      };
   }, []);

   useEffect(() => {
      let alive = true;
      void Promise.all([
         connectedAiRuntimes(),
         getTierModels().catch(() => ({
            source: 'unset' as const,
            tiers: EMPTY_AGENT_TIERS,
         })),
      ]).then(([runtimes, tiers]) => {
         if (!alive) return;
         setSubscriptions(runtimes.map((runtime) => runtime.name));
         const names = new Map<string, string>();
         for (const runtime of runtimes) {
            for (const model of aiRuntimeModelsFrom(runtime)) {
               names.set(`${runtime.id}/${model.id}`, model.name);
            }
         }
         setModelNames(names);
         setPlacedModels(tiers.tiers);
      });
      return () => {
         alive = false;
      };
   }, []);

   const onSubscription = subscriptions.length > 0;

   const data = board.status === 'ready' ? board.data : null;
   const modelsOf = (name: Tier): RankedModel[] =>
      data?.tiers.find((entry) => entry.tier === name)?.models ?? [];
   const nameOf = (id: string): string => {
      for (const entry of data?.tiers ?? []) {
         const found = entry.models.find((candidate) => candidate.id === id);
         if (found) return modelName(found.name);
      }
      return id;
   };

   const choose = (next: Tier) => {
      if (disabled) return;
      onTierChange(next === recommended ? null : next);
   };

   const option = (name: Tier) => {
      const models = modelsOf(name);
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
               'relative flex min-w-0 flex-col items-start gap-2 rounded-md border px-4 py-3 text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-default',
               selected ? TIER_CARD[name].chosen : TIER_CARD[name].idle
            )}
         >
            <span className="flex w-full items-center justify-between gap-2">
               <TierChip tier={name} className="px-2 py-1" />
               {selected ? (
                  <Check aria-hidden className={cn('size-4 shrink-0', TIER_CARD[name].check)} />
               ) : null}
            </span>
            {data && models.length === 0 && !onSubscription ? (
               <span className="text-muted-foreground">{t('noModel')}</span>
            ) : null}
            {models.length > 0 && !onSubscription ? (
               <span className="flex w-full min-w-0 flex-col text-muted-foreground">
                  {models.map((entry) => (
                     <span key={entry.id} className="truncate" title={entry.id}>
                        {modelName(entry.name)}
                     </span>
                  ))}
               </span>
            ) : null}
            {onSubscription && placedModels[name].length > 0 ? (
               <span className="flex w-full min-w-0 flex-col text-muted-foreground">
                  {placedModels[name].map((id) => (
                     <span key={id} className="truncate" title={id}>
                        {modelNames.get(id) ?? id}
                     </span>
                  ))}
               </span>
            ) : null}
         </button>
      );
   };

   const pinnedModel = gatewayPin({ modelName: model });
   const pinned = pinnedModel !== null;

   return (
      <section className="flex flex-col gap-3">
         {bare && board.status !== 'unavailable' ? null : (
            <div className="flex flex-wrap items-baseline gap-2">
               {bare ? null : <h3 className="font-medium">{t('title')}</h3>}
               {board.status === 'unavailable' ? (
                  <p className="text-muted-foreground">{t('leaderboardUnavailable')}</p>
               ) : null}
            </div>
         )}

         {onSubscription ? (
            <p className="text-muted-foreground">
               {t('subscription', {
                  runtimes: new Intl.ListFormat('en', { type: 'conjunction' }).format(
                     subscriptions
                  ),
               })}
            </p>
         ) : null}

         <div role="radiogroup" aria-label={t('title')} className="grid gap-2 sm:grid-cols-3">
            {TIER_ORDER.map(option)}
         </div>

         {/* An old Bedrock pair is ignored under the gateway, so only a gateway pin is shown. */}
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
