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
import { Check, ChevronDown, ChevronRight, Search } from 'lucide-react';
import { useState } from 'react';

/** The settings secondary button, for a `<button>` or `<Link>` that cannot be a `Button`. */
export const SETTINGS_PILL_SHAPE =
   'inline-flex h-[30px] w-fit shrink-0 cursor-pointer items-center gap-1.5 rounded-[7px] bg-settings-control px-3 font-medium whitespace-nowrap transition-colors hover:bg-settings-control-hover focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--ring)] disabled:pointer-events-none disabled:text-subtle-foreground';

export const SETTINGS_PILL = `${SETTINGS_PILL_SHAPE} text-foreground`;

/** Centered settings page: title, optional description, stacked sections. */
export function SettingsShell({
   title,
   description,
   badge,
   children,
   compact,
}: {
   title: string;
   description?: React.ReactNode;
   /** Small amber status label beside the title (e.g. "Not yet implemented"). */
   badge?: string;
   children: React.ReactNode;
   /** Tighter section stack, for long lists rather than short forms. */
   compact?: boolean;
}) {
   return (
      <div className="settings-surface h-full w-full overflow-y-auto">
         <div className="mx-auto flex max-w-[720px] flex-col gap-8 px-8 pt-10 pb-24">
            <div className="flex flex-col gap-1.5">
               <div className="flex flex-wrap items-center gap-2.5">
                  {/* The settings bar above is the page's h1 ("Settings"); the
                      page name sits one level down. */}
                  <h2 data-settings-type="title" className="m-0">
                     {title}
                  </h2>
                  {badge ? <SettingsBadge>{badge}</SettingsBadge> : null}
               </div>
               {description ? (
                  <p className="max-w-[600px] text-pretty text-muted-foreground">{description}</p>
               ) : null}
            </div>
            <div className={cn('flex flex-col', compact ? 'gap-6' : 'gap-8')}>{children}</div>
         </div>
      </div>
   );
}

/** Amber "Not yet implemented" style label. */
export function SettingsBadge({ children, title }: { children: React.ReactNode; title?: string }) {
   return (
      <span
         title={title}
         data-settings-type="small"
         className="inline-flex h-[22px] items-center rounded-[6px] bg-settings-badge-warning px-2 font-medium text-status-warning"
      >
         {children}
      </span>
   );
}

export function SettingsSection({
   title,
   description,
   action,
   count,
   children,
   className,
   /** Match agent capability panel titles (`h3.font-medium`) instead of settings page sections. */
   panel,
}: {
   title?: React.ReactNode;
   description?: React.ReactNode;
   action?: React.ReactNode;
   /** Muted count after the title ("People 3"). */
   count?: React.ReactNode;
   children: React.ReactNode;
   className?: string;
   panel?: boolean;
}) {
   if (panel) {
      return (
         <section className={cn('flex flex-col gap-2', className)}>
            {title || action || description ? (
               <div className="flex items-baseline gap-2">
                  {title ? <h3 className="font-medium">{title}</h3> : null}
                  {description ? <p className="text-muted-foreground">{description}</p> : null}
                  {action ? <div className="ml-auto shrink-0">{action}</div> : null}
               </div>
            ) : null}
            <div>{children}</div>
         </section>
      );
   }
   return (
      <section className={cn('flex flex-col gap-2.5', className)}>
         {title || action || description ? (
            <div className="flex items-end justify-between gap-4">
               <div className="flex min-w-0 flex-col gap-0.5">
                  {title ? (
                     <h3 className="m-0">
                        {title}
                        {count !== undefined ? (
                           <span className="ml-1.5 font-medium text-subtle-foreground">
                              {count}
                           </span>
                        ) : null}
                     </h3>
                  ) : null}
                  {description ? (
                     <p data-settings-type="caption" className="text-pretty text-subtle-foreground">
                        {description}
                     </p>
                  ) : null}
               </div>
               {action ? <div className="flex shrink-0 items-center gap-2">{action}</div> : null}
            </div>
         ) : null}
         {children}
      </section>
   );
}

/** A filled group of rows. Rows are divided by a hairline; the group has no outer border. */
export function SettingsCard({
   children,
   className,
}: {
   children: React.ReactNode;
   className?: string;
}) {
   return (
      <div
         className={cn(
            'flex flex-col divide-y divide-settings-divider overflow-hidden rounded-[10px] bg-settings-group',
            className
         )}
      >
         {children}
      </div>
   );
}

/** The handoff's name for a group of rows. */
export const SettingsGroup = SettingsCard;

