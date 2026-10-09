'use client';

import { ArrowDown, ArrowUp, Plus, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';

import { TierChip } from '@/components/common/agents/tier-chip';
import { Button } from '@/components/ui/button';
import {
   Command,
   CommandEmpty,
   CommandGroup,
   CommandInput,
   CommandItem,
   CommandList,
} from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
   getModelTiers,
   getTierCandidates,
   MAIN_TIERS,
   TIER_PLACES,
   updateTierPlacement,
   type ModelTiers,
   type Tier,
   type TierCandidate,
   type TierCandidates,
   type TierPlacement,
} from '@/lib/agents';
import {
   aiRuntimeModelsFrom,
   connectedAiRuntimes,
   EMPTY_AGENT_TIERS,
   getTierModels,
   saveTierModels,
   type AiRuntimeDefinition,
   type RuntimeAgentTierPlacement,
} from '@/lib/runtimes';
import { useSessionStore } from '@/store/session-store';
import { useModelGateway } from '@/hooks/use-model-gateway';
import { SettingsCard, SettingsSection, SettingsShell } from './shared';
import { useSettingsResource } from './use-settings-resource';

interface TiersData {
   tiers: ModelTiers;
   candidates: TierCandidates;
}

const EMPTY: TierPlacement = { berry_max: [], berry_mid: [], berry_low: [] };

/** "Anthropic: Claude Opus 5 ($$$$)" → "Claude Opus 5". */
function modelName(name: string): string {
   return name.replace(/\s*\(\$+\)\s*$/, '').replace(/^[^:]+:\s*/, '');
}

function usd(value: number): string {
   return value >= 0.01 ? `$${value.toFixed(3)}` : `$${value.toFixed(4)}`;
}

/**
 * Settings → AI: which models each Berry tier runs in this workspace
 * (ADR-0017).
 *
 * The models used to be placed in the server's environment, so changing them
 * meant a restart. Each tier is an order, first choice first: a task starts on
 * the first model and moves down only when its work is rejected, and the
 * leaderboard fills the places a list leaves. The cost per step is shown
 * because the price per token misleads in an agent loop: every step re-sends
 * the conversation, and a model without a cache price pays its full input
 * price on all of it.
 *
 * Owners and admins edit; the server refuses anyone else.
 */
function listed(names: string[]): string {
   return new Intl.ListFormat('en', { type: 'conjunction' }).format(names);
}

export default function ModelTiersSettings() {
   const t = useTranslations('workspaceAdmin.modelTiers');
   const gateway = useModelGateway();
   const [subscriptions, setSubscriptions] = useState<AiRuntimeDefinition[] | null>(null);
   useEffect(() => {
      let alive = true;
      void connectedAiRuntimes().then((runtimes) => {
         if (alive) setSubscriptions(runtimes);
      });
      return () => {
         alive = false;
      };
   }, []);
   const usingSubscription = (subscriptions?.length ?? 0) > 0;
   return (
      <SettingsShell
         title={t('title')}
         description={
            usingSubscription
               ? t('subscriptionDescription', {
                    runtimes: listed((subscriptions ?? []).map((runtime) => runtime.name)),
                 })
               : t('description')
         }
      >
         {subscriptions === null || gateway === null ? (
            <p className="text-muted-foreground">{t('loading')}</p>
         ) : usingSubscription ? (
            <SubscriptionRoster runtimes={subscriptions} />
         ) : gateway === true ? (
            <TierPlacementEditor />
         ) : (
            <SettingsCard>
               <p className="text-muted-foreground">{t('gatewayOff')}</p>
            </SettingsCard>
         )}
      </SettingsShell>
   );
}

interface TierModelChoice {
   key: string;
   name: string;
   runtimeName: string;
}

function tierModelChoices(runtimes: AiRuntimeDefinition[]): TierModelChoice[] {
   const choices: TierModelChoice[] = [];
   const seen = new Set<string>();
   for (const runtime of runtimes) {
      for (const model of aiRuntimeModelsFrom(runtime)) {
         const key = `${runtime.id}/${model.id}`;
         if (seen.has(key)) continue;
         seen.add(key);
         choices.push({ key, name: model.name, runtimeName: runtime.name });
      }
   }
   return choices;
}

