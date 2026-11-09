'use client';

import { ChevronRight } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useId, useState } from 'react';

import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import type { AccessMode, ConcurrencyPolicy } from '@/lib/autopilots';
import { cn } from '@/lib/utils';

export interface LoopPolicy {
   accessMode: AccessMode;
   concurrencyPolicy: ConcurrencyPolicy;
   maxTurns: number | null;
   maxDurationMinutes: number | null;
   maxChainDepth: number;
   allowAgentEvents: boolean;
}

export const DEFAULT_LOOP_POLICY: LoopPolicy = {
   accessMode: 'recommend',
   concurrencyPolicy: 'skip_if_running',
   maxTurns: null,
   maxDurationMinutes: null,
   maxChainDepth: 0,
   allowAgentEvents: false,
};

/** The server's hard limit on Loop chains (`MAX_CHAIN_DEPTH`). */
const MAX_CHAIN_DEPTH = 3;

interface Props {
   value: LoopPolicy;
   onChange: (next: LoopPolicy) => void;
   /** Event-only settings are hidden for a Loop that listens for no event. */
   listensForEvents: boolean;
}

/**
 * What a Loop's runs may do, and how far they may go.
 *
 * Access is up front because it is the one decision that changes what the
 * Loop can touch. Everything else — concurrency, budgets, chains — sits
 * behind "Limits", with defaults that are safe to leave alone. None of it can
 * give an agent more than its own role allows; the server enforces that.
 */
export default function LoopPolicyFields({ value, onChange, listensForEvents }: Props) {
   const t = useTranslations('loops.policy');
   const id = useId();
   const [open, setOpen] = useState(false);
   const set = <K extends keyof LoopPolicy>(key: K, next: LoopPolicy[K]) =>
      onChange({ ...value, [key]: next });

   return (
      <div className="grid gap-3">
         <fieldset className="grid gap-2">
            <legend className="mb-1.5">{t('access')}</legend>
            <div className="grid gap-2 sm:grid-cols-2">
               {(['recommend', 'act'] as const).map((mode) => (
                  <label
                     key={mode}
                     className={cn(
                        'flex cursor-pointer gap-2.5 rounded-md border p-3 transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring/50',
                        value.accessMode === mode
                           ? 'border-primary/50 bg-primary/5'
                           : 'hover:bg-settings-row-hover'
                     )}
                  >
                     <input
                        type="radio"
                        name={`${id}-access`}
                        value={mode}
                        checked={value.accessMode === mode}
                        onChange={() => set('accessMode', mode)}
                        className="mt-0.5 accent-[var(--primary)]"
                     />
                     <span className="grid gap-0.5">
                        <span className="font-medium">{t(`${mode}.title`)}</span>
                        <span className="text-muted-foreground">{t(`${mode}.body`)}</span>
                     </span>
                  </label>
               ))}
            </div>
            {value.accessMode === 'act' ? (
               <p className="text-status-warning" role="note">
                  {t('act.warning')}
               </p>
            ) : null}
         </fieldset>

         <Collapsible open={open} onOpenChange={setOpen}>
            <CollapsibleTrigger className="flex items-center gap-1 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 rounded">
               <ChevronRight
                  className={cn('size-4 transition-transform', open && 'rotate-90')}
                  aria-hidden
               />
               {t('limits')}
               <span className="text-subtle-foreground">
                  ·{' '}
                  {t('limitsSummary', { concurrency: t(`concurrency.${value.concurrencyPolicy}`) })}
               </span>
            </CollapsibleTrigger>
            <CollapsibleContent className="mt-3 grid gap-4">
               <div className="flex items-start justify-between gap-4">
                  <div className="grid gap-0.5">
                     <Label htmlFor={`${id}-concurrency`}>{t('concurrencyLabel')}</Label>
                     <p className="text-muted-foreground">{t('concurrencyHint')}</p>
                  </div>
                  <Switch
                     id={`${id}-concurrency`}
                     checked={value.concurrencyPolicy === 'skip_if_running'}
                     onCheckedChange={(checked) =>
                        set('concurrencyPolicy', checked ? 'skip_if_running' : 'allow')
                     }
                  />
               </div>

               <div className="grid gap-3 sm:grid-cols-2">
                  <NumberField
                     id={`${id}-turns`}
                     label={t('maxTurns')}
                     hint={t('maxTurnsHint')}
                     value={value.maxTurns}
                     min={1}
                     max={500}
                     onChange={(next) => set('maxTurns', next)}
                  />
                  <NumberField
                     id={`${id}-duration`}
                     label={t('maxDuration')}
                     hint={t('maxDurationHint')}
                     value={value.maxDurationMinutes}
                     min={1}
                     max={1440}
                     onChange={(next) => set('maxDurationMinutes', next)}
                  />
               </div>

               {listensForEvents ? (
                  <>
                     <div className="flex items-start justify-between gap-4">
                        <div className="grid gap-0.5">
                           <Label htmlFor={`${id}-agents`}>{t('agentEvents')}</Label>
                           <p className="text-muted-foreground">{t('agentEventsHint')}</p>
                        </div>
                        <Switch
                           id={`${id}-agents`}
                           checked={value.allowAgentEvents}
                           onCheckedChange={(checked) => set('allowAgentEvents', checked)}
                        />
                     </div>
                     <div className="grid gap-1.5">
                        <Label htmlFor={`${id}-depth`}>{t('chainDepth')}</Label>
                        <Input
                           id={`${id}-depth`}
                           type="number"
                           min={0}
                           max={MAX_CHAIN_DEPTH}
                           className="w-24"
                           value={value.maxChainDepth}
                           onChange={(event) =>
                              set(
                                 'maxChainDepth',
                                 Math.max(
                                    0,
                                    Math.min(MAX_CHAIN_DEPTH, Number(event.target.value) || 0)
                                 )
                              )
                           }
                        />
                        <p className="text-muted-foreground">
                           {t('chainDepthHint', { max: MAX_CHAIN_DEPTH })}
                        </p>
                     </div>
                  </>
               ) : null}
            </CollapsibleContent>
         </Collapsible>
      </div>
   );
}

function NumberField({
   id,
   label,
   hint,
   value,
   min,
   max,
   onChange,
}: {
   id: string;
   label: string;
   hint: string;
   value: number | null;
   min: number;
   max: number;
   onChange: (next: number | null) => void;
}) {
   return (
      <div className="grid gap-1.5">
         <Label htmlFor={id}>{label}</Label>
         <Input
            id={id}
            type="number"
            inputMode="numeric"
            min={min}
            max={max}
            value={value ?? ''}
            placeholder="—"
            onChange={(event) => {
               const raw = event.target.value.trim();
               if (raw === '') return onChange(null);
               const parsed = Math.round(Number(raw));
               if (Number.isFinite(parsed)) onChange(Math.max(min, Math.min(max, parsed)));
            }}
         />
         <p className="text-muted-foreground">{hint}</p>
      </div>
   );
}
