'use client';

import { ChevronDown, Plus, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';

import { AgentPicker, type AgentOption } from '@/components/common/agents/agent-multiselect';
import { SettingsSection } from '@/components/common/settings/shared';
import { Button } from '@/components/ui/button';
import {
   DropdownMenu,
   DropdownMenuContent,
   DropdownMenuItem,
   DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import type { RoleContract } from '@/lib/organization';

type EscalationRule = RoleContract['escalation_rules'][number];

const DECISIONS = ['product', 'technical', 'security', 'operational'] as const;

function decisionLabel(
   t: (
      key:
         | 'escalationDecision.product'
         | 'escalationDecision.technical'
         | 'escalationDecision.security'
         | 'escalationDecision.operational'
   ) => string,
   decision: string
): string {
   if (decision === 'product') return t('escalationDecision.product');
   if (decision === 'technical') return t('escalationDecision.technical');
   if (decision === 'security') return t('escalationDecision.security');
   if (decision === 'operational') return t('escalationDecision.operational');
   return decision;
}

function emptyRule(): EscalationRule {
   return { when: '', to: 'human', decision: 'technical' };
}

interface EscalationRulesRepeaterProps {
   value: EscalationRule[];
   roleOptions: AgentOption[];
   onChange: (next: EscalationRule[]) => void;
   disabled?: boolean;
   title: string;
   description?: string;
}

/**
 * Escalation rules with the Capabilities → Skills list surface — edited inline.
 */
export function EscalationRulesRepeater({
   value,
   roleOptions,
   onChange,
   disabled = false,
   title,
   description,
}: EscalationRulesRepeaterProps) {
   const t = useTranslations('organization.roleTab');
   const focusRef = useRef<HTMLInputElement>(null);
   const [focusLast, setFocusLast] = useState(false);

   useEffect(() => {
      if (!focusLast) return;
      focusRef.current?.focus();
      setFocusLast(false);
   }, [focusLast, value.length]);

   const labelForTarget = (to: string) => {
      if (to === 'human') return t('escalationHuman');
      return roleOptions.find((role) => role.id === to)?.label ?? to;
   };

   const add = () => {
      onChange([...value, emptyRule()]);
      setFocusLast(true);
   };

   const patch = (index: number, next: EscalationRule) => {
      onChange(value.map((rule, at) => (at === index ? next : rule)));
   };

   return (
      <SettingsSection
         panel
         title={title}
         description={description}
         action={
            disabled ? null : (
               <Button type="button" size="xs" variant="secondary" onClick={add}>
                  <Plus className="size-4" />
                  {t('addEscalation')}
               </Button>
            )
         }
      >
         {value.length === 0 ? (
            <p className="text-muted-foreground">{t('noneSelected')}</p>
         ) : (
            <ul className="flex flex-col rounded-md border border-border">
               {value.map((rule, index) => (
                  <li
                     key={index}
                     className="flex flex-col gap-2 border-b border-border px-3 py-2.5 last:border-b-0 sm:flex-row sm:items-center"
                  >
                     <Input
                        ref={index === value.length - 1 ? focusRef : undefined}
                        disabled={disabled}
                        value={rule.when}
                        placeholder={t('escalationWhenPlaceholder')}
                        className="h-8 min-w-0 flex-1 border-0 bg-transparent px-0 shadow-none focus-visible:ring-0"
                        onChange={(event) => patch(index, { ...rule, when: event.target.value })}
                     />
                     <div className="flex shrink-0 items-center gap-1">
                        <AgentPicker
                           options={[
                              { id: 'human', label: t('escalationHuman'), colorSeed: 'human' },
                              ...roleOptions,
                           ]}
                           value={rule.to}
                           multiple={false}
                           onChange={(next) => {
                              if (typeof next === 'string') patch(index, { ...rule, to: next });
                           }}
                           trigger={
                              <Button
                                 type="button"
                                 size="xs"
                                 variant="outline"
                                 disabled={disabled}
                                 className="max-w-[10rem] justify-between font-normal"
                              >
                                 <span className="truncate">{labelForTarget(rule.to)}</span>
                                 <ChevronDown className="size-3.5 shrink-0 opacity-60" />
                              </Button>
                           }
                        />
                        <DropdownMenu>
                           <DropdownMenuTrigger asChild>
                              <Button
                                 type="button"
                                 size="xs"
                                 variant="outline"
                                 disabled={disabled}
                                 className="max-w-[8rem] justify-between font-normal"
                              >
                                 <span className="truncate">{decisionLabel(t, rule.decision)}</span>
                                 <ChevronDown className="size-3.5 shrink-0 opacity-60" />
                              </Button>
                           </DropdownMenuTrigger>
                           <DropdownMenuContent align="end" className="w-44">
                              {DECISIONS.map((decision) => (
                                 <DropdownMenuItem
                                    key={decision}
                                    onSelect={() => patch(index, { ...rule, decision })}
                                 >
                                    {decisionLabel(t, decision)}
                                 </DropdownMenuItem>
                              ))}
                           </DropdownMenuContent>
                        </DropdownMenu>
                        {disabled ? null : (
                           <Button
                              type="button"
                              size="xs"
                              variant="ghost"
                              aria-label={t('removeItem')}
                              onClick={() => onChange(value.filter((_, at) => at !== index))}
                           >
                              <Trash2 className="size-4" />
                           </Button>
                        )}
                     </div>
                  </li>
               ))}
            </ul>
         )}
      </SettingsSection>
   );
}
