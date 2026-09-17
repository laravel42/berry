'use client';

import { CheckIcon, Plus, X } from 'lucide-react';
import { type ReactNode, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';

import { BerryMark } from '@/components/brand/berry-mark';
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
import { colorForAgent } from '@/lib/agent-color';

/** One selectable agent (or role agent) in a picker. */
export interface AgentOption {
   id: string;
   label: string;
   /** Seed for Berry mark colour; defaults to `id`. */
   colorSeed?: string;
}

function colorOf(option: Pick<AgentOption, 'id' | 'colorSeed'>): string {
   return colorForAgent(option.colorSeed ?? option.id);
}

interface AgentCommandItemsProps {
   options: AgentOption[];
   /** Selected ids (multi) or a single id (single). */
   value: string | string[] | null;
   onSelect: (id: string) => void;
   /**
    * When set, options are filtered here (`shouldFilter={false}` parents).
    * When omitted, cmdk filters against each item's `value` (label + id).
    */
   query?: string;
}

function selectedSet(value: string | string[] | null): Set<string> {
   if (value == null) return new Set();
   return new Set(Array.isArray(value) ? value : [value]);
}

/**
 * Agent rows only — embed inside an existing `Command` (filters, submenus).
 */
export function AgentCommandItems({ options, value, onSelect, query }: AgentCommandItemsProps) {
   const selected = selectedSet(value);
   const needle = query?.trim().toLowerCase() ?? '';
   const filtered = needle
      ? options.filter(
           (option) =>
              option.id.toLowerCase().includes(needle) ||
              option.label.toLowerCase().includes(needle)
        )
      : options;

   return (
      <>
         {filtered.map((option) => {
            const on = selected.has(option.id);
            const color = colorOf(option);
            return (
               <CommandItem
                  key={option.id}
                  value={`${option.label} ${option.id}`}
                  onSelect={() => onSelect(option.id)}
               >
                  <BerryMark
                     size="sm"
                     tone="working"
                     dotColor={color}
                     label={option.label}
                     className="size-3.5"
                  />
                  <span className="min-w-0 truncate text-foreground">{option.label}</span>
                  {on ? <CheckIcon className="ml-auto size-3.5 shrink-0" /> : null}
               </CommandItem>
            );
         })}
      </>
   );
}

interface AgentCommandListProps {
   options: AgentOption[];
   /** Selected ids (multi) or a single id (single). */
   value: string | string[] | null;
   onSelect: (id: string) => void;
   query: string;
   onQueryChange: (query: string) => void;
   searchPlaceholder?: string;
   emptyLabel?: string;
}

/**
 * Searchable agent roster for embedding in a popover, dropdown, or sheet.
 *
 * Rows keep a coloured Berry mark; the name uses the foreground colour so
 * the roster stays readable and the mark carries the agent identity.
 */
export function AgentCommandList({
   options,
   value,
   onSelect,
   query,
   onQueryChange,
   searchPlaceholder,
   emptyLabel,
}: AgentCommandListProps) {
   const t = useTranslations('common.agentPicker');

   return (
      <Command shouldFilter={false}>
         <CommandInput
            value={query}
            onValueChange={onQueryChange}
            placeholder={searchPlaceholder ?? t('search')}
            className="h-8"
         />
         <CommandList>
            <CommandEmpty>{emptyLabel ?? t('empty')}</CommandEmpty>
            <CommandGroup>
               <AgentCommandItems
                  options={options}
                  value={value}
                  onSelect={onSelect}
                  query={query}
               />
            </CommandGroup>
         </CommandList>
      </Command>
   );
}

interface AgentPickerProps {
   options: AgentOption[];
   /** Multi: selected ids. Single: the selected id, or null. */
   value: string[] | string | null;
   onChange: (next: string[] | string | null) => void;
   /** Default true. When false, picking an agent replaces the value and closes. */
   multiple?: boolean;
   disabled?: boolean;
   /** Trigger element; defaults to a small + button. */
   trigger?: ReactNode;
   align?: 'start' | 'center' | 'end';
   contentClassName?: string;
   searchPlaceholder?: string;
   emptyLabel?: string;
   addLabel?: string;
}

/**
 * Popover agent catalogue. Multi toggles membership; single picks one and closes.
 */
export function AgentPicker({
   options,
   value,
   onChange,
   multiple = true,
   disabled = false,
   trigger,
   align = 'start',
   contentClassName = 'w-72 p-0',
   searchPlaceholder,
   emptyLabel,
   addLabel,
}: AgentPickerProps) {
   const t = useTranslations('common.agentPicker');
   const [open, setOpen] = useState(false);
   const [query, setQuery] = useState('');

   if (disabled) return trigger ? <>{trigger}</> : null;

   const select = (id: string) => {
      if (multiple) {
         const current = Array.isArray(value) ? value : value ? [value] : [];
         onChange(
            current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id]
         );
         return;
      }
      onChange(id);
      setOpen(false);
      setQuery('');
   };

   return (
      <Popover
         open={open}
         onOpenChange={(next) => {
            setOpen(next);
            if (!next) setQuery('');
         }}
      >
         <PopoverTrigger asChild>
            {trigger ?? (
               <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-6"
                  aria-label={addLabel ?? t('add')}
                  title={addLabel ?? t('add')}
               >
                  <Plus className="size-3.5" />
               </Button>
            )}
         </PopoverTrigger>
         <PopoverContent align={align} className={contentClassName}>
            <AgentCommandList
               options={options}
               value={value}
               onSelect={select}
               query={query}
               onQueryChange={setQuery}
               searchPlaceholder={searchPlaceholder}
               emptyLabel={emptyLabel}
            />
         </PopoverContent>
      </Popover>
   );
}