function SubscriptionRoster({ runtimes }: { runtimes: AiRuntimeDefinition[] }) {
   const t = useTranslations('workspaceAdmin.modelTiers');
   const role = useSessionStore((state) => state.workspace?.role);
   const canEdit = role === 'owner' || role === 'admin';
   const choices = useMemo(() => tierModelChoices(runtimes), [runtimes]);
   const byKey = useMemo(() => new Map(choices.map((choice) => [choice.key, choice])), [choices]);
   const [saved, setSaved] = useState<RuntimeAgentTierPlacement>(EMPTY_AGENT_TIERS);
   const [source, setSource] = useState<'workspace' | 'unset'>('unset');
   const [draft, setDraft] = useState<RuntimeAgentTierPlacement | null>(null);
   const [loading, setLoading] = useState(true);
   const [saving, setSaving] = useState(false);
   const placement = draft ?? saved;
   const dirty = draft !== null && JSON.stringify(draft) !== JSON.stringify(saved);

   useEffect(() => {
      let alive = true;
      void getTierModels().then(
         (stored) => {
            if (!alive) return;
            setSaved(stored.tiers);
            setSource(stored.source);
            setLoading(false);
         },
         () => {
            if (alive) setLoading(false);
         }
      );
      return () => {
         alive = false;
      };
   }, []);

   const edit = (tier: Tier, next: string[]) => setDraft({ ...placement, [tier]: next });
   const move = (tier: Tier, index: number, by: number) => {
      const list = [...placement[tier]];
      const [item] = list.splice(index, 1);
      if (item === undefined) return;
      list.splice(index + by, 0, item);
      edit(tier, list);
   };
   const save = async (next: RuntimeAgentTierPlacement | null) => {
      setSaving(true);
      try {
         const stored = await saveTierModels(next);
         setSaved(stored.tiers);
         setSource(stored.source);
         setDraft(null);
         toast.success(next === null ? t('agentsCleared') : t('saved'));
      } catch (cause) {
         toast.error(cause instanceof Error ? cause.message : t('saveFailed'));
      } finally {
         setSaving(false);
      }
   };

   const card = (tier: Tier) => {
      const list = placement[tier];
      return (
         <div key={tier} className="flex min-w-0 flex-col gap-2 px-4 py-3">
            <div className="flex flex-wrap items-center gap-2">
               <TierChip tier={tier} className="px-2 py-1" />
               {canEdit && list.length < TIER_PLACES ? (
                  <AddRuntimeModel
                     choices={choices.filter((choice) => !list.includes(choice.key))}
                     disabled={saving}
                     onAdd={(key) => edit(tier, [...list, key])}
                  />
               ) : null}
            </div>
            {list.length > 0 ? (
               <ol className="flex flex-col">
                  {list.map((key, index) => {
                     const choice = byKey.get(key);
                     return (
                        <li key={key} className="flex min-w-0 items-center gap-2 py-1.5">
                           <span className="w-4 shrink-0 text-right text-muted-foreground tabular-nums">
                              {index + 1}
                           </span>
                           <span className="min-w-0 flex-1">
                              <span className="block truncate">{choice?.name ?? key}</span>
                              {choice ? (
                                 <span className="block truncate text-muted-foreground">
                                    {choice.runtimeName}
                                 </span>
                              ) : null}
                           </span>
                           {canEdit ? (
                              <span className="flex shrink-0 items-center">
                                 <Button
                                    variant="ghost"
                                    size="xxs"
                                    aria-label={t('moveUp')}
                                    disabled={index === 0 || saving}
                                    onClick={() => move(tier, index, -1)}
                                 >
                                    <ArrowUp className="size-3.5" />
                                 </Button>
                                 <Button
                                    variant="ghost"
                                    size="xxs"
                                    aria-label={t('moveDown')}
                                    disabled={index === list.length - 1 || saving}
                                    onClick={() => move(tier, index, 1)}
                                 >
                                    <ArrowDown className="size-3.5" />
                                 </Button>
                                 <Button
                                    variant="ghost"
                                    size="xxs"
                                    aria-label={t('remove')}
                                    disabled={saving}
                                    onClick={() =>
                                       edit(
                                          tier,
                                          list.filter((other) => other !== key)
                                       )
                                    }
                                 >
                                    <X className="size-3.5" />
                                 </Button>
                              </span>
                           ) : null}
                        </li>
                     );
                  })}
               </ol>
            ) : null}
         </div>
      );
   };

   return (
      <SettingsSection
         title={t('section')}
         description={t('subscriptionDescription', {
            runtimes: listed(runtimes.map((runtime) => runtime.name)),
         })}
         action={
            canEdit ? (
               <div className="flex items-center gap-2">
                  {dirty ? (
                     <Button
                        variant="ghost"
                        size="sm"
                        disabled={saving}
                        onClick={() => setDraft(null)}
                     >
                        {t('discard')}
                     </Button>
                  ) : null}
                  {!dirty && source === 'workspace' ? (
                     <Button
                        variant="secondary"
                        size="sm"
                        disabled={saving}
                        onClick={() => void save(null)}
                     >
                        {t('reset')}
                     </Button>
                  ) : null}
                  <Button
                     size="sm"
                     disabled={!dirty || saving}
                     onClick={() => void save(placement)}
                  >
                     {saving ? t('saving') : t('save')}
                  </Button>
               </div>
            ) : null
         }
      >
         {loading ? <p className="text-muted-foreground">{t('loading')}</p> : null}
         <SettingsCard>{MAIN_TIERS.map(card)}</SettingsCard>
      </SettingsSection>
   );
}

