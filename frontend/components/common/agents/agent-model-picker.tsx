'use client';

import { useEffect, useMemo, useState } from 'react';
import { CheckIcon } from 'lucide-react';

import {
   Command,
   CommandEmpty,
   CommandInput,
   CommandItem,
   CommandList,
} from '@/components/ui/command';
import { cn } from '@/lib/utils';
import { listAgentModels, modelKey, modelPrice, type AgentModel } from '@/lib/agents';

interface AgentModelPickerProps {
   provider: string | null;
   model: string | null;
   disabled?: boolean;
   /** Draft selection only — the parent owns save. */
   onChange: (provider: string, model: string) => void;
}

/** Enough for about ten list rows to show without scrolling. */
const LIST_HEIGHT = 'h-[25rem]';

/** `200K` — context windows are read as magnitude, not exact token counts. */
function compact(tokens: number): string {
   if (tokens >= 1_000_000) return `${Math.round(tokens / 1_000_000)}M`;
   if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}K`;
   return String(tokens);
}

/**
 * Every whitespace-separated term must appear in the entry.
 *
 * cmdk's default scorer is fuzzy enough to rank an unrelated model above
 * nothing — typing gibberish returned "Amazon: Nova Premier" rather than an
 * empty list. A model is picked by recalling part of its vendor or name, so
 * substring-per-term is both predictable and enough.
 */
/** A–Z by the name a person reads, then by id so equal names stay put. */
function byName(left: AgentModel, right: AgentModel): number {
   const byLabel = left.displayName.localeCompare(right.displayName, undefined, {
      numeric: true,
      sensitivity: 'base',
   });
   if (byLabel !== 0) return byLabel;
   return left.id.localeCompare(right.id);
}

function matches(value: string, search: string): number {
   const haystack = value.toLowerCase();
   const terms = search.toLowerCase().split(/\s+/).filter(Boolean);
   if (terms.length === 0) return 1;
   return terms.every((term) => haystack.includes(term)) ? 1 : 0;
}

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
   return (
      <div className="flex items-start justify-between gap-4 py-2">
         <span className="shrink-0 text-muted-foreground">{label}</span>
         <div className="min-w-0 text-right">{children}</div>
      </div>
   );
}

/**
 * Chooses the LLM an agent runs on.
 *
 * Two columns: a searchable catalogue on the left (tall enough to show about
 * ten models at once), and an enriched reading of the focused model on the
 * right. Clicking a row updates the draft only — the parent saves it.
 */
export function AgentModelPicker({
   provider,
   model,
   disabled = false,
   onChange,
}: AgentModelPickerProps) {
   const [models, setModels] = useState<AgentModel[]>([]);
   const [loadError, setLoadError] = useState<string | null>(null);
   const current = provider && model ? `${provider}/${model}` : '';
   const [focusedKey, setFocusedKey] = useState<string | null>(null);

   useEffect(() => {
      let cancelled = false;
      void (async () => {
         try {
            const loaded = await listAgentModels();
            if (!cancelled) setModels(loaded);
         } catch (cause) {
            if (!cancelled) {
               setLoadError(cause instanceof Error ? cause.message : 'Could not load models');
            }
         }
      })();
      return () => {
         cancelled = true;
      };
   }, []);

   const sorted = useMemo(() => models.slice().sort(byName), [models]);

   const selected = models.find((item) => modelKey(item) === current) ?? null;
   const focused = models.find((item) => modelKey(item) === (focusedKey ?? current)) ?? selected;

   const choose = (value: string) => {
      if (disabled) return;
      const divider = value.indexOf('/');
      if (divider < 1) return;
      setFocusedKey(value);
      if (value === current) return;
      onChange(value.slice(0, divider), value.slice(divider + 1));
   };

   return (
      <section className="flex flex-col gap-2">
         <div className="flex flex-col gap-1">
            <div className="flex items-baseline gap-2">
               <h3 className="font-medium text-foreground">Model</h3>
               <p className="text-muted-foreground">The LLM this agent runs every task on.</p>
            </div>
         </div>

         <div className="grid min-h-0 grid-cols-1 overflow-hidden rounded-md border border-border md:grid-cols-2">
            <div className="flex min-h-0 flex-col border-b border-border md:border-b-0 md:border-r">
               <Command filter={matches} className="rounded-none">
                  <CommandInput placeholder="Search models…" disabled={disabled} />
                  <CommandList className={cn(LIST_HEIGHT, 'max-h-none overflow-y-auto')}>
                     <CommandEmpty>No model matches.</CommandEmpty>
                     {sorted.map((item) => {
                        const key = modelKey(item);
                        const active = key === current;
                        const previewing = key === (focusedKey ?? current);
                        return (
                           <CommandItem
                              key={key}
                              value={`${key} ${item.displayName}`}
                              disabled={disabled}
                              onSelect={() => choose(key)}
                              onMouseEnter={() => setFocusedKey(key)}
                              className={cn(
                                 'flex h-10 items-center gap-2 rounded-none px-3',
                                 previewing && 'bg-accent/60'
                              )}
                           >
                              <CheckIcon
                                 className={cn(
                                    'size-3.5 shrink-0',
                                    active ? 'opacity-100' : 'opacity-0'
                                 )}
                              />
                              <span className="min-w-0 flex-1 truncate">{item.displayName}</span>
                              <span className="shrink-0 text-muted-foreground">
                                 {modelPrice(item.inputCostPerM)}/{modelPrice(item.outputCostPerM)}
                              </span>
                           </CommandItem>
                        );
                     })}
                  </CommandList>
               </Command>
            </div>

            <div className={cn('flex min-h-0 flex-col gap-4 overflow-y-auto p-4', LIST_HEIGHT)}>
               {focused ? (
                  <>
                     <div className="flex flex-col gap-1">
                        <p className="font-medium">{focused.displayName}</p>
                        <p className="text-muted-foreground">
                           {focused.provider}
                           {modelKey(focused) === current ? ' · in use' : null}
                        </p>
                     </div>

                     <div className="flex flex-col divide-y divide-border/60 border-y border-border/60">
                        <DetailRow label="Model id">
                           <span className="break-all font-mono">{focused.id}</span>
                        </DetailRow>
                        {focused.tier ? (
                           <DetailRow label="Tier">
                              <span className="capitalize">{focused.tier}</span>
                           </DetailRow>
                        ) : null}
                        <DetailRow label="Input">
                           {modelPrice(focused.inputCostPerM)} per million tokens
                        </DetailRow>
                        <DetailRow label="Output">
                           {modelPrice(focused.outputCostPerM)} per million tokens
                        </DetailRow>
                        <DetailRow label="Context">
                           {focused.contextWindow > 0
                              ? `${compact(focused.contextWindow)} tokens`
                              : 'Not published'}
                        </DetailRow>
                        <DetailRow label="Tools">
                           {focused.supportsTools ? 'Supported' : 'Not supported'}
                        </DetailRow>
                        <DetailRow label="Vision">
                           {focused.supportsVision ? 'Supported' : 'Not supported'}
                        </DetailRow>
                     </div>
                  </>
               ) : current ? (
                  <div className="flex flex-col gap-1">
                     <p className="font-medium">{current}</p>
                     <p className="text-muted-foreground">
                        This model is assigned, but it is no longer in the catalogue.
                     </p>
                  </div>
               ) : (
                  <p className="text-muted-foreground">Select a model from the list.</p>
               )}
            </div>
         </div>

         {loadError ? (
            <p className="text-destructive" role="alert">
               {loadError}
            </p>
         ) : null}
      </section>
   );
}
