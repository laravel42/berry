import { cn } from '@/lib/utils';
import type { ComponentProps } from 'react';

/**
 * The tracked-caps label over a block of the project detail page and its
 * sidebar ("Tasks", "Properties"), in the shell's dim tone. Write the text in
 * sentence case; CSS sets the caps. Pass `mb-2` where the block below needs
 * more air than the default 4px.
 */
export function DetailSectionLabel({ className, ...props }: ComponentProps<'div'>) {
   return (
      <div
         className={cn(
            'mb-1 pb-[7px] font-medium uppercase tracking-[0.14em] text-[var(--shell-text-dim)]',
            className
         )}
         {...props}
      />
   );
}
