'use client';

import { useState, type ComponentProps, type ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

/**
 * The auth panel's fields and buttons are the app's own (`Input`, `Button`,
 * `Label`, `Checkbox`); these wrappers only fix the choices the auth screens
 * share. Fields stand on their own line beside the 44/48px buttons, so they
 * take the 44px `lg` field rather than the 32px line-of-controls height.
 */

/** An action set in auth copy ("Forgot?", "Sign up"): the app's link ink. */
export const authLinkClass =
   'cursor-pointer font-semibold text-primary-text underline-offset-4 hover:underline disabled:pointer-events-none disabled:opacity-45';

export function AuthFieldGroup({
   label,
   htmlFor,
   trailing,
   children,
   className,
}: {
   label: ReactNode;
   htmlFor: string;
   trailing?: ReactNode;
   children: ReactNode;
   className?: string;
}) {
   return (
      <div className={cn('flex flex-col gap-2', className)}>
         <div className="flex items-center">
            <Label htmlFor={htmlFor}>{label}</Label>
            {trailing ? <span className="ml-auto">{trailing}</span> : null}
         </div>
         {children}
      </div>
   );
}

export function AuthField({
   invalid,
   ...props
}: Omit<ComponentProps<typeof Input>, 'size'> & { invalid?: boolean }) {
   return <Input size="lg" aria-invalid={invalid || undefined} {...props} />;
}

/** A password field with a Show / Hide toggle inside its right edge. */
export function AuthPasswordField({
   className,
   ...props
}: Omit<ComponentProps<typeof Input>, 'size' | 'type'>) {
   const [show, setShow] = useState(false);
   return (
      <div className="relative">
         <Input
            size="lg"
            type={show ? 'text' : 'password'}
            className={cn('pr-20', className)}
            {...props}
         />
         <Button
            type="button"
            variant="quiet"
            size="sm"
            aria-pressed={show}
            aria-label={show ? 'Hide password' : 'Show password'}
            className="absolute top-1/2 right-1.5 -translate-y-1/2"
            onClick={() => setShow((current) => !current)}
         >
            {show ? 'Hide' : 'Show'}
         </Button>
      </div>
   );
}

export function AuthPrimaryButton({
   className,
   ready = true,
   disabled,
   type = 'button',
   ...props
}: ComponentProps<typeof Button> & { ready?: boolean }) {
   return (
      <Button
         type={type}
         size="lg"
         className={cn('w-full', className)}
         disabled={!ready || disabled}
         {...props}
      />
   );
}

export function AuthSecondaryButton({
   className,
   type = 'button',
   ...props
}: ComponentProps<typeof Button>) {
   return <Button type={type} variant="outline" className={cn('w-full', className)} {...props} />;
}

/** A labelled checkbox under a form ("Trust this device", "Sign out of other devices"). */
export function AuthCheckbox({
   id,
   checked,
   onCheckedChange,
   children,
}: {
   id: string;
   checked: boolean;
   onCheckedChange: (next: boolean) => void;
   children: ReactNode;
}) {
   return (
      <div className="flex items-center gap-2.5">
         <Checkbox
            id={id}
            checked={checked}
            onCheckedChange={(next) => onCheckedChange(next === true)}
         />
         <Label htmlFor={id} className="cursor-pointer font-normal text-muted-foreground">
            {children}
         </Label>
      </div>
   );
}

const STRENGTH_LABELS = [
   'Too short: use at least 12 characters',
   'Weak',
   'Okay',
   'Strong',
] as const;

/** Score 0–4; under 12 characters is capped so the meter never claims strength. */
export function passwordScore(password: string): number {
   let score = 0;
   if (password.length >= 12) score += 1;
   if (/[A-Z]/.test(password) && /[a-z]/.test(password)) score += 1;
   if (/\d/.test(password)) score += 1;
   if (/[^A-Za-z0-9]/.test(password) || password.length >= 16) score += 1;
   return password.length < 12 ? Math.min(score, 1) : score;
}

/** Four bars and a word. Monochrome like every other state in the app. */
export function PasswordStrength({ password }: { password: string }) {
   const score = passwordScore(password);
   const level = password.length === 0 ? 0 : Math.max(1, score);
   const tooShort = password.length > 0 && password.length < 12;
   const label =
      password.length === 0
         ? 'At least 12 characters'
         : tooShort
           ? STRENGTH_LABELS[0]
           : STRENGTH_LABELS[Math.min(level - 1, 3)];

   return (
      <div className="flex flex-col gap-1.5">
         <div className="grid grid-cols-4 gap-1" aria-hidden>
            {[0, 1, 2, 3].map((index) => (
               <span
                  key={index}
                  className={cn('h-1 rounded-full', index < level ? 'bg-foreground' : 'bg-border')}
               />
            ))}
         </div>
         <span className={cn('text-2xs', tooShort ? 'text-destructive' : 'text-subtle-foreground')}>
            {label}
         </span>
      </div>
   );
}
