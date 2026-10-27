import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/lib/utils';

/**
 * Buttons under the "Ledger" redesign: pilled, bold, and the filled primary a
 * gradient rather than a flat berry. `gate` is the review gate, the one action
 * the monochrome palette still spends colour on.
 *
 * `default` carries the 44px target floor (WCAG 2.5.8) as a MIN height, so a
 * button that has to wrap grows instead of clipping, and so it agrees with
 * `Input`, which takes the same floor. The compact sizes below are explicit
 * opt-ins for dense chrome and deliberately sit under the floor; a toolbar
 * asking for `xs` is asking for that tradeoff by name.
 */
const buttonVariants = cva(
   "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-pill font-bold cursor-pointer transition-[color,box-shadow] disabled:pointer-events-none disabled:opacity-45 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 [&_svg]:shrink-0 outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive",
   {
      variants: {
         variant: {
            default:
               'bg-linear-to-b from-pri-a to-pri-b border border-pri-a text-primary-foreground shadow-xs hover:brightness-110',
            destructive:
               'bg-destructive text-white shadow-xs hover:bg-destructive/90 focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40',
            outline:
               'border border-input bg-card shadow-xs hover:bg-secondary hover:text-accent-foreground',
            secondary: 'bg-secondary text-secondary-foreground shadow-xs hover:bg-secondary/80',
            ghost: 'hover:bg-muted hover:text-accent-foreground',
            link: 'text-primary-text underline-offset-4 hover:underline',
            gate: 'bg-gate text-gate-foreground shadow-xs hover:brightness-110',
         },
         size: {
            default: 'min-h-(--ctl-h) min-w-(--ctl-h) px-(--ctl-px)',
            xxs: 'h-6 gap-1.5 px-2.5 has-[>svg]:px-2',
            xs: 'h-7 gap-1.5 px-2.5 has-[>svg]:px-2',
            sm: 'h-[30px] gap-1.5 px-3 has-[>svg]:px-2.5',
            lg: 'min-h-(--ctl-h-lg) min-w-(--ctl-h-lg) px-(--ctl-px)',
            icon: 'size-7',
         },
      },
      defaultVariants: {
         variant: 'default',
         size: 'default',
      },
   }
);

function Button({
   className,
   variant,
   size,
   asChild = false,
   ...props
}: React.ComponentProps<'button'> &
   VariantProps<typeof buttonVariants> & {
      asChild?: boolean;
   }) {
   const Comp = asChild ? Slot : 'button';

   return (
      <Comp
         data-slot="button"
         className={cn(buttonVariants({ variant, size }), className)}
         {...props}
      />
   );
}

export { Button, buttonVariants };