interface AgentMultiselectProps {
   value: string[];
   options: AgentOption[];
   onChange: (next: string[]) => void;
   disabled?: boolean;
   /** Chip text; defaults to the option label or the raw id. */
   chipLabel?: (id: string) => string;
   emptyLabel?: string;
   addLabel?: string;
   searchPlaceholder?: string;
   noneLabel?: string;
}

/**
 * Agents as coloured chips with a searchable catalogue to add or remove.
 *
 * Shared wherever the product needs to pick one or more agents by id (role
 * contracts use the role key as `id` and pass `colorSeed` as the agent id).
 */
export function AgentMultiselect({
   value,
   options,
   onChange,
   disabled = false,
   chipLabel,
   emptyLabel,
   addLabel,
   searchPlaceholder,
   noneLabel,
}: AgentMultiselectProps) {
   const t = useTranslations('common.agentPicker');
   const byId = useMemo(() => new Map(options.map((option) => [option.id, option])), [options]);

   const labelFor = (id: string) => chipLabel?.(id) ?? byId.get(id)?.label ?? id;

   const remove = (id: string) => {
      onChange(value.filter((entry) => entry !== id));
   };

   return (
      <div className="flex flex-col gap-2">
         <div className="flex flex-wrap items-center gap-1.5">
            {value.length === 0 ? (
               <span className="text-muted-foreground">{noneLabel ?? t('none')}</span>
            ) : (
               value.map((id) => {
                  const option = byId.get(id);
                  const color = colorForAgent(option?.colorSeed ?? option?.id ?? id);
                  return (
                     <div
                        key={id}
                        title={id}
                        className="inline-flex min-w-0 max-w-full items-center gap-1 rounded-full border px-2 py-[2px] text-foreground"
                        style={{
                           backgroundColor: `${color}26`,
                           borderColor: color,
                        }}
                     >
                        <BerryMark
                           size="sm"
                           tone="working"
                           dotColor={color}
                           label={option?.label ?? id}
                           className="size-3"
                        />
                        <span className="truncate leading-none">{labelFor(id)}</span>
                        {disabled ? null : (
                           <button
                              type="button"
                              className="inline-flex size-3.5 shrink-0 items-center justify-center rounded-sm opacity-80 hover:opacity-100"
                              aria-label={t('remove', { name: labelFor(id) })}
                              onClick={() => remove(id)}
                           >
                              <X className="size-3" />
                           </button>
                        )}
                     </div>
                  );
               })
            )}
            <AgentPicker
               options={options}
               value={value}
               multiple
               disabled={disabled}
               addLabel={addLabel}
               searchPlaceholder={searchPlaceholder}
               emptyLabel={emptyLabel}
               onChange={(next) => {
                  if (Array.isArray(next)) onChange(next);
               }}
            />
         </div>
      </div>
   );
}