function AddRuntimeModel({
   choices,
   disabled,
   onAdd,
}: {
   choices: TierModelChoice[];
   disabled: boolean;
   onAdd: (key: string) => void;
}) {
   const t = useTranslations('workspaceAdmin.modelTiers');
   const [open, setOpen] = useState(false);
   return (
      <Popover open={open} onOpenChange={setOpen}>
         <PopoverTrigger asChild>
            <Button
               variant="ghost"
               size="xxs"
               className="ml-auto"
               disabled={disabled || choices.length === 0}
            >
               <Plus className="size-3.5" />
               {t('add')}
            </Button>
         </PopoverTrigger>
         <PopoverContent align="end" className="w-80 p-0">
            <Command>
               <CommandInput placeholder={t('search')} />
               <CommandList className="max-h-80">
                  <CommandEmpty>{t('noMatch')}</CommandEmpty>
                  <CommandGroup>
                     {choices.map((choice) => (
                        <CommandItem
                           key={choice.key}
                           value={`${choice.name} ${choice.runtimeName} ${choice.key}`}
                           onSelect={() => {
                              onAdd(choice.key);
                              setOpen(false);
                           }}
                        >
                           <span className="min-w-0 flex-1">
                              <span className="block truncate">{choice.name}</span>
                              <span className="block truncate text-muted-foreground">
                                 {choice.runtimeName}
                              </span>
                           </span>
                        </CommandItem>
                     ))}
                  </CommandGroup>
               </CommandList>
            </Command>
         </PopoverContent>
      </Popover>
   );
}

