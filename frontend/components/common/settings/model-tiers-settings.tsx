'use client';

import { GripVertical, Plus, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import {
   useCallback,
   useEffect,
   useMemo,
   useRef,
   useState,
   type KeyboardEvent,
   type PointerEvent,
   type ReactNode,
} from 'react';

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
import { cn } from '@/lib/utils';
import { useSessionStore } from '@/store/session-store';
import { useModelGateway } from '@/hooks/use-model-gateway';
import { SaveIndicator } from './save-indicator';
import { SettingsCard, SettingsSection, SettingsShell } from './shared';
import type { SaveState } from './use-autosave';
import { useSettingsResource } from './use-settings-resource';

interface TiersData {
   tiers: ModelTiers;
   candidates: TierCandidates;
}

const EMPTY: TierPlacement = {
   berry_max: [],
   berry_xhigh: [],
   berry_high: [],
   berry_mid: [],
   berry_low: [],
};

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

/** Move one id from `from` to `to`. The original list is left unchanged. */
function moveItem(list: readonly string[], from: number, to: number): string[] {
   if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) {
      return [...list];
   }
   const next = [...list];
   const [item] = next.splice(from, 1);
   if (item === undefined) return [...list];
   next.splice(to, 0, item);
   return next;
}

function sameOrder(a: readonly string[], b: readonly string[]): boolean {
   return a.length === b.length && a.every((id, index) => id === b[index]);
}

function samePlacement(a: { [tier in Tier]: string[] }, b: { [tier in Tier]: string[] }): boolean {
   return MAIN_TIERS.every((tier) => sameOrder(a[tier], b[tier]));
}

/**
 * Writes one placement at a time, in the order the edits happened.
 *
 * A drag reports every row it crosses. Only the order at the end of the
 * gesture is committed, and a newer edit queued before this write starts
 * replaces it, so an intermediate order never lands on the server ahead of
 * the one the list is showing.
 */
function useQueuedSave<T, R>({
   run,
   apply,
}: {
   run: (next: T) => Promise<R>;
   apply: (result: R, sent: T) => void;
}) {
   const generation = useRef(0);
   const chain = useRef(Promise.resolve());
   const latest = useRef({ run, apply });
   latest.current = { run, apply };
   const last = useRef<T | undefined>(undefined);
   const [state, setState] = useState<SaveState>('idle');
   const [error, setError] = useState<string | null>(null);

   const commit = useCallback((next: T) => {
      const mine = ++generation.current;
      last.current = next;
      setState('saving');
      setError(null);
      chain.current = chain.current.then(async () => {
         if (generation.current !== mine) return;
         try {
            const result = await latest.current.run(next);
            if (generation.current !== mine) return;
            latest.current.apply(result, next);
            setState('saved');
         } catch (cause: unknown) {
            if (generation.current !== mine) return;
            setState('failed');
            setError(cause instanceof Error ? cause.message : null);
         }
      });
   }, []);

   const retry = useCallback(() => {
      if (last.current !== undefined) commit(last.current);
   }, [commit]);

   return { commit, retry, state, error };
}

/**
 * A tier's model order. The grip is the sort control.
 *
 * Pointer-driven rather than HTML5 drag-and-drop: this page sits in the
 * transformed shell, where `drop` does not reliably fire. Arrow keys on the
 * grip move one place, so the order stays reachable from the keyboard.
 */
