import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';

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
            'default':
               'bg-linear-to-b from-pri-a to-pri-b border border-pri-a text-primary-foreground shadow-xs hover:brightness-110',
            'destructive':
               'bg-destructive text-white shadow-xs hover:bg-destructive/90 focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40',
            'outline':
               'border border-input bg-card shadow-xs hover:bg-secondary hover:text-accent-foreground',
            'secondary': 'bg-secondary text-secondary-foreground shadow-xs hover:bg-secondary/80',
            'ghost': 'hover:bg-muted hover:text-accent-foreground',
            'link': 'text-primary-text underline-offset-4 hover:underline',
            'gate': 'bg-gate text-gate-foreground shadow-xs hover:brightness-110',
            /* A secondary control inviting an AI action — "Create with
               agent", "AI Workflow", "Fix with AI" — never the primary
               action on a screen, which already carries the gradient fill
               of `default` and would just get a noisy ring around it.
               `.spark` (app/globals.css) draws the travelling ring on
               `::after`, which is why the border itself is removed here
               rather than left for a border-colour variant to fill.
               Padding is left to `size`, same as every other variant;
               callers needing more room pass a `size`, not a one-off
               className override that would have to out-specify
               `size`'s own `has-[>svg]` padding split. */
            'ai': 'spark border-0',
            /** Settings secondary: a filled neutral control. */
            'soft':
               'bg-settings-control text-foreground hover:bg-settings-control-hover disabled:opacity-100 disabled:text-subtle-foreground',
            /** Settings destructive: neutral fill, danger ink (Revoke, Delete). */
            'soft-destructive':
               'bg-settings-control text-status-danger hover:bg-settings-control-hover disabled:opacity-100 disabled:text-subtle-foreground',
            /** Settings ghost: muted ink, fills on hover. */
            'quiet': 'text-muted-foreground hover:bg-settings-control hover:text-foreground',
            /** Filled track, same as the shell "Back to app" control.
                Both heights are set, and that is the point: `size="default"`
                carries a `min-h-(--ctl-h)` floor of 44px, and a `min-height`
                beats a `height` no matter how important the `height` is. A
                lone `!h-*` here looked like it set the size and did not.
                A toolbar's `[&_button]:!h-[30px]` loses the same way. */
            'track':
               '!h-(--field-h) !min-h-(--field-h) !rounded-full border-0 bg-segment-track px-2.5 text-muted-foreground shadow-none hover:bg-[var(--segment-hover)] hover:text-foreground data-[state=open]:!bg-[var(--segment-hover)] data-[state=open]:!text-foreground',
         },
         size: {
            default: 'min-h-(--ctl-h) min-w-(--ctl-h) px-(--ctl-px)',
            xxs: 'h-6 gap-1.5 px-2.5 has-[>svg]:px-2',
            xs: 'h-7 gap-1.5 px-2.5 has-[>svg]:px-2',
            sm: 'h-[30px] gap-1.5 px-3 has-[>svg]:px-2.5',
            /* 38px: between `sm` (30px) and the 44px floor, for a control
               that wants more room to breathe than the compact sizes but
               does not carry the 44px touch-target requirement `default`
               and `lg` are for. Flat padding, no `has-[>svg]` split: unlike
               the compact sizes, an icon here is not meant to read as
               narrower than the label it sits beside. */
            md: 'h-[38px] gap-1.5 px-4',
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

type ButtonVariantProps = VariantProps<typeof buttonVariants>;

function Button({
   className,
   variant,
   size,
   asChild = false,
   ...props
}: React.ComponentProps<'button'> &
   ButtonVariantProps & {
      asChild?: boolean;
   }) {
   const Comp = asChild ? Slot : 'button';

   return (
      <Comp
         data-slot="button"
         className={buttonVariants({ variant, size, className })}
         {...props}
      />
   );
}

/** Pressed fill for `variant="track"`. */
export const trackButtonPressedClass =
   '!bg-[var(--segment-hover)] !text-foreground hover:!bg-[var(--segment-hover)] hover:!text-foreground';

export { Button, buttonVariants };
