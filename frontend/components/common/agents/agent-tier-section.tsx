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
   modelPrice,
   tierShares,
   type Agent,
   type ModelTiers,
   type RankedModel,
   type Tier,
} from '@/lib/agents';
import { cn } from '@/lib/utils';

/** The list's order: Kilo's own routing first, then the three paid tiers, then free models. */
const TIER_ORDER = ['berry_auto', ...MAIN_TIERS, 'berry_free'] as const satisfies readonly Tier[];

/**
 * The models table's columns — share, model, rating, input and output price —
 * shared by the
 * header and every tier, so the columns line up down the whole list.
 */
const MODEL_COLUMNS = 'grid grid-cols-[2.5rem_minmax(0,1fr)_3.5rem_4rem_4rem] gap-x-3';

const priceOf = (perMillion: number | null | undefined) =>
   perMillion != null ? modelPrice(perMillion) : '—';

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

function percent(completion: number): string {
   return `${Math.round(completion * 100)}%`;
}

/** A model's name without Kilo's price marker ("($$$$)"): the table has price columns. */
function modelName(name: string): string {
   return name.replace(/\s*\(\$+\)\s*$/, '');
}

/**
 * A model's rating cell. A free model's rating is borrowed from its paid
 * twin and converted far outside the range the conversion was fitted on, so
 * one that rounds to 0% says nothing and is shown as no rating.
 */
function ratingOf(tier: Tier, completion: number | null): string {
   if (completion === null) return '—';
   if (tier === 'berry_free' && Math.round(completion * 100) === 0) return '—';
   return percent(completion);
}

/**
 * Which Berry tier an agent runs on (ADR-0017), for a deployment whose models
 * go through the gateway. Three outcomes to choose from, the role's own marked
 * Recommended; Auto leads the list and Free follows the three paid tiers. Each
 * tier lists the models it runs today and their share of its tasks. Every
 * change is a draft the settings tab saves.
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
      const shares = tierShares(models.length);
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
               'flex min-w-0 items-start gap-3 border-t px-3 py-2 text-left outline-none first:border-t-0 focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-default',
               selected ? 'bg-accent/60' : 'enabled:hover:bg-accent/30'
            )}
         >
            <span className="w-24 shrink-0">
               <TierChip tier={name} className="px-2 py-1" />
            </span>
            <span className="flex min-w-0 flex-1 flex-col">
               <span className="flex flex-wrap items-center gap-2">
                  <span className={cn(!selected && 'text-muted-foreground')}>
                     {t(`outcome.${name}`)}
                  </span>
                  {name === recommended ? (
                     <span className="rounded-full border border-border px-2 text-muted-foreground">
                        {t('recommended')}
                     </span>
                  ) : null}
                  {name === 'berry_free' ? (
                     <span className="text-status-warning">{t('freeTraining')}</span>
                  ) : null}
               </span>
               {data && models.length === 0 ? (
                  <span className="text-muted-foreground">{t('noModel')}</span>
               ) : null}
               {/* Every model the tier runs today, best first, with its share of
                   the tier's tasks. */}
               {models.length > 0 ? (
                  <span className="mt-1 flex flex-col tabular-nums text-muted-foreground">
                     {models.map((entry, index) => (
                        <span key={entry.id} className={MODEL_COLUMNS}>
                           <span className="text-right" title={t('shareHint')}>
                              <span className="sr-only">{t('columns.share')} </span>
                              {`${shares[index] ?? 0}%`}
                           </span>
                           <span className="min-w-0 truncate" title={entry.id}>
                              {modelName(entry.name)}
                           </span>
                           <span className="text-right">
                              <span className="sr-only">{t('columns.rating')} </span>
                              {ratingOf(name, entry.completion)}
                           </span>
                           <span className="text-right">
                              <span className="sr-only">{t('columns.priceIn')} </span>
                              {priceOf(entry.inputPricePerM)}
                           </span>
                           <span className="text-right">
                              <span className="sr-only">{t('columns.priceOut')} </span>
                              {priceOf(entry.outputPricePerM)}
                           </span>
                        </span>
                     ))}
                  </span>
               ) : null}
            </span>
            {/* Always takes its place, so the columns do not shift on the chosen row. */}
            <span className="size-4 shrink-0">
               {selected ? <Check aria-hidden className="size-4" /> : null}
            </span>
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

         <div
            role="radiogroup"
            aria-label={t('title')}
            className="flex flex-col overflow-hidden rounded-md border"
         >
            {/* Column labels for the models under each tier; the cells carry
                their own for assistive technology. */}
            {data ? (
               <div
                  aria-hidden
                  className="flex items-center gap-3 bg-muted/30 px-3 py-1.5 text-muted-foreground"
               >
                  <span className="w-24 shrink-0">{t('columns.tier')}</span>
                  <span className={cn(MODEL_COLUMNS, 'min-w-0 flex-1')}>
                     <span className="text-right">{t('columns.share')}</span>
                     <span>{t('columns.model')}</span>
                     <span
                        className="text-right"
                        title={
                           data.ratingScale
                              ? t('columns.ratingHint', { scale: data.ratingScale })
                              : undefined
                        }
                     >
                        {t('columns.rating')}
                     </span>
                     <span className="text-right" title={t('columns.priceHint')}>
                        {t('columns.priceIn')}
                     </span>
                     <span className="text-right" title={t('columns.priceHint')}>
                        {t('columns.priceOut')}
                     </span>
                  </span>
                  <span className="size-4 shrink-0" />
               </div>
            ) : null}
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