/** A single settings row: optional icon, label + description, trailing control. */
export function SettingsRow({
   icon,
   title,
   description,
   trailing,
   chevron,
   onClick,
   muted,
   compact,
   align = 'center',
   children,
   className,
}: {
   icon?: React.ReactNode;
   title: React.ReactNode;
   description?: React.ReactNode;
   trailing?: React.ReactNode;
   chevron?: boolean;
   onClick?: () => void;
   muted?: boolean;
   /** 42px list row (toggles, shortcuts, labels) instead of the 14/16 padded row. */
   compact?: boolean;
   /** `start` for rows whose description wraps under a tile (runtimes). */
   align?: 'center' | 'start';
   /** Full-width body under the label, for controls that cannot fit in the trailing slot. */
   children?: React.ReactNode;
   className?: string;
}) {
   const Comp = onClick ? 'button' : 'div';
   return (
      <Comp
         type={onClick ? 'button' : undefined}
         onClick={onClick}
         className={cn(
            'w-full text-left',
            compact ? 'flex min-h-[42px] items-center px-4' : 'px-4 py-3.5',
            children ? 'flex flex-col items-stretch gap-2.5' : null,
            onClick && 'cursor-pointer transition-colors hover:bg-settings-row-hover',
            muted && 'opacity-60',
            className
         )}
      >
         <div
            className={cn(
               'flex w-full min-w-0 gap-3',
               align === 'start' ? 'items-start' : 'items-center'
            )}
         >
            {icon ? <SettingsTile>{icon}</SettingsTile> : null}
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
               <div className="flex min-w-0 flex-wrap items-center gap-2 font-medium text-foreground">
                  {title}
               </div>
               {description ? (
                  <div data-settings-type="caption" className="text-pretty text-subtle-foreground">
                     {description}
                  </div>
               ) : null}
            </div>
            {trailing ? (
               <div className="flex shrink-0 items-center gap-2 text-muted-foreground">
                  {trailing}
               </div>
            ) : null}
            {chevron ? <ChevronRight className="size-4 shrink-0 text-subtle-foreground" /> : null}
         </div>
         {children}
      </Comp>
   );
}

/** Right-aligned action strip at the foot of a form group. */
export function SettingsFooter({ children }: { children: React.ReactNode }) {
   return <div className="flex items-center justify-end gap-2 px-4 py-3">{children}</div>;
}

/** Empty state inside a group: a line of secondary text, or a title over a muted description. */
export function SettingsEmpty({
   title,
   description,
}: {
   title: React.ReactNode;
   description?: React.ReactNode;
}) {
   if (!description) return <div className="px-4 py-3.5 text-muted-foreground">{title}</div>;
   return (
      <div className="flex flex-col gap-0.5 px-4 py-3.5">
         <span className="font-medium">{title}</span>
         <span data-settings-type="caption" className="text-subtle-foreground">
            {description}
         </span>
      </div>
   );
}

/** 32px tile (36 on integration cards) for a device glyph, a provider logo or its monogram. */
export function SettingsTile({
   children,
   size = 'md',
   className,
}: {
   children: React.ReactNode;
   size?: 'md' | 'lg';
   className?: string;
}) {
   return (
      <span
         data-settings-type="small"
         className={cn(
            'inline-flex shrink-0 items-center justify-center rounded-[8px] bg-settings-chip font-bold text-muted-foreground',
            size === 'lg' ? 'size-9' : 'size-8',
            className
         )}
      >
         {children}
      </span>
   );
}

/** 22px tag: a scope, a role, a field type. */
export function SettingsChip({
   children,
   className,
}: {
   children: React.ReactNode;
   className?: string;
}) {
   return (
      <span
         data-settings-type="small"
         className={cn(
            'inline-flex h-[22px] shrink-0 items-center gap-1.5 rounded-[6px] bg-settings-chip px-2 whitespace-nowrap text-muted-foreground',
            className
         )}
      >
         {children}
      </span>
   );
}

/** One key of a shortcut ("⌘", "B"). */
export function KeyCap({ children }: { children: React.ReactNode }) {
   return (
      <kbd
         data-settings-type="small"
         className="inline-flex h-[22px] min-w-[22px] items-center justify-center rounded-[5px] bg-settings-control px-1.5 font-sans font-medium text-foreground"
      >
         {children}
      </kbd>
   );
}

export type SettingsStatus = 'connected' | 'available' | 'off';

/** 6px dot plus a 12px label: Connected (green), Available (grey), Not installed / not connected (dim). */
export function StatusIndicator({
   status,
   children,
}: {
   status: SettingsStatus;
   children: React.ReactNode;
}) {
   return (
      <span
         data-settings-type="caption"
         className={cn(
            'inline-flex items-center gap-1.5',
            status === 'connected' ? 'text-muted-foreground' : 'text-subtle-foreground'
         )}
      >
         <span
            aria-hidden
            className={cn(
               'size-1.5 shrink-0 rounded-full',
               status === 'connected'
                  ? 'bg-status-success'
                  : status === 'available'
                    ? 'bg-status-neutral'
                    : 'bg-settings-field-focus'
            )}
         />
         {children}
      </span>
   );
}

