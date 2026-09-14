'use client';

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
import { colorForSkillLabel } from '@/lib/skill-labels';
import { listSkills } from '@/lib/skills';
import { CheckIcon, Plus, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useMemo, useState } from 'react';

interface SkillLabelMultiselectProps {
   value: string[];
   onChange: (labels: string[]) => void;
   disabled?: boolean;
}

/**
 * Free-form skill labels as chips, with a catalogue of labels already used on
 * other skills and room to add a new one from the search field.
 */
export function SkillLabelMultiselect({
   value,
   onChange,
   disabled = false,
}: SkillLabelMultiselectProps) {
   const t = useTranslations('areas.skills');
   const [open, setOpen] = useState(false);
   const [query, setQuery] = useState('');
   const [catalogue, setCatalogue] = useState<string[]>([]);

   useEffect(() => {
      if (!open || catalogue.length > 0) return;
      let cancelled = false;
      void listSkills()
         .then((skills) => {
            if (cancelled) return;
            const names = new Set<string>();
            for (const skill of skills) {
               for (const label of skill.labels) names.add(label);
            }
            setCatalogue([...names].sort((a, b) => a.localeCompare(b)));
         })
         .catch(() => undefined);
      return () => {
         cancelled = true;
      };
   }, [open, catalogue.length]);

   const options = useMemo(() => {
      const names = new Set([...catalogue, ...value]);
      return [...names].sort((a, b) => a.localeCompare(b));
   }, [catalogue, value]);

   const trimmed = query.trim();
   const canCreate =
      trimmed.length > 0 &&
      !options.some((label) => label.toLowerCase() === trimmed.toLowerCase());

   const toggle = (label: string) => {
      onChange(value.includes(label) ? value.filter((entry) => entry !== label) : [...value, label]);
   };

   const create = (label: string) => {
      if (!label || value.includes(label)) return;
      onChange([...value, label]);
      setCatalogue((current) =>
         current.includes(label) ? current : [...current, label].sort((a, b) => a.localeCompare(b))
      );
      setQuery('');
   };

   return (
      <div className="flex shrink-0 flex-col gap-1.5">
         <div className="flex items-center justify-between gap-2">
            <span className="text-muted-foreground">{t('detail.labels')}</span>
            {disabled ? null : (
               <Popover
                  open={open}
                  onOpenChange={(next) => {
                     setOpen(next);
                     if (!next) setQuery('');
                  }}
               >
                  <PopoverTrigger asChild>
                     <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-6"
                        aria-label={t('detail.addLabel')}
                        title={t('detail.addLabel')}
                     >
                        <Plus className="size-3.5" />
                     </Button>
                  </PopoverTrigger>
                  <PopoverContent align="end" className="w-56 p-0">
                     <Command>
                        <CommandInput
                           placeholder={t('detail.labels')}
                           value={query}
                           onValueChange={setQuery}
                           className="h-8"
                        />
                        <CommandList>
                           <CommandEmpty>{t('detail.noLabels')}</CommandEmpty>
                           <CommandGroup>
                              {canCreate ? (
                                 <CommandItem value={`__create__${trimmed}`} onSelect={() => create(trimmed)}>
                                    <Plus className="size-3.5" />
                                    <span className="min-w-0 truncate">
                                       {t('detail.createLabel', { name: trimmed })}
                                    </span>
                                 </CommandItem>
                              ) : null}
                              {options.map((label) => {
                                 const on = value.includes(label);
                                 return (
                                    <CommandItem
                                       key={label}
                                       value={label}
                                       onSelect={() => toggle(label)}
                                    >
                                       <span className="min-w-0 truncate">{label}</span>
                                       {on ? <CheckIcon className="ml-auto size-3.5" /> : null}
                                    </CommandItem>
                                 );
                              })}
                           </CommandGroup>
                        </CommandList>
                     </Command>
                  </PopoverContent>
               </Popover>
            )}
         </div>
         {value.length === 0 ? (
            <p className="text-muted-foreground">{t('detail.noLabels')}</p>
         ) : (
            <div className="flex flex-wrap items-center gap-1">
               {value.map((label) => {
                  const color = colorForSkillLabel(label);
                  return (
                     <button
                        key={label}
                        type="button"
                        disabled={disabled}
                        onClick={() => toggle(label)}
                        title={label}
                        className="inline-flex min-w-0 items-center gap-1 rounded-full border px-2 py-0.5 disabled:opacity-60"
                        style={{
                           backgroundColor: `${color}26`,
                           borderColor: color,
                           color,
                        }}
                     >
                        <span className="max-w-[140px] truncate">{label}</span>
                        {disabled ? null : <X className="size-3 shrink-0" />}
                     </button>
                  );
               })}
            </div>
         )}
      </div>
   );
}
