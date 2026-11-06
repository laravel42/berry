'use client';

import type { ComponentProps, ReactNode } from 'react';

import { cn } from '@/lib/utils';

/** Auth panel fields: 44px, void fill, gold focus — matches the Auth canvas. */
export const authFieldClass =
   'h-11 rounded-[10px] border border-[#2a2a2f] bg-[#161618] px-3 text-[var(--brand-chalk)] shadow-none outline-none transition-[border-color,box-shadow] placeholder:text-[var(--brand-slate)] focus-visible:border-[#e3b341] focus-visible:shadow-[0_0_0_3px_rgba(227,179,65,0.2)]';

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
      <div className={cn('flex flex-col gap-1.5', className)}>
         <div className="flex font-medium text-[var(--brand-ash)]">
            <label htmlFor={htmlFor}>{label}</label>
            {trailing ? <span className="ml-auto">{trailing}</span> : null}
         </div>
         {children}
      </div>
   );
}

export function AuthField({
   className,
   invalid,
   ...props
}: ComponentProps<'input'> & { invalid?: boolean }) {
   return (
      <input
         data-slot="auth-field"
         className={cn(authFieldClass, 'w-full min-w-0', invalid && 'border-[#7a3a3a]', className)}
         {...props}
      />
   );
}

export function AuthPrimaryButton({
   children,
   className,
   ready = true,
   type = 'button',
   ...props
}: ComponentProps<'button'> & { ready?: boolean }) {
   return (
      <button
         type={type}
         className={cn(
            'flex h-11 w-full items-center justify-center gap-2 rounded-[10px] font-semibold transition-[filter,background]',
            ready
               ? 'bg-[#e3b341] text-[var(--brand-void)] hover:brightness-[1.08]'
               : 'cursor-not-allowed bg-[#242428] text-[var(--brand-slate)]',
            className
         )}
         disabled={!ready || props.disabled}
         {...props}
      >
         {children}
      </button>
   );
}

export function AuthSecondaryButton({
   children,
   className,
   type = 'button',
   ...props
}: ComponentProps<'button'>) {
   return (
      <button
         type={type}
         className={cn(
            'flex h-11 w-full items-center justify-center gap-2 rounded-[10px] border border-[#242428]',
            'font-medium text-[#d6d4d1] transition-colors hover:border-[#3a3a40] hover:bg-[#19191c] hover:text-[var(--brand-chalk)]',
            className
         )}
         {...props}
      >
         {children}
      </button>
   );
}

const STRENGTH_COLORS = ['#e0645a', '#e0a84a', '#6ea0d8', '#5fb08a'] as const;
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

export function PasswordStrength({ password }: { password: string }) {
   const score = passwordScore(password);
   const level = password.length === 0 ? 0 : Math.max(1, score);
   const label =
      password.length === 0
         ? 'At least 12 characters'
         : password.length < 12
           ? STRENGTH_LABELS[0]
           : STRENGTH_LABELS[Math.min(level - 1, 3)];
   const color =
      password.length === 0 ? 'var(--brand-slate)' : STRENGTH_COLORS[Math.min(level - 1, 3)];

   return (
      <div className="flex flex-col gap-1.5">
         <div className="grid grid-cols-4 gap-1">
            {[0, 1, 2, 3].map((index) => (
               <span
                  key={index}
                  className="h-0.5 rounded-sm"
                  style={{
                     background:
                        index < level ? STRENGTH_COLORS[Math.min(level - 1, 3)] : '#242428',
                  }}
               />
            ))}
         </div>
         <span style={{ color }}>{label}</span>
      </div>
   );
}
