'use client';

import { useId, useState, type ComponentProps, type FocusEvent } from 'react';

import { BerryMark } from '@/components/brand/berry-mark';
import { RevealToggle } from '@/components/common/reveal-toggle';
import { Input } from '@/components/ui/input';
import { Popover, PopoverAnchor, PopoverArrow, PopoverContent } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

export interface PasswordRule {
   id: string;
   /** Stated as the requirement, not as the failure: "At least 12 characters". */
   label: string;
   met: (value: string) => boolean;
}

/**
 * What the server actually refuses, and nothing else.
 *
 * `emailAndPassword` in server-ts/src/auth/better-auth.ts sets
 * `minPasswordLength: 12` and `maxPasswordLength: 256`, and there is no
 * complexity check anywhere in src/auth. So a rule here about capitals, digits
 * or symbols would be a sentence the API never enforces: the form would hold
 * back a password that `POST /sign-up/email` accepts, and any other client --
 * or curl -- would sail past the advice. A checklist that does not match the
 * gate is worse than no checklist, because the user believes it.
 *
 * If the product wants real complexity rules, they belong in better-auth.ts
 * first; this list then follows and the popover needs no other change.
 */
export const passwordRules: readonly PasswordRule[] = [
   { id: 'min', label: 'At least 12 characters', met: (value) => value.length >= 12 },
   { id: 'max', label: 'At most 256 characters', met: (value) => value.length <= 256 },
];

/** The submit gate. Callers must use this rather than restating a length. */
export function passwordMeetsRules(
   value: string,
   rules: readonly PasswordRule[] = passwordRules
): boolean {
   return rules.every((rule) => rule.met(value));
}

interface PasswordFieldProps extends Omit<ComponentProps<typeof Input>, 'type' | 'value'> {
   value: string;
   /** Pass the rules to show the checklist. Omit on sign-in: the password
    *  already exists, so its requirements are not the user's problem. */
   rules?: readonly PasswordRule[];
   showLabel?: string;
   hideLabel?: string;
}

/**
 * A password input that says what it wants and lets you look at what you typed.
 *
 * The requirements hang off the field in a popover with an arrow, anchored
 * rather than triggered: the field is not a button, so there is nothing to
 * click, and the popover must never take the focus it is pointing at. It opens
 * when focus enters the field and closes when focus leaves it -- including
 * focus moving to the reveal toggle, which lives inside the same wrapper and so
 * does not count as leaving. Escape dismisses it for the rest of the visit to
 * the field.
 *
 * Each rule is marked with the bracket from the Berry mark: `[ ]` while unmet,
 * `[*]` with the berry dot once satisfied. The marker carries the state as a
 * shape, and the row states it in words for a screen reader, so neither the
 * colour nor the dot is doing the job alone.
 */
export function PasswordField({
   className,
   id,
   rules,
   value,
   showLabel = 'Show password',
   hideLabel = 'Hide password',
   ...props
}: PasswordFieldProps) {
   const [revealed, setRevealed] = useState(false);
   const [focused, setFocused] = useState(false);
   const [dismissed, setDismissed] = useState(false);
   const listId = `${useId()}-rules`;

   const hasRules = rules !== undefined && rules.length > 0;
   const open = hasRules && focused && !dismissed;

   const handleBlur = (event: FocusEvent<HTMLDivElement>) => {
      // Focus moving to the reveal toggle stays inside the field.
      if (event.currentTarget.contains(event.relatedTarget)) return;
      setFocused(false);
      setDismissed(false);
   };

   return (
      <Popover open={open}>
         <PopoverAnchor asChild>
            <div
               className="relative"
               onFocus={() => setFocused(true)}
               onBlur={handleBlur}
               onKeyDown={(event) => {
                  if (event.key === 'Escape' && open) setDismissed(true);
               }}
            >
               <Input
                  id={id}
                  type={revealed ? 'text' : 'password'}
                  value={value}
                  aria-describedby={hasRules ? listId : undefined}
                  // Room for the toggle, so a long value never runs under it.
                  className={cn('pe-11', className)}
                  {...props}
               />
               <RevealToggle
                  revealed={revealed}
                  onRevealedChange={setRevealed}
                  showLabel={showLabel}
                  hideLabel={hideLabel}
                  disabled={props.disabled}
                  className="absolute end-1 top-1/2 -translate-y-1/2"
               />
            </div>
         </PopoverAnchor>
         {hasRules ? (
            <PopoverContent
               side="bottom"
               align="start"
               sideOffset={8}
               // Nothing in here is interactive, and it is laid over the form
               // it describes -- on the sign-in card it covers the submit
               // button exactly when the rules finally pass. Letting pointer
               // events through keeps the checklist under the field, where the
               // arrow points, without it standing in front of the button.
               pointerThrough
               className="w-(--radix-popover-trigger-width) p-3"
               // The field keeps focus; the popover is feedback, not a dialog.
               onOpenAutoFocus={(event) => event.preventDefault()}
               // Typing in the anchored field counts as "outside" to Radix.
               onInteractOutside={(event) => event.preventDefault()}
            >
               <PopoverArrow />
               <ul id={listId} className="grid gap-1.5">
                  {rules.map((rule) => {
                     const met = rule.met(value);
                     return (
                        <li key={rule.id} className="flex items-center gap-2">
                           <BerryMark
                              size="sm"
                              state={met ? 'solid' : 'empty'}
                              tone="brand"
                              bracketClassName={met ? undefined : 'text-muted-foreground'}
                           />
                           <span className={met ? 'text-foreground' : 'text-muted-foreground'}>
                              {rule.label}
                           </span>
                           <span className="sr-only">{met ? '— met' : '— not met yet'}</span>
                        </li>
                     );
                  })}
               </ul>
            </PopoverContent>
         ) : null}
      </Popover>
   );
}
