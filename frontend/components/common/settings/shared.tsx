'use client';

import {
   Command,
   CommandEmpty,
   CommandGroup,
   CommandInput,
   CommandItem,
   CommandList,
} from '@/components/ui/command';
import {
   DropdownMenu,
   DropdownMenuContent,
   DropdownMenuItem,
   DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { Check, ChevronDown, ChevronRight } from 'lucide-react';
import { useState } from 'react';

/** Centered settings page: big title, optional description, stacked sections. */
export function SettingsShell({
   title,
   description,
   badge,
   children,
   compact,
}: {
   title: string;
   description?: string;
   /** Small status label beside the title (e.g. "Not yet implemented"). */
   badge?: string;
   children: React.ReactNode;
   /** Tighter title and section stack, for long lists rather than short forms. */
   compact?: boolean;
}) {
   return (
      <div className="w-full overflow-y-auto h-full">
         <div
            className={cn(
               'mx-auto max-w-2xl px-6',
               compact ? 'py-6 pb-12' : 'py-10 pb-20'
            )}
         >
            <div className="flex flex-wrap items-center gap-3">
               <h1 className="font-display tracking-[-0.025em]">{title}</h1>
               {badge ? (
                  <span className="rounded-md border px-2 py-0.5 text-muted-foreground">
                     {badge}
                  </span>
               ) : null}
            </div>
            {description && <p className="mt-1 text-muted-foreground">{description}</p>}
            <div className={cn('flex flex-col', compact ? 'mt-5 gap-4' : 'mt-10 gap-10')}>
               {children}
            </div>
         </div>
      </div>
   );
}

export function SettingsSection({
   title,
   description,
   action,
   children,
}: {
   title?: string;
   description?: React.ReactNode;
   action?: React.ReactNode;
   children: React.ReactNode;
}) {
   return (
      <section>
         {(title || action) && (
            <div className="flex items-end justify-between gap-4 mb-1">
               <div>
                  {title && <h2 className="text-md font-medium">{title}</h2>}
                  {description && <p className="text-muted-foreground mt-0.5">{description}</p>}
               </div>
               {action}
            </div>
         )}
         <div className="mt-3 flex flex-col gap-3">{children}</div>
      </section>
   );
}

export function SettingsCard({
   children,
   className,
}: {
   children: React.ReactNode;
   className?: string;
}) {
   return (
      <div className={cn('rounded-lg border bg-container divide-y divide-border/60', className)}>
         {children}
      </div>
   );
}

/** A single settings row: optional icon, title + description, trailing control. */
export function SettingsRow({
   icon,
   title,
   description,
   trailing,
   chevron,
   onClick,
   muted,
   children,
}: {
   icon?: React.ReactNode;
   title: React.ReactNode;
   description?: React.ReactNode;
   trailing?: React.ReactNode;
   chevron?: boolean;
   onClick?: () => void;
   muted?: boolean;
   /** Full-width body under the title, for controls that cannot fit in the trailing slot. */
   children?: React.ReactNode;
}) {
   const Comp = onClick ? 'button' : 'div';
   return (
      <Comp
         onClick={onClick}
         className={cn(
            'w-full px-4 py-3 text-left',
            children ? 'flex flex-col items-stretch gap-3' : 'flex items-center gap-3',
            onClick && 'hover:bg-accent/40 transition-colors cursor-pointer',
            muted && 'opacity-60'
         )}
      >
         <div className="flex w-full min-w-0 items-center gap-3">
            {icon && (
               <span className="inline-flex size-8 items-center justify-center rounded-md bg-muted/50 shrink-0 text-muted-foreground">
                  {icon}
               </span>
            )}
            <div className="flex-1 min-w-0">
               <div className="font-medium flex items-center gap-2">{title}</div>
               {description && <div className="text-muted-foreground mt-0.5">{description}</div>}
            </div>
            {trailing && (
               <div className="shrink-0 flex items-center gap-2 text-muted-foreground">{trailing}</div>
            )}
            {chevron && <ChevronRight className="size-4 text-muted-foreground shrink-0" />}
         </div>
         {children}
      </Comp>
   );
}

const selectTriggerClass =
   'h-8 max-w-56 truncate px-3 rounded-md border bg-container inline-flex items-center gap-1.5 hover:bg-accent transition-colors outline-none disabled:opacity-60';

/** Small functional select (local state) used across the settings pages. */
export function SelectMenu({
   options,
   labels,
   defaultValue,
   value: controlledValue,
   onChange,
   disabled,
   searchable,
   searchPlaceholder = 'Search…',
   emptyLabel = 'Nothing matches.',
   'aria-label': ariaLabel,
}: {
   options: string[];
   /** Display text per option; the option value is shown when absent. */
   labels?: Record<string, string>;
   defaultValue?: string;
   /** Optional controlled value (e.g. wired to next-themes). */
   value?: string;
   onChange?: (value: string) => void;
   /** While a write is in flight, so a second click cannot race the first. */
   disabled?: boolean;
   /** A filter field, for lists too long to scan (IANA zones). */
   searchable?: boolean;
   searchPlaceholder?: string;
   emptyLabel?: string;
   'aria-label'?: string;
}) {
   const [internal, setInternal] = useState(defaultValue ?? options[0]);
   const [open, setOpen] = useState(false);
   const value = controlledValue ?? internal;
   const display = labels?.[value] ?? value;

   const choose = (option: string) => {
      setInternal(option);
      onChange?.(option);
      setOpen(false);
   };

   if (searchable) {
      return (
         <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger disabled={disabled} aria-label={ariaLabel} className={selectTriggerClass}>
               <span className="min-w-0 truncate">{display}</span>
               <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
            </PopoverTrigger>
            <PopoverContent align="end" className="w-72 p-0">
               <Command
                  filter={(candidate, search) => {
                     const needle = search.trim().toLowerCase();
                     if (needle === '') return 1;
                     return candidate.toLowerCase().includes(needle) ? 1 : 0;
                  }}
               >
                  <CommandInput placeholder={searchPlaceholder} />
                  <CommandList>
                     <CommandEmpty>{emptyLabel}</CommandEmpty>
                     <CommandGroup>
                        {options.map((option) => {
                           const label = labels?.[option] ?? option;
                           return (
                              <CommandItem
                                 key={option}
                                 value={`${option} ${label}`}
                                 onSelect={() => choose(option)}
                              >
                                 <span className="min-w-0 flex-1 truncate">{label}</span>
                                 {value === option ? <Check className="size-3.5 shrink-0" /> : null}
                              </CommandItem>
                           );
                        })}
                     </CommandGroup>
                  </CommandList>
               </Command>
            </PopoverContent>
         </Popover>
      );
   }

   return (
      <DropdownMenu open={open} onOpenChange={setOpen}>
         <DropdownMenuTrigger
            disabled={disabled}
            aria-label={ariaLabel}
            className={selectTriggerClass}
         >
            <span className="min-w-0 truncate">{display}</span>
            <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
         </DropdownMenuTrigger>
         <DropdownMenuContent align="end" className="max-h-72 min-w-40 overflow-y-auto">
            {options.map((option) => (
               <DropdownMenuItem
                  key={option}
                  onClick={() => choose(option)}
                  className="flex items-center gap-2"
               >
                  <span className="flex-1">{labels?.[option] ?? option}</span>
                  {value === option && <Check className="size-3.5" />}
               </DropdownMenuItem>
            ))}
         </DropdownMenuContent>
      </DropdownMenu>
   );
}

/** "● Enabled ..." green-dot status text. */
export function EnabledDot({ children }: { children: React.ReactNode }) {
   return (
      <span className="inline-flex items-center gap-1.5 text-muted-foreground">
         <span className="size-1.5 rounded-full bg-[#00cc66] shrink-0" />
         {children}
      </span>
   );
}