/** A labelled figure; sit them in `StatTileGrid`. */
export function StatTile({
   label,
   value,
   large,
}: {
   label: React.ReactNode;
   value: React.ReactNode;
   /** 24px figure instead of 22. */
   large?: boolean;
}) {
   return (
      <div className="flex flex-col gap-1.5 rounded-[10px] bg-settings-group p-4">
         <span data-settings-type="caption" className="text-subtle-foreground">
            {label}
         </span>
         <span data-settings-type={large ? 'stat-lg' : 'stat'} className="text-foreground">
            {value}
         </span>
      </div>
   );
}

export function StatTileGrid({
   children,
   min = 150,
}: {
   children: React.ReactNode;
   /** Minimum tile width in px before the grid wraps. */
   min?: number;
}) {
   return (
      <div
         className="grid gap-3"
         style={{ gridTemplateColumns: `repeat(auto-fit, minmax(min(100%, ${min}px), 1fr))` }}
      >
         {children}
      </div>
   );
}

/** 28px icon button; `destructive` turns the glyph red on hover. */
export function SettingsIconButton({
   label,
   onClick,
   destructive,
   disabled,
   children,
}: {
   label: string;
   onClick?: () => void;
   destructive?: boolean;
   disabled?: boolean;
   children: React.ReactNode;
}) {
   return (
      <button
         type="button"
         aria-label={label}
         title={label}
         onClick={onClick}
         disabled={disabled}
         className={cn(
            'inline-flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-[6px] text-subtle-foreground transition-colors outline-none hover:bg-settings-control focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-[13px]',
            destructive ? 'hover:text-status-danger' : 'hover:text-foreground'
         )}
      >
         {children}
      </button>
   );
}

/** A filled search field with a leading glyph, used above settings lists. */
export function SettingsSearch({
   value,
   onChange,
   placeholder,
   className,
   'aria-label': ariaLabel,
}: {
   'value': string;
   'onChange': (value: string) => void;
   'placeholder': string;
   'className'?: string;
   'aria-label'?: string;
}) {
   return (
      <label
         className={cn(
            'flex h-[30px] min-w-0 flex-1 items-center gap-2 rounded-[7px] border border-settings-field-line bg-settings-field px-2.5 text-settings-placeholder focus-within:border-settings-field-focus',
            className
         )}
      >
         <Search className="size-[13px] shrink-0" aria-hidden />
         <input
            // Not type="search": globals.css pins that type to 16px, and this
            // field sits in a 13px row.
            type="text"
            role="searchbox"
            value={value}
            onChange={(event) => onChange(event.target.value)}
            placeholder={placeholder}
            aria-label={ariaLabel ?? placeholder}
            className="min-w-0 flex-1 border-0 bg-transparent p-0 text-foreground outline-none [font:inherit] placeholder:text-settings-placeholder [&::-webkit-search-cancel-button]:hidden"
         />
      </label>
   );
}

/** Width of a control right-aligned in a row. */
export const SETTINGS_CONTROL_WIDTH = 'w-[220px]';

const selectTriggerClass =
   'relative inline-flex h-[30px] w-[220px] max-w-full items-center rounded-[7px] border border-settings-field-line bg-settings-field pr-[30px] pl-2.5 text-left text-foreground outline-none transition-colors focus-visible:border-settings-field-focus data-[state=open]:border-settings-field-focus disabled:cursor-not-allowed disabled:opacity-60';
const selectChevronClass =
   'pointer-events-none absolute top-1/2 right-2.5 size-2.5 -translate-y-1/2 text-subtle-foreground';

/** Small functional select (local state) used across the settings pages. */
export function SelectMenu({
   options,
   labels,
   defaultValue,
   'value': controlledValue,
   onChange,
   disabled,
   searchable,
   searchPlaceholder = 'Search…',
   emptyLabel = 'Nothing matches.',
   'aria-label': ariaLabel,
   className,
}: {
   'options': string[];
   /** Display text per option; the option value is shown when absent. */
   'labels'?: Record<string, string>;
   'defaultValue'?: string;
   /** Optional controlled value (e.g. wired to next-themes). */
   'value'?: string;
   'onChange'?: (value: string) => void;
   /** While a write is in flight, so a second click cannot race the first. */
   'disabled'?: boolean;
   /** A filter field, for lists too long to scan (IANA zones). */
   'searchable'?: boolean;
   'searchPlaceholder'?: string;
   'emptyLabel'?: string;
   'aria-label'?: string;
   /** Width overrides; the default is the 220px right-aligned control. */
   'className'?: string;
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
            <PopoverTrigger
               disabled={disabled}
               aria-label={ariaLabel}
               className={cn(selectTriggerClass, className)}
            >
               <span className="min-w-0 truncate">{display}</span>
               <ChevronDown className={selectChevronClass} strokeWidth={2.5} />
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
            className={cn(selectTriggerClass, className)}
         >
            <span className="min-w-0 truncate">{display}</span>
            <ChevronDown className={selectChevronClass} strokeWidth={2.5} />
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
   return <StatusIndicator status="connected">{children}</StatusIndicator>;
}