function TierPlacementEditor() {
   const t = useTranslations('workspaceAdmin.modelTiers');
   const role = useSessionStore((state) => state.workspace?.role);
   const canEdit = role === 'owner' || role === 'admin';
   const data = useSettingsResource<TiersData>(async () => {
      const [tiers, candidates] = await Promise.all([getModelTiers(), getTierCandidates()]);
      return { tiers, candidates };
   });
   const [draft, setDraft] = useState<TierPlacement | null>(null);
   const [saving, setSaving] = useState(false);

   const saved = data.value?.tiers.placement?.tiers ?? EMPTY;
   const source = data.value?.tiers.placement?.source ?? 'deployment';
   const placement = draft ?? saved;
   const dirty = draft !== null && JSON.stringify(draft) !== JSON.stringify(saved);
   const byId = useMemo(
      () => new Map((data.value?.candidates.models ?? []).map((model) => [model.id, model])),
      [data.value]
   );
   const placed = new Set(MAIN_TIERS.flatMap((tier) => placement[tier]));

   const edit = (tier: Tier, next: string[]) => setDraft({ ...placement, [tier]: next });
   const move = (tier: Tier, index: number, by: number) => {
      const list = [...placement[tier]];
      const [item] = list.splice(index, 1);
      if (item === undefined) return;
      list.splice(index + by, 0, item);
      edit(tier, list);
   };

   const save = async (next: TierPlacement | null) => {
      if (!data.value) return;
      setSaving(true);
      try {
         const tiers = await updateTierPlacement(next);
         data.set({ ...data.value, tiers });
         setDraft(null);
         toast.success(next === null ? t('resetDone') : t('saved'));
      } catch (cause) {
         toast.error(cause instanceof Error ? cause.message : t('saveFailed'));
      } finally {
         setSaving(false);
      }
   };

   const mix = data.value?.candidates.mix ?? null;

   const meta = (model: TierCandidate | undefined) => {
      if (!model) return t('unlisted');
      const parts = [
         model.rating === null ? t('unrated') : t('rating', { rating: model.rating.toFixed(2) }),
         model.stepCostUsd === null
            ? t('prices', {
                 input: model.inputPricePerM.toFixed(2),
                 output: model.outputPricePerM.toFixed(2),
              })
            : t('perStep', { cost: usd(model.stepCostUsd) }),
      ];
      return parts.join(' · ');
   };

   const row = (tier: Tier, id: string, index: number, count: number) => {
      const model = byId.get(id);
      return (
         <li key={id} className="flex min-w-0 items-center gap-2 py-1.5">
            <span className="w-4 shrink-0 text-right text-muted-foreground tabular-nums">
               {index + 1}
            </span>
            <span className="min-w-0 flex-1">
               <span className="block truncate" title={id}>
                  {model ? modelName(model.name) : id}
               </span>
               <span className="block truncate text-muted-foreground">
                  {meta(model)}
                  {model && model.cacheReadPricePerM === null ? (
                     <span className="text-status-warning"> · {t('noCache')}</span>
                  ) : null}
               </span>
            </span>
            {canEdit ? (
               <span className="flex shrink-0 items-center">
                  <Button
                     variant="ghost"
                     size="xxs"
                     aria-label={t('moveUp')}
                     disabled={index === 0 || saving}
                     onClick={() => move(tier, index, -1)}
                  >
                     <ArrowUp className="size-3.5" />
                  </Button>
                  <Button
                     variant="ghost"
                     size="xxs"
                     aria-label={t('moveDown')}
                     disabled={index === count - 1 || saving}
                     onClick={() => move(tier, index, 1)}
                  >
                     <ArrowDown className="size-3.5" />
                  </Button>
                  <Button
                     variant="ghost"
                     size="xxs"
                     aria-label={t('remove')}
                     disabled={saving}
                     onClick={() =>
                        edit(
                           tier,
                           placement[tier].filter((other) => other !== id)
                        )
                     }
                  >
                     <X className="size-3.5" />
                  </Button>
               </span>
            ) : null}
         </li>
      );
   };

   const card = (tier: Tier) => {
      const list = placement[tier];
      const runsOn = data.value?.tiers.tiers.find((entry) => entry.tier === tier)?.models ?? [];
      return (
         <div key={tier} className="flex min-w-0 flex-col gap-2 px-4 py-3">
            <div className="flex flex-wrap items-center gap-2">
               <TierChip tier={tier} className="px-2 py-1" />
               <span className="text-muted-foreground">
                  {list.length === 0
                     ? t('leaderboardOnly')
                     : list.length < TIER_PLACES
                       ? t('partlyPlaced', { count: list.length, places: TIER_PLACES })
                       : null}
               </span>
               {canEdit && list.length < TIER_PLACES ? (
                  <AddModel
                     candidates={(data.value?.candidates.models ?? []).filter(
                        (model) => !placed.has(model.id)
                     )}
                     describe={meta}
                     disabled={saving}
                     onAdd={(id) => edit(tier, [...list, id])}
                  />
               ) : null}
            </div>
            {list.length > 0 ? (
               <ol className="flex flex-col">
                  {list.map((id, index) => row(tier, id, index, list.length))}
               </ol>
            ) : null}
            {!dirty && runsOn.length > 0 ? (
               <p className="text-muted-foreground">
                  {t('runsOn', {
                     models: runsOn.map((model) => modelName(model.name)).join(', '),
                  })}
               </p>
            ) : null}
         </div>
      );
   };

   return (
      <SettingsSection
         title={t('section')}
         description={data.error ?? undefined}
         action={
            canEdit && data.value ? (
               <div className="flex items-center gap-2">
                  {dirty ? (
                     <Button
                        variant="ghost"
                        size="sm"
                        disabled={saving}
                        onClick={() => setDraft(null)}
                     >
                        {t('discard')}
                     </Button>
                  ) : null}
                  {!dirty && source === 'workspace' ? (
                     <Button
                        variant="secondary"
                        size="sm"
                        disabled={saving}
                        onClick={() => void save(null)}
                     >
                        {t('reset')}
                     </Button>
                  ) : null}
                  <Button
                     size="sm"
                     disabled={!dirty || saving}
                     onClick={() => void save(placement)}
                  >
                     {saving ? t('saving') : t('save')}
                  </Button>
               </div>
            ) : null
         }
      >
         {data.loading ? <p className="text-muted-foreground">{t('loading')}</p> : null}
         {data.value ? (
            <>
               <p className="text-muted-foreground">
                  {source === 'workspace' ? t('sourceWorkspace') : t('sourceDeployment')}
                  {mix
                     ? ` ${t('mix', {
                          context: mix.contextTokens.toLocaleString('en-US'),
                          output: mix.outputTokens.toLocaleString('en-US'),
                          cached: Math.round(mix.cacheHitShare * 100),
                       })}`
                     : null}
               </p>
               <SettingsCard>{MAIN_TIERS.map(card)}</SettingsCard>
            </>
         ) : null}
      </SettingsSection>
   );
}

