'use client';

import { ChevronDown, GripVertical, Plus, Save, Trash2, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import {
   useCallback,
   useEffect,
   useMemo,
   useRef,
   useState,
   type CSSProperties,
   type KeyboardEvent,
   type PointerEvent,
   type ReactNode,
} from 'react';

import { TierChip } from '@/components/common/agents/tier-chip';
import { EmptyStateLoading } from '@/components/common/empty-state';
import { Button } from '@/components/ui/button';
import {
   Command,
   CommandEmpty,
   CommandGroup,
   CommandInput,
   CommandItem,
   CommandList,
} from '@/components/ui/command';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { MAIN_TIERS, TIER_NAMES, TIER_PLACES, TIER_STYLE, type Tier } from '@/lib/agents';
import {
   aiRuntimeModelsFrom,
   connectedAiRuntimes,
   EMPTY_AGENT_TIERS,
   getTierModels,
   saveTierModels,
   saveTierName,
   type AiRuntimeDefinition,
   type RuntimeAgentTierPlacement,
   type TierNames,
} from '@/lib/runtimes';
import { publishTierNames } from '@/lib/tier-names';
import { cn } from '@/lib/utils';
import { useSessionStore } from '@/store/session-store';
import { toast } from 'sonner';
import { SaveIndicator } from './save-indicator';
import { SETTINGS_PILL, SettingsCard, SettingsSection, SettingsShell } from './shared';
import type { SaveState } from './use-autosave';

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
/** Typed text. Inputs ignore text-* and read --input-color instead. */
const TIER_INK: Record<Tier, string> = {
   berry_max: 'var(--berry)',
   berry_xhigh: 'var(--brand-iris)',
   berry_high: 'var(--review-pending)',
   berry_mid: 'var(--status-info)',
   berry_low: 'var(--status-success)',
};

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
         {subscriptions === null ? (
            <EmptyStateLoading label={t('loading')} />
         ) : usingSubscription ? (
            <SubscriptionRoster runtimes={subscriptions} />
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
   const [names, setNames] = useState<TierNames>({ ...TIER_NAMES });
   const [nameDraft, setNameDraft] = useState<TierNames>({ ...TIER_NAMES });
   const [loading, setLoading] = useState(true);
   const placement = draft ?? saved;
   const shownRef = useRef(placement);
   shownRef.current = placement;
   const readyRef = useRef(false);
   readyRef.current = !loading;
   const skipNameBlur = useRef(false);

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
            setNames(stored.names);
            setNameDraft(stored.names);
            publishTierNames(stored.names);
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

   const nameChanged = (tier: Tier) => nameDraft[tier].trim().replace(/\s+/g, ' ') !== names[tier];

   const cancelName = (tier: Tier) => {
      skipNameBlur.current = true;
      setNameDraft((current) => ({ ...current, [tier]: names[tier] }));
   };

   const rename = async (tier: Tier) => {
      const next = nameDraft[tier].trim().replace(/\s+/g, ' ');
      if (next.length > 32) {
         setNameDraft((current) => ({ ...current, [tier]: names[tier] }));
         return;
      }
      if (next === names[tier]) {
         setNameDraft((current) => ({ ...current, [tier]: names[tier] }));
         return;
      }
      try {
         const stored = await saveTierName(tier, next);
         setNames(stored);
         setNameDraft(stored);
         publishTierNames(stored);
      } catch (error) {
         setNameDraft((current) => ({ ...current, [tier]: names[tier] }));
         toast.error(error instanceof Error ? error.message : 'The tier name could not be saved.');
      }
   };

   const card = (tier: Tier) => {
      const list = placement[tier];
      return (
         <Collapsible key={tier} defaultOpen className="group/tier">
            <div className="w-full">
               <div
                  data-column-tint="neutral"
                  className="flex min-h-10 w-full items-center gap-2 bg-group-tint-neutral px-4 py-2"
               >
                  <CollapsibleTrigger asChild>
                     <button
                        type="button"
                        className="flex h-full shrink-0 cursor-pointer items-center rounded-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                        aria-label={names[tier]}
                     >
                        <ChevronDown
                           aria-hidden
                           className="size-3.5 text-muted-foreground transition-transform duration-200 group-data-[state=closed]/tier:-rotate-90"
                        />
                     </button>
                  </CollapsibleTrigger>
                  {canEdit ? (
                     <>
                        <input
                           aria-label={t('renameTier')}
                           value={nameDraft[tier]}
                           maxLength={32}
                           disabled={loading}
                           spellCheck={false}
                           onChange={(event) =>
                              setNameDraft((current) => ({
                                 ...current,
                                 [tier]: event.target.value,
                              }))
                           }
                           onBlur={() => {
                              if (skipNameBlur.current) {
                                 skipNameBlur.current = false;
                                 return;
                              }
                              void rename(tier);
                           }}
                           onKeyDown={(event) => {
                              if (event.key === 'Enter') event.currentTarget.blur();
                              if (event.key === 'Escape') {
                                 cancelName(tier);
                                 event.currentTarget.blur();
                              }
                           }}
                           className={cn(
                              'h-7 w-40 rounded border px-2 text-left leading-none outline-none focus-visible:ring-0 disabled:opacity-50',
                              TIER_STYLE[tier]
                           )}
                           style={{ '--input-color': TIER_INK[tier] } as CSSProperties}
                        />
                        <div className="flex items-center gap-0">
                           <Button
                              type="button"
                              size="icon"
                              variant="ghost"
                              className={cn(
                                 'size-7 p-0 text-muted-foreground focus-visible:ring-0 disabled:opacity-100',
                                 nameChanged(tier) &&
                                    'text-primary hover:bg-primary/10 hover:text-primary'
                              )}
                              aria-label={t('save')}
                              disabled={loading || !nameChanged(tier)}
                              onMouseDown={(event) => event.preventDefault()}
                              onClick={() => void rename(tier)}
                           >
                              <Save className="size-5" strokeWidth={1.6} aria-hidden />
                           </Button>
                           <Button
                              type="button"
                              size="icon"
                              variant="ghost"
                              className={cn(
                                 '-ml-1 size-7 p-0 text-muted-foreground focus-visible:ring-0 disabled:opacity-100',
                                 nameChanged(tier) && 'hover:text-foreground'
                              )}
                              aria-label={t('discard')}
                              disabled={loading || !nameChanged(tier)}
                              onMouseDown={(event) => event.preventDefault()}
                              onClick={() => cancelName(tier)}
                           >
                              <X className="size-5" strokeWidth={1.6} aria-hidden />
                           </Button>
                        </div>
                     </>
                  ) : (
                     <TierChip tier={tier} className="justify-start" />
                  )}
                  <CollapsibleTrigger asChild>
                     <button
                        type="button"
                        className="h-full min-w-0 flex-1"
                        aria-hidden
                        tabIndex={-1}
                     />
                  </CollapsibleTrigger>
                  {canEdit && list.length < TIER_PLACES ? (
                     <AddRuntimeModel
                        choices={choices.filter((choice) => !list.includes(choice.key))}
                        disabled={loading}
                        onAdd={(key) => commitTier(tier, [...list, key])}
                     />
                  ) : null}
               </div>
            </div>
            <CollapsibleContent>
               {list.length > 0 ? (
                  <div className="px-4 pb-3">
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
                  </div>
               ) : null}
            </CollapsibleContent>
         </Collapsible>
      );
   };

   return (
      <SettingsSection
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
            <button
               type="button"
               className={SETTINGS_PILL}
               disabled={disabled || choices.length === 0}
            >
               <Plus className="size-4" />
               {t('add')}
            </button>
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
