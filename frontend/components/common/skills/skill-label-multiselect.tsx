'use client';

import { colorForSkillLabel } from '@/lib/skill-labels';
import { Plus, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

/** Matches the skill write path: a label is 1–40 characters, at most 20 of them. */
const MAX_LABEL_LENGTH = 40;
const MAX_LABELS = 20;

interface SkillLabelMultiselectProps {
   value: string[];
   onChange: (labels: string[]) => void;
   disabled?: boolean;
   /** Labels already used in the catalogue, offered when adding. */
   options?: string[];
}

/**
 * Skill labels as chips. An editor removes one by clicking its chip, or adds
 * one from the catalogue (or a new name) without leaving this section.
 */
export function SkillLabelMultiselect({
   value,
   onChange,
   disabled = false,
   options = [],
}: SkillLabelMultiselectProps) {
   const t = useTranslations('areas.skills');
   const [query, setQuery] = useState('');

   const remove = (label: string) => {
      onChange(value.filter((entry) => entry !== label));
   };

   const add = (raw: string) => {
      const name = raw.trim();
      if (!name || name.length > MAX_LABEL_LENGTH || value.length >= MAX_LABELS) return;
      if (value.some((entry) => entry.toLowerCase() === name.toLowerCase())) return;
      const canonical = options.find((entry) => entry.toLowerCase() === name.toLowerCase()) ?? name;
      onChange([...value, canonical]);
      setQuery('');
   };

   return (
      <div className="flex shrink-0 flex-col gap-1.5">
         <span className="text-muted-foreground">{t('detail.labels')}</span>
         <div className="flex flex-wrap items-center gap-1">
            {value.length === 0 ? (
               <p className="text-muted-foreground">{t('detail.noLabels')}</p>
            ) : (
               value.map((label) => {
                  const color = colorForSkillLabel(label);
                  return (
                     <button
                        key={label}
                        type="button"
                        disabled={disabled}
                        onClick={() => remove(label)}
                        title={label}
                        className="inline-flex min-w-0 items-center gap-1 rounded-full border px-2 py-0.5 disabled:opacity-60"
                        style={{
                           backgroundColor: `${color}26`,
                           borderColor: color,
                           color,
                        }}
                     >
                        <span className="max-w-[140px] truncate">{label}</span>
                        {disabled ? null : <X className="size-3 shrink-0" aria-hidden />}
                     </button>
                  );
               })
            )}
            {disabled ? null : (
               <AddLabel
                  value={value}
                  options={options}
                  query={query}
                  onQueryChange={setQuery}
                  onAdd={add}
               />
            )}
         </div>
      </div>
   );
}

function AddLabel({
   value,
   options,
   query,
   onQueryChange,
   onAdd,
}: {
   value: string[];
   options: string[];
   query: string;
   onQueryChange: (query: string) => void;
   onAdd: (name: string) => void;
}) {
   const t = useTranslations('areas.skills');
   const needle = query.trim().toLowerCase();
   const selected = useMemo(() => new Set(value.map((label) => label.toLowerCase())), [value]);
   const filtered = options.filter(
      (label) =>
         !selected.has(label.toLowerCase()) &&
         (needle.length === 0 || label.toLowerCase().includes(needle))
   );
   const trimmed = query.trim();
   const canCreate =
      trimmed.length > 0 &&
      trimmed.length <= MAX_LABEL_LENGTH &&
      value.length < MAX_LABELS &&
      !options.some((label) => label.toLowerCase() === trimmed.toLowerCase()) &&
      !selected.has(trimmed.toLowerCase());

   return (
      <Popover
         onOpenChange={(open) => {
            if (!open) onQueryChange('');
         }}
      >
         <PopoverTrigger asChild>
            <Button type="button" size="xs" variant="outline" className="gap-1">
               <Plus className="size-3" />
               {t('detail.addLabel')}
            </Button>
         </PopoverTrigger>
         <PopoverContent align="start" className="w-56 p-0">
            <div className="border-b p-1">
               <Input
                  value={query}
                  onChange={(event) => onQueryChange(event.target.value)}
                  onKeyDown={(event) => {
                     if (event.key !== 'Enter') return;
                     event.preventDefault();
                     if (canCreate) onAdd(trimmed);
                     else if (filtered[0]) onAdd(filtered[0]);
                  }}
                  placeholder={t('detail.searchLabels')}
                  aria-label={t('detail.searchLabels')}
                  maxLength={MAX_LABEL_LENGTH}
                  className="h-7"
               />
            </div>
            <div className="max-h-72 overflow-y-auto p-1">
               {canCreate ? (
                  <button
                     type="button"
                     className="flex w-full rounded-sm px-2 py-1.5 text-left hover:bg-accent"
                     onClick={() => onAdd(trimmed)}
                  >
                     <span className="min-w-0 truncate">
                        {t('detail.createLabel', { name: trimmed })}
                     </span>
                  </button>
               ) : null}
               {filtered.length === 0 && !canCreate ? (
                  <p className="px-2 py-1.5 text-muted-foreground">
                     {needle ? t('detail.noMatch') : t('detail.noLabels')}
                  </p>
               ) : (
                  filtered.map((label) => (
                     <button
                        key={label}
                        type="button"
                        className="flex w-full rounded-sm px-2 py-1.5 text-left hover:bg-accent"
                        onClick={() => onAdd(label)}
                     >
                        <span className="min-w-0 truncate">{label}</span>
                     </button>
                  ))
               )}
            </div>
         </PopoverContent>
      </Popover>
   );
}
