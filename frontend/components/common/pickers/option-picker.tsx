'use client';

import { Button } from '@/components/ui/button';
import {
   Command,
   CommandEmpty,
   CommandGroup,
   CommandItem,
   CommandList,
} from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { CheckIcon } from 'lucide-react';
import { useRef, useState, type ComponentProps, type ReactElement, type ReactNode } from 'react';

export interface PickerOption {
   value: string;
   label: string;
   icon?: ReactNode;
}

/**
 * How wide the menu opens. `trigger` is at least the trigger's width and grows
 * to fit the options; `menu` is a fixed 12rem, for triggers too small to size a
 * menu by (an avatar, a glyph in a row).
 */
export type PickerMenuWidth = 'trigger' | 'menu';

const MENU_WIDTH: Record<PickerMenuWidth, string> = {
   trigger: 'w-full min-w-[var(--radix-popper-anchor-width)]',
   menu: 'w-48',
};

interface OptionPickerProps {
   options: readonly PickerOption[];
   /** The chosen option's `value`; `undefined` when nothing is chosen yet. */
   value: string | undefined;
   /** Called with the chosen `value`, also when it is the current one. The menu closes. */
   onValueChange: (value: string) => void;
   /** Shown when `options` is empty. */
   emptyLabel: string;
   menuWidth?: PickerMenuWidth;
   /**
    * A tally shown muted after each option, e.g. how many tasks sit at that
    * priority. Called only while the menu is open, so it may read a store.
    */
   countFor?: (value: string) => number;
   /**
    * The trigger, rendered through `PopoverTrigger asChild`: one element that
    * accepts a ref and spreads its props, usually `PickerIconButton` or
    * `PickerChipButton`. Radix sets its `aria-expanded` and `aria-controls`.
    */
   children: ReactElement;
}

/**
 * Pick one value from a short, fixed list: a popover menu with a check on the
 * current choice. Controlled — the caller owns the value and renders the
 * trigger from it; the picker owns only whether the menu is open.
 *
 * For long or searchable lists (assignees, projects, labels) use a picker
 * with a `CommandInput`; this one has no search on purpose.
 */
export function OptionPicker({
   options,
   value,
   onValueChange,
   emptyLabel,
   menuWidth = 'trigger',
   countFor,
   children,
}: OptionPickerProps) {
   const [open, setOpen] = useState(false);
   const commandRef = useRef<HTMLDivElement>(null);

   const choose = (next: string) => {
      setOpen(false);
      onValueChange(next);
   };

   return (
      <Popover open={open} onOpenChange={setOpen}>
         <PopoverTrigger asChild>{children}</PopoverTrigger>
         <PopoverContent
            className={cn('border-input p-0', MENU_WIDTH[menuWidth])}
            align="start"
            // Radix would focus the content, above cmdk's key handler, and the
            // arrow keys would go nowhere. Focus the listbox instead: its keys
            // reach cmdk, and its aria-activedescendant names the highlight.
            onOpenAutoFocus={(event) => {
               event.preventDefault();
               commandRef.current?.querySelector<HTMLElement>('[cmdk-list]')?.focus();
            }}
         >
            {/* Keyboard highlight starts on the current choice. */}
            <Command ref={commandRef} defaultValue={value}>
               <CommandList>
                  <CommandEmpty>{emptyLabel}</CommandEmpty>
                  <CommandGroup>
                     {options.map((option) => (
                        <CommandItem
                           key={option.value}
                           value={option.value}
                           onSelect={() => choose(option.value)}
                           className="flex items-center justify-between"
                        >
                           <div className="flex items-center gap-2">
                              {option.icon}
                              {option.label}
                           </div>
                           {value === option.value ? (
                              <CheckIcon size={16} className="ml-auto" />
                           ) : null}
                           {countFor ? (
                              <span className="text-muted-foreground">
                                 {countFor(option.value)}
                              </span>
                           ) : null}
                        </CommandItem>
                     ))}
                  </CommandGroup>
               </CommandList>
            </Command>
         </PopoverContent>
      </Popover>
   );
}

type PickerButtonProps = Omit<ComponentProps<typeof Button>, 'variant' | 'size' | 'role'>;

/**
 * A 28px ghost square holding only a glyph, for dense rows and property
 * panels. It has no visible text, so `aria-label` is required: name the
 * property and its current value ("Priority: Urgent").
 */
export function PickerIconButton({
   className,
   ...props
}: PickerButtonProps & { 'aria-label': string }) {
   return (
      <Button
         role="combobox"
         size="icon"
         variant="ghost"
         className={cn('flex size-7 items-center justify-center', className)}
         {...props}
      />
   );
}

/** A glyph and its label on a secondary chip, for the property row of a create dialog. */
export function PickerChipButton({ className, ...props }: PickerButtonProps) {
   return (
      <Button
         role="combobox"
         size="xs"
         variant="secondary"
         className={cn('flex items-center justify-center', className)}
         {...props}
      />
   );
}
