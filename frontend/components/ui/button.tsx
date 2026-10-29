import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/lib/utils';

const buttonRecipe = cva(
   "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md font-medium cursor-pointer transition-[color,box-shadow] disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 [&_svg]:shrink-0 outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive",
   {
      variants: {
         variant: {
            'default': '',
            'destructive':
               'bg-destructive text-white shadow-xs hover:bg-destructive/90 focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40',
            'outline':
               'border border-input bg-background shadow-xs hover:bg-accent hover:text-accent-foreground',
            'secondary': 'bg-secondary text-secondary-foreground shadow-xs hover:bg-secondary/80',
            'ghost': 'hover:bg-accent hover:text-accent-foreground',
            'link': 'text-primary underline-offset-4 hover:underline',
            /** Settings secondary: a filled neutral control. */
            'soft':
               'bg-settings-control text-foreground hover:bg-settings-control-hover disabled:opacity-100 disabled:text-subtle-foreground',
            /** Settings destructive: neutral fill, danger ink (Revoke, Delete). */
            'soft-destructive':
               'bg-settings-control text-status-danger hover:bg-settings-control-hover disabled:opacity-100 disabled:text-subtle-foreground',
            /** Settings ghost: muted ink, fills on hover. */
            'quiet': 'text-muted-foreground hover:bg-settings-control hover:text-foreground',
            /** Filled track, same as the shell "Back to app" control. */
            'track':
               '!h-[30px] !rounded-[7px] border-0 bg-segment-track px-2 text-[var(--shell-text-muted)] shadow-none hover:bg-[var(--brand-hairline)] hover:text-[var(--shell-text)] data-[state=open]:!bg-[var(--brand-hairline)] data-[state=open]:!text-[var(--shell-text)]',
         },
         size: {
            default: 'h-[30px] rounded-[7px] px-3 has-[>svg]:px-2.5',
            xxs: 'h-6 rounded-md gap-1.5 px-2.5 has-[>svg]:px-2',
            xs: 'h-7 rounded-md gap-1.5 px-2.5 has-[>svg]:px-2',
            sm: 'h-[30px] rounded-[7px] gap-1.5 px-3 has-[>svg]:px-2.5',
            lg: 'h-10 rounded-[7px] px-6 has-[>svg]:px-4',
            icon: 'size-7 rounded-[6px]',
         },
      },
      defaultVariants: {
         variant: 'default',
         size: 'default',
      },
   }
);

type ButtonVariantProps = VariantProps<typeof buttonRecipe>;

/** Sizes other than the default, which already lives inside `btn-primary`. */
const PRIMARY_SIZE: Record<Exclude<NonNullable<ButtonVariantProps['size']>, 'default'>, string> = {
   xxs: 'h-6 rounded-md gap-1.5 px-2.5 has-[>svg]:px-2',
   xs: 'h-7 rounded-md gap-1.5 px-2.5 has-[>svg]:px-2',
   sm: 'h-[30px] rounded-[7px] gap-1.5 px-3 has-[>svg]:px-2.5',
   lg: 'h-10 rounded-[7px] px-6 has-[>svg]:px-4',
   icon: 'size-7 rounded-[6px]',
};

function buttonVariants({
   variant,
   size,
   className,
}: ButtonVariantProps & { className?: string } = {}) {
   if ((variant ?? 'default') === 'default') {
      return cn('btn-primary', size && size !== 'default' ? PRIMARY_SIZE[size] : null, className);
   }
   return buttonRecipe({ variant, size, className });
}

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
   '!bg-[var(--brand-hairline)] !text-[var(--shell-text)] hover:!bg-[var(--brand-hairline)] hover:!text-[var(--shell-text)]';

export { Button, buttonVariants };
