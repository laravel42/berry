import { cn } from '@/lib/utils';
import type { ComponentProps } from 'react';

/**
 * The label over a block of the project detail page and its sidebar
 * ("Tasks", "Properties"). Sentence case; the type scale sets 11.5 / 600.
 * Pass `mb-2` where the block below needs more air than the default 4px.
 */
export function DetailSectionLabel({ className, ...props }: ComponentProps<'div'>) {
   return (
      <div
         data-heading="label"
         className={cn('mb-1 pb-[7px] text-[var(--shell-text-dim)]', className)}
         {...props}
      />
   );
}
