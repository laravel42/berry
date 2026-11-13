import { cn } from '@/lib/utils';

/**
 * A neutral grey placeholder: the ink colour at low opacity, so it reads as
 * grey on both themes. It used to be the primary colour at 10%, which made
 * every loading screen pink.
 */
function Skeleton({ className, ...props }: React.ComponentProps<'div'>) {
   return (
      <div
         data-slot="skeleton"
         className={cn('bg-foreground/[0.07] animate-pulse rounded-md', className)}
         {...props}
      />
   );
}

export { Skeleton };