function AddModel({
   candidates,
   describe,
   disabled,
   onAdd,
}: {
   candidates: TierCandidate[];
   describe: (model: TierCandidate) => string;
   disabled: boolean;
   onAdd: (id: string) => void;
}) {
   const t = useTranslations('workspaceAdmin.modelTiers');
   const [open, setOpen] = useState(false);
   return (
      <Popover open={open} onOpenChange={setOpen}>
         <PopoverTrigger asChild>
            <Button variant="ghost" size="xxs" className="ml-auto" disabled={disabled}>
               <Plus className="size-3.5" />
               {t('add')}
            </Button>
         </PopoverTrigger>
         <PopoverContent align="end" className="w-96 p-0">
            <Command
               filter={(value, search) => {
                  const needle = search.trim().toLowerCase();
                  return needle === '' || value.toLowerCase().includes(needle) ? 1 : 0;
               }}
            >
               <CommandInput placeholder={t('search')} />
               <CommandList>
                  <CommandEmpty>{t('noMatch')}</CommandEmpty>
                  <CommandGroup>
                     {candidates.map((model) => (
                        <CommandItem
                           key={model.id}
                           value={`${model.name} ${model.id}`}
                           onSelect={() => {
                              onAdd(model.id);
                              setOpen(false);
                           }}
                        >
                           <span className="min-w-0 flex-1">
                              <span className="block truncate">{modelName(model.name)}</span>
                              <span className="block truncate text-muted-foreground">
                                 {describe(model)}
                                 {model.cacheReadPricePerM === null ? (
                                    <span className="text-status-warning"> · {t('noCache')}</span>
                                 ) : null}
                              </span>
                           </span>
                        </CommandItem>
                     ))}
                  </CommandGroup>
               </CommandList>
            </Command>
         </PopoverContent>
      </Popover>
   );
}
