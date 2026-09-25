'use client';

import { useEffect, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { AgentModelPicker } from '@/components/common/agents/agent-model-picker';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
   defaultFallback,
   isTier,
   getModelTiers,
   MAIN_TIERS,
   modelPrice,
   TIER_NAMES,
   type Agent,
   type ModelTiers,
   type RankedModel,
   type Tier,
} from '@/lib/agents';
import { cn } from '@/lib/utils';

const EXPERIMENT_TIERS = ['berry_free', 'berry_auto'] as const satisfies readonly Tier[];

/** The gateway provider; a pinned or fallback model is `kilo` + a `vendor/model` id. */
const GATEWAY_PROVIDER = 'kilo';

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
   /** Draft: its own fallback model id, or null for Berry's choice. */
   fallbackModel: string | null;
   /** Draft pinned model pair; a pinned gateway model overrides the tier. */
   provider: string | null;
   model: string | null;
   disabled?: boolean;
   onTierChange: (tier: Tier | null) => void;
   onFallbackChange: (model: string | null) => void;
   /** Clear the pinned model so the tier chooses again. */
   onUnpin: () => void;
}

type Leaderboard =
   { status: 'loading' } | { status: 'ready'; data: ModelTiers } | { status: 'unavailable' };

function percent(completion: number): string {
   return `${Math.round(completion * 100)}%`;
}

/**
 * Which Berry tier an agent runs on (ADR-0017), for a deployment whose models
 * go through the gateway. Three outcomes to choose from, the role's own marked
 * Recommended; Free and Auto sit behind Experiments. Every change is a draft
 * the settings tab saves.
 */
export function AgentTierSection({
   agent,
   tier,
   fallbackModel,
   provider,
   model,
   disabled = false,
   onTierChange,
   onFallbackChange,
   onUnpin,
}: AgentTierSectionProps) {
   const t = useTranslations('agentsChat.detail.tiers');
   const [board, setBoard] = useState<Leaderboard>({ status: 'loading' });
   const [changingFallback, setChangingFallback] = useState(false);

   const recommended = roleDefaultTier(agent);
   const effective = tier ?? recommended;
   const [experimentsOpen, setExperimentsOpen] = useState(
      () => !(MAIN_TIERS as readonly Tier[]).includes(effective)
   );

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

   const data = board.status === 'ready' ? board.data : null;
   const topOf = (name: Tier): RankedModel | null =>
      data?.tiers.find((entry) => entry.tier === name)?.models[0] ?? null;
   const nameOf = (id: string): string => {
      for (const entry of data?.tiers ?? []) {
         const found = entry.models.find((candidate) => candidate.id === id);
         if (found) return found.name;
      }
      return id;
   };

   const choose = (next: Tier) => {
      if (disabled) return;
      onTierChange(next === recommended ? null : next);
   };

   const option = (name: Tier) => {
      const top = topOf(name);
      const selected = name === effective;
      const facts = [
         top?.completion != null ? t('completion', { percent: percent(top.completion) }) : null,
         top?.blendedPricePerM != null
            ? t('price', { price: modelPrice(top.blendedPricePerM) })
            : null,
      ].filter((fact): fact is string => fact !== null);
      return (
         <button
            key={name}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={disabled}
            onClick={() => choose(name)}
            className={cn(
               'flex min-h-11 min-w-0 flex-col gap-1 rounded-lg border p-3 text-left outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-60',
               selected ? 'border-foreground bg-accent/50' : 'border-border hover:bg-accent/30'
            )}
         >
            <span className="flex flex-wrap items-center gap-2">
               <span className="font-medium">{TIER_NAMES[name]}</span>
               {name === recommended ? (
                  <span className="rounded-full border border-border px-2 text-muted-foreground">
                     {t('recommended')}
                  </span>
               ) : null}
            </span>
            <span className="text-muted-foreground">{t(`outcome.${name}`)}</span>
            {data ? (
               <>
                  <span className="truncate" title={top?.id}>
                     {top ? top.name : t('noModel')}
                  </span>
                  {facts.length > 0 ? (
                     <span className="tabular-nums text-muted-foreground">{facts.join(' · ')}</span>
                  ) : null}
               </>
            ) : null}
            {name === 'berry_free' ? (
               <span className="text-status-warning">{t('freeTraining')}</span>
            ) : null}
         </button>
      );
   };

   const berryFallback = data ? defaultFallback(data, effective) : null;
   const fallbackLine = fallbackModel
      ? t('fallback', { model: nameOf(fallbackModel) })
      : berryFallback
        ? t('fallbackBerry', { model: berryFallback.name })
        : t('fallbackBerryOnly');

   const pinnedModel = model?.trim() ? model.trim() : null;
   const pinned =
      pinnedModel !== null && (provider === GATEWAY_PROVIDER || pinnedModel.includes('/'));
   const legacy = pinnedModel !== null && !pinned;

   return (
      <section className="flex flex-col gap-3">
         <div className="flex flex-wrap items-baseline gap-2">
            <h3 className="font-medium">{t('title')}</h3>
            {board.status === 'unavailable' ? (
               <p className="text-muted-foreground">{t('leaderboardUnavailable')}</p>
            ) : null}
         </div>

         <div
            role="radiogroup"
            aria-label={t('title')}
            className="grid grid-cols-1 gap-2 md:grid-cols-3"
         >
            {MAIN_TIERS.map(option)}
         </div>

         <Collapsible open={experimentsOpen} onOpenChange={setExperimentsOpen}>
            <CollapsibleTrigger asChild>
               <Button variant="ghost" size="xs" className="w-fit text-muted-foreground">
                  <ChevronRight
                     className={cn('size-3.5 transition-transform', experimentsOpen && 'rotate-90')}
                  />
                  {t('experiments')}
               </Button>
            </CollapsibleTrigger>
            <CollapsibleContent>
               <div
                  role="radiogroup"
                  aria-label={t('experiments')}
                  className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-3"
               >
                  {EXPERIMENT_TIERS.map(option)}
               </div>
            </CollapsibleContent>
         </Collapsible>

         <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="tabular-nums">{fallbackLine}</span>
            {disabled ? null : (
               <>
                  <Button
                     variant="secondary"
                     size="xs"
                     aria-expanded={changingFallback}
                     onClick={() => setChangingFallback((open) => !open)}
                  >
                     {changingFallback ? t('fallbackDone') : t('fallbackChange')}
                  </Button>
                  {fallbackModel ? (
                     <Button variant="ghost" size="xs" onClick={() => onFallbackChange(null)}>
                        {t('fallbackReset')}
                     </Button>
                  ) : null}
               </>
            )}
         </div>

         {changingFallback && !disabled ? (
            <AgentModelPicker
               provider={fallbackModel ? GATEWAY_PROVIDER : null}
               model={fallbackModel}
               onChange={(_provider, next) => onFallbackChange(next)}
            />
         ) : null}

         {pinnedModel ? (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
               <span className={cn(legacy && 'text-muted-foreground')}>
                  {pinned
                     ? t('pinned', { model: nameOf(pinnedModel) })
                     : t('legacy', { model: pinnedModel })}
               </span>
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
