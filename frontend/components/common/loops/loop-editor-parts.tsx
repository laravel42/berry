'use client';

import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';

import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';

/**
 * A section of the Loop page: a titled card, its rows separated by hairlines.
 * The hint sits beside the title and says what the section decides.
 */
export function SectionCard({
   title,
   hint,
   action,
   soon,
   className,
   children,
}: {
   title: string;
   hint?: string;
   action?: ReactNode;
   /** Not built yet: the section is shown, dimmed, and labelled. */
   soon?: boolean;
   className?: string;
   children?: ReactNode;
}) {
   return (
      <section
         className={cn('min-w-0 overflow-hidden rounded-[10px] bg-settings-group', className)}
         aria-label={title}
      >
         <div className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1 px-4 pt-3.5 pb-3">
            <h2 data-heading="h3" className="m-0">
               {title}
            </h2>
            {hint ? <span className="min-w-0 text-subtle-foreground">{hint}</span> : null}
            {soon ? <SoonPill /> : null}
            {action ? (
               <div className="ml-auto flex shrink-0 items-center gap-2">{action}</div>
            ) : null}
         </div>
         {children}
      </section>
   );
}

/**
 * One setting: what it is and what it means on the left, the control on the
 * right. Stacks on narrow widths so neither side is squeezed.
 */
export function SettingRow({
   label,
   hint,
   htmlFor,
   soon,
   align = 'center',
   control = 'wide',
   children,
}: {
   label: string;
   hint?: ReactNode;
   htmlFor?: string;
   soon?: boolean;
   align?: 'center' | 'start';
   /** `fit` for a switch or a short control, kept at the row's end. */
   control?: 'wide' | 'fit';
   children: ReactNode;
}) {
   return (
      <div
         className={cn(
            'grid gap-x-6 gap-y-2 border-t border-border/60 px-4 py-3.5',
            control === 'fit'
               ? 'grid-cols-[minmax(0,1fr)_auto]'
               : 'sm:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]',
            align === 'center' ? 'items-center' : 'items-start',
            soon && 'opacity-60'
         )}
      >
         <div className="flex min-w-0 flex-col gap-0.5">
            <span className="flex items-center gap-2 font-medium">
               {htmlFor ? <label htmlFor={htmlFor}>{label}</label> : label}
               {soon ? <SoonPill /> : null}
            </span>
            {hint ? <span className="text-pretty text-subtle-foreground">{hint}</span> : null}
         </div>
         <div className={cn('min-w-0', control === 'fit' && 'justify-self-end')}>{children}</div>
      </div>
   );
}

/** A setting that is a switch. */
export function SwitchRow({
   label,
   hint,
   checked,
   disabled,
   soon,
   onCheckedChange,
}: {
   label: string;
   hint?: ReactNode;
   checked: boolean;
   disabled?: boolean;
   soon?: boolean;
   onCheckedChange?: (checked: boolean) => void;
}) {
   return (
      <SettingRow label={label} hint={hint} soon={soon} control="fit">
         <Switch
            checked={checked}
            disabled={disabled || soon}
            onCheckedChange={onCheckedChange}
            aria-label={label}
         />
      </SettingRow>
   );
}

/** A choice of a few options, as one inset segmented control. */
export function InsetSegments<T extends string>({
   label,
   options,
   value,
   disabled,
   onChange,
}: {
   label: string;
   options: readonly { value: T; label: string }[];
   value: T;
   disabled?: boolean;
   onChange?: (value: T) => void;
}) {
   return (
      <div
         role="radiogroup"
         aria-label={label}
         className="flex gap-0.5 rounded-[7px] border border-border/70 bg-background p-0.5"
      >
         {options.map((option) => {
            const on = option.value === value;
            return (
               <button
                  key={option.value}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  disabled={disabled}
                  onClick={() => onChange?.(option.value)}
                  className={cn(
                     'h-[26px] min-w-0 flex-1 truncate rounded-[5px] px-2 font-medium whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-not-allowed',
                     on
                        ? 'bg-segment-selected text-foreground'
                        : 'text-muted-foreground enabled:hover:text-foreground'
                  )}
               >
                  {option.label}
               </button>
            );
         })}
      </div>
   );
}

/** Marks a control Berry does not offer yet, so its being off is not mistaken for a choice. */
export function SoonPill() {
   const t = useTranslations('loops.editor');
   return (
      <span className="inline-flex h-[18px] shrink-0 items-center rounded-full bg-accent px-1.5 font-normal leading-none text-subtle-foreground">
         {t('soon')}
      </span>
   );
}

/** The input look the Loop page uses: inset, hairline-bordered, full width. */
export const insetFieldClass =
   'h-8 w-full rounded-[7px] border border-border/70 bg-background px-2.5 text-foreground outline-none placeholder:text-placeholder focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-70';