function SortableModelList({
   ids,
   disabled,
   sortable,
   labelFor,
   onReorder,
   onCommit,
   children,
}: {
   ids: string[];
   disabled: boolean;
   sortable: boolean;
   labelFor: (id: string) => string;
   /** Live order while a grip is moving. Not yet saved. */
   onReorder: (next: string[]) => void;
   /** The order to save: a finished drag, or one keyboard step. */
   onCommit?: (next: string[]) => void;
   children: (id: string) => ReactNode;
}) {
   const t = useTranslations('workspaceAdmin.modelTiers');
   const listRef = useRef<HTMLOListElement>(null);
   const fromRef = useRef<number | null>(null);
   const overRef = useRef<number | null>(null);
   const orderRef = useRef(ids);
   const startRef = useRef<string[] | null>(null);
   const [dragIndex, setDragIndex] = useState<number | null>(null);

   const rowAt = (clientY: number): number | null => {
      const root = listRef.current;
      if (!root) return null;
      const rows = root.querySelectorAll<HTMLElement>('[data-model-row]');
      let closest: number | null = null;
      let best = Infinity;
      for (let index = 0; index < rows.length; index++) {
         const row = rows[index];
         if (!row) continue;
         const rect = row.getBoundingClientRect();
         const distance = Math.abs(clientY - (rect.top + rect.height / 2));
         if (distance < best) {
            best = distance;
            closest = index;
         }
      }
      return closest;
   };

   const onGripDown = (index: number) => (event: PointerEvent<HTMLButtonElement>) => {
      if (disabled || ids.length < 2) return;
      event.preventDefault();
      orderRef.current = ids;
      startRef.current = ids;
      fromRef.current = index;
      overRef.current = index;
      setDragIndex(index);
      try {
         event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
         // The pointer is not active. Move events on this grip still reorder.
      }
   };

   const onGripMove = (event: PointerEvent<HTMLButtonElement>) => {
      if (fromRef.current === null) return;
      const next = rowAt(event.clientY);
      if (next === null || next === overRef.current) return;
      const from = overRef.current ?? fromRef.current;
      orderRef.current = moveItem(orderRef.current, from, next);
      onReorder(orderRef.current);
      overRef.current = next;
      setDragIndex(next);
   };

   const endDrag = () => {
      const started = startRef.current;
      const finished = orderRef.current;
      fromRef.current = null;
      overRef.current = null;
      startRef.current = null;
      setDragIndex(null);
      if (!started || sameOrder(started, finished)) return;
      onCommit?.(finished);
   };

   const onKeyDown = (index: number) => (event: KeyboardEvent<HTMLButtonElement>) => {
      if (disabled) return;
      let to: number | null = null;
      if (event.key === 'ArrowUp') to = index - 1;
      else if (event.key === 'ArrowDown') to = index + 1;
      if (to === null || to < 0 || to >= ids.length) return;
      event.preventDefault();
      const next = moveItem(ids, index, to);
      onReorder(next);
      onCommit?.(next);
   };

   return (
      <ol
         ref={listRef}
         className={cn('flex flex-col', dragIndex !== null && 'cursor-grabbing select-none')}
      >
         {ids.map((id, index) => (
            <li
               key={id}
               data-model-row
               className={cn(
                  'flex min-w-0 items-center gap-2 rounded-md py-1.5',
                  dragIndex === index && 'bg-muted/60'
               )}
            >
               {sortable ? (
                  <Button
                     type="button"
                     variant="ghost"
                     size="xxs"
                     aria-label={t('reorder', { name: labelFor(id) })}
                     disabled={disabled || ids.length < 2}
                     onPointerDown={onGripDown(index)}
                     onPointerMove={onGripMove}
                     onPointerUp={endDrag}
                     onPointerCancel={endDrag}
                     onKeyDown={onKeyDown(index)}
                     className="size-6 shrink-0 cursor-grab touch-none px-0 active:cursor-grabbing"
                  >
                     <GripVertical className="size-3.5" />
                  </Button>
               ) : null}
               <span className="w-4 shrink-0 text-right text-muted-foreground tabular-nums">
                  {index + 1}
               </span>
               {children(id)}
            </li>
         ))}
      </ol>
   );
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
   const [draft, setDraft] = useState<RuntimeAgentTierPlacement | null>(null);
   const [loading, setLoading] = useState(true);
   const placement = draft ?? saved;
   const shownRef = useRef(placement);
   shownRef.current = placement;
   const readyRef = useRef(false);
   readyRef.current = !loading;

   const autosave = useQueuedSave({
      run: (next: RuntimeAgentTierPlacement) => saveTierModels(next),
      apply: (stored, sent) => {
         setSaved(stored.tiers);
         setDraft((current) => {
            if (current && !samePlacement(current, sent)) return current;
            return null;
         });
      },
   });

   useEffect(() => {
      let alive = true;
      void getTierModels().then(
         (stored) => {
            if (!alive) return;
            setSaved(stored.tiers);
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

   const stage = (tier: Tier, next: string[]) => {
      const full = { ...shownRef.current, [tier]: next };
      shownRef.current = full;
      setDraft(full);
      return full;
   };

   const commitTier = (tier: Tier, next: string[]) => {
      const full = stage(tier, next);
      if (readyRef.current) autosave.commit(full);
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
                     disabled={loading}
                     onAdd={(key) => commitTier(tier, [...list, key])}
                  />
               ) : null}
            </div>
            {list.length > 0 ? (
               <SortableModelList
                  ids={list}
                  disabled={loading}
                  sortable={canEdit}
                  labelFor={(key) => byKey.get(key)?.name ?? key}
                  onReorder={(next) => stage(tier, next)}
                  onCommit={(next) => commitTier(tier, next)}
               >
                  {(key) => {
                     const choice = byKey.get(key);
                     return (
                        <>
                           <span className="min-w-0 flex-1">
                              <span className="block truncate">{choice?.name ?? key}</span>
                              {choice ? (
                                 <span className="block truncate text-muted-foreground">
                                    {choice.runtimeName}
                                 </span>
                              ) : null}
                           </span>
                           {canEdit ? (
                              <Button
                                 variant="ghost"
                                 size="xs"
                                 className="size-7 shrink-0 p-0 text-status-danger hover:text-status-danger"
                                 aria-label={t('remove')}
                                 disabled={loading}
                                 onClick={() =>
                                    commitTier(
                                       tier,
                                       list.filter((other) => other !== key)
                                    )
                                 }
                              >
                                 <Trash2 className="size-3.5" aria-hidden />
                              </Button>
                           ) : null}
                        </>
                     );
                  }}
               </SortableModelList>
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
               <SaveIndicator
                  state={autosave.state}
                  error={autosave.error}
                  onRetry={autosave.retry}
               />
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

   const saved = data.value?.tiers.placement?.tiers ?? EMPTY;
   const source = data.value?.tiers.placement?.source ?? 'deployment';
   const placement = draft ?? saved;
   const dirty = draft !== null && !samePlacement(draft, saved);
   const shownRef = useRef(placement);
   shownRef.current = placement;
   const valueRef = useRef(data.value);
   valueRef.current = data.value;
   const readyRef = useRef(false);
   readyRef.current = data.value !== null && !data.loading;
   const byId = useMemo(
      () => new Map((data.value?.candidates.models ?? []).map((model) => [model.id, model])),
      [data.value]
   );
   const placed = new Set(MAIN_TIERS.flatMap((tier) => placement[tier]));

   const autosave = useQueuedSave({
      run: (next: TierPlacement) => updateTierPlacement(next),
      apply: (tiers, sent) => {
         const current = valueRef.current;
         if (!current) return;
         data.set({ ...current, tiers });
         setDraft((draftNow) => {
            if (draftNow && !samePlacement(draftNow, sent)) return draftNow;
            return null;
         });
      },
   });

   const stage = (tier: Tier, next: string[]) => {
      const full = { ...shownRef.current, [tier]: next };
      shownRef.current = full;
      setDraft(full);
      return full;
   };

   const commitTier = (tier: Tier, next: string[]) => {
      const full = stage(tier, next);
      if (readyRef.current) autosave.commit(full);
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

   const row = (tier: Tier, id: string) => {
      const model = byId.get(id);
      return (
         <>
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
               <Button
                  variant="ghost"
                  size="xs"
                  className="size-7 shrink-0 p-0 text-status-danger hover:text-status-danger"
                  aria-label={t('remove')}
                  disabled={data.loading}
                  onClick={() =>
                     commitTier(
                        tier,
                        shownRef.current[tier].filter((other) => other !== id)
                     )
                  }
               >
                  <Trash2 className="size-3.5" aria-hidden />
               </Button>
            ) : null}
         </>
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
                     disabled={data.loading}
                     onAdd={(id) => commitTier(tier, [...list, id])}
                  />
               ) : null}
            </div>
            {list.length > 0 ? (
               <SortableModelList
                  ids={list}
                  disabled={data.loading}
                  sortable={canEdit}
                  labelFor={(id) => {
                     const model = byId.get(id);
                     return model ? modelName(model.name) : id;
                  }}
                  onReorder={(next) => stage(tier, next)}
                  onCommit={(next) => commitTier(tier, next)}
               >
                  {(id) => row(tier, id)}
               </SortableModelList>
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
               <SaveIndicator
                  state={autosave.state}
                  error={autosave.error}
                  onRetry={autosave.retry}
               />
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
