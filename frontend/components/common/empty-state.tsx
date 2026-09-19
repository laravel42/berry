import { BerryMark, type BerryMarkState } from '@/components/brand/berry-mark';
import { cn } from '@/lib/utils';
import type { ComponentProps, ReactNode } from 'react';

interface EmptyStateProps extends Omit<ComponentProps<'div'>, 'children'> {
   /** The glyph on top: `EmptyStateMark` for "nothing here", a warning icon for "failed". */
   icon: ReactNode;
   /** `EmptyStateTitle`, then one or more `EmptyStateText`, then `EmptyStateActions`. */
   children: ReactNode;
}

/**
 * What a list or page shows when it has no rows: a glyph, a heading, a line
 * or two and the way forward, centred in at least 16rem.
 *
 * The parts set their own rhythm: 20px from the glyph to whatever follows
 * it, 8px from a title to its text, 4px between lines of text and 24px to
 * the actions. A pane that fills its whole height (the inbox) has its own
 * `InboxPanel`.
 */
export function EmptyState({ icon, children, className, ...props }: EmptyStateProps) {
   return (
      <div
         className={cn(
            'flex h-full min-h-64 w-full items-center justify-center px-6 py-12',
            className
         )}
         {...props}
      >
         <div className="flex max-w-sm flex-col items-center text-center">
            {icon}
            {children}
         </div>
      </div>
   );
}

/** The hollow neutral berry mark: the glyph for "nothing here yet". `label` names it. */
export function EmptyStateMark({
   label,
   state = 'hollow',
}: {
   label: string;
   state?: BerryMarkState;
}) {
   return <BerryMark size="lg" tone="neutral" state={state} label={label} />;
}

/**
 * What a list section shows while its first page is still in flight.
 * Same centred mark + line the Logs page uses — not a spinner or skeleton.
 */
export function EmptyStateLoading({ label }: { label: string }) {
   return (
      <EmptyState icon={<EmptyStateMark label={label} />}>
         <EmptyStateText>{label}</EmptyStateText>
      </EmptyState>
   );
}

interface EmptyStateTitleProps extends ComponentProps<'h2'> {
   /**
    * `display` (default): the serif display face, for a page-level empty state
    * (a workspace with no projects). `plain`: the h2 scale, for a state inside a
    * list or pane.
    */
   variant?: 'display' | 'plain';
}

export function EmptyStateTitle({
   variant = 'display',
   className,
   ...props
}: EmptyStateTitleProps) {
   return (
      <h2
         className={cn(
            'mt-5',
            variant === 'display' && 'font-display tracking-[-0.025em]',
            className
         )}
         {...props}
      />
   );
}

/** A line of supporting text. The first line under a title or the glyph; later lines stack tight. */
export function EmptyStateText({ className, ...props }: ComponentProps<'p'>) {
   return (
      <p
         className={cn(
            'mt-5 leading-relaxed text-muted-foreground [h2+&]:mt-2 [p+&]:mt-1',
            className
         )}
         {...props}
      />
   );
}

/** The way forward: one primary action, or a secondary one to undo a filter or retry. */
export function EmptyStateActions({ className, ...props }: ComponentProps<'div'>) {
   return (
      <div
         className={cn('mt-6 flex flex-wrap items-center justify-center gap-2', className)}
         {...props}
      />
   );
}
