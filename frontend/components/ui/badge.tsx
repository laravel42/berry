import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/lib/utils';

/**
 * Chips under the "Ledger" redesign: the kit's `.pill` — 26px tall, pilled,
 * 10px of side padding, a 7px gap, and its label at 600 on a single line.
 *
 * The height is a floor (`--chip-h`) rather than a fixed height, so a chip
 * whose label wraps grows instead of clipping. The kit sets the label at 12px;
 * the size is left to the base layer here, which gives every element 13px —
 * both clear invariant 5's 12px readability floor, and font sizes are not a
 * component's to set in this codebase.
 */
const badgeVariants = cva(
   'inline-flex items-center justify-center min-h-(--chip-h) rounded-pill border px-2.5 gap-[7px] font-semibold leading-none w-fit whitespace-nowrap shrink-0 [&>svg]:size-3 [&>svg]:pointer-events-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive transition-[color,box-shadow]',
   {
      variants: {
         variant: {
            default:
               'border-transparent bg-primary text-primary-foreground [a&]:hover:bg-primary/90',
            secondary:
               'border-transparent bg-secondary text-secondary-foreground [a&]:hover:bg-secondary/90',
            destructive:
               'border-transparent bg-destructive text-white [a&]:hover:bg-destructive/90 focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40',
            outline: 'text-foreground [a&]:hover:bg-accent [a&]:hover:text-accent-foreground',
         },
      },
      defaultVariants: {
         variant: 'default',
      },
   }
);

function Badge({
   className,
   variant,
   asChild = false,
   ...props
}: React.ComponentProps<'span'> & VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
   const Comp = asChild ? Slot : 'span';

   return (
      <Comp data-slot="badge" className={cn(badgeVariants({ variant }), className)} {...props} />
   );
}

/**
 * The chip geometry alone, for the two chips that are not `Badge`.
 *
 * `common/status-badge` and `common/meta-badge` carry colours and content of
 * their own — a mark plus a word, an icon plus a truncating label — but they
 * were also drawing at three different heights between them. They take the
 * shape from here and keep their own paint.
 */
export const CHIP_GEOMETRY =
   'inline-flex items-center min-h-(--chip-h) rounded-pill px-2.5 gap-[7px] font-semibold leading-none whitespace-nowrap';

export { Badge, badgeVariants };
