'use client';

import { Search } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

interface ToolbarSearchProps {
   value: string;
   onChange: (value: string) => void;
   /** Placeholder and accessible name. */
   label: string;
   /** Width of the field from `sm` up (default `w-64`). */
   className?: string;
}

/**
 * The search that opens a list page's toolbar row, under the title.
 *
 * From `sm` up it is the plain search field. On a phone it rests as an icon
 * button so the filter and display controls keep the line; a tap opens the
 * field across the whole first line, pushing those controls onto the next,
 * and focuses it. It folds back into the icon when it is emptied or loses
 * focus. The icon turns berry while a query is applied, so a folded search
 * still says the list is narrowed.
 *
 * The toolbar must let its items wrap (`flex-wrap`), and on a phone the
 * field's parent must not clip it to one line (the toolbars use
 * `max-sm:contents` for that).
 */
export function ToolbarSearch({ value, onChange, label, className }: ToolbarSearchProps) {
   const [open, setOpen] = useState(false);
   const inputRef = useRef<HTMLInputElement>(null);

   useEffect(() => {
      if (open) inputRef.current?.focus();
   }, [open]);

   const active = value.trim() !== '';

   return (
      <>
         {open ? null : (
            <Button
               size="icon-sm"
               variant="track"
               aria-label={label}
               title={label}
               aria-expanded={false}
               onClick={() => setOpen(true)}
               className={cn('sm:hidden', active && 'text-primary')}
            >
               <Search className="size-4" aria-hidden />
            </Button>
         )}
         <Input
            ref={inputRef}
            variant="search"
            type="search"
            placeholder={label}
            aria-label={label}
            value={value}
            onChange={(event) => {
               const next = event.target.value;
               onChange(next);
               if (next === '') setOpen(false);
            }}
            onBlur={() => setOpen(false)}
            onKeyDown={(event) => {
               if (event.key === 'Escape') event.currentTarget.blur();
            }}
            className={cn('w-64', className, 'max-sm:w-full', !open && 'max-sm:hidden')}
         />
      </>
   );
}
