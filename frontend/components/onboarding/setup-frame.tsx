'use client';

import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';

import { BerryWordmark } from '@/components/brand/berry-mark';
import { SectionLabel } from '@/components/common/page/page-parts';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export type SetupStepId = 'workspace' | 'workstation' | 'tiers';

const STEP_ORDER: SetupStepId[] = ['workspace', 'workstation', 'tiers'];

const STEP_COPY: Record<SetupStepId, 'stepWorkspace' | 'stepWorkstation' | 'stepTiers'> = {
   workspace: 'stepWorkspace',
   workstation: 'stepWorkstation',
   tiers: 'stepTiers',
};

export function SetupFrame({
   title,
   description,
   step,
   hasWorkspace,
   children,
}: {
   title: string;
   description?: string;
   step: SetupStepId;
   hasWorkspace: boolean;
   children: ReactNode;
}) {
   const t = useTranslations('workspaceAdmin.onboarding');
   const visible = hasWorkspace ? STEP_ORDER.filter((id) => id !== 'workspace') : STEP_ORDER;
   const current = visible.indexOf(step);

   return (
      <div className="min-h-svh bg-background">
         <div className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-6 py-8 lg:flex-row lg:items-start lg:gap-16 lg:py-16">
            <aside className="flex w-full shrink-0 flex-col gap-8 lg:sticky lg:top-16 lg:w-80">
               <BerryWordmark size="md" />
               <div className="flex flex-col gap-3">
                  <SectionLabel>{t('setupLabel')}</SectionLabel>
                  <h1>{title}</h1>
                  {description ? (
                     <p className="text-balance text-muted-foreground">{description}</p>
                  ) : null}
               </div>
               <ol className="flex gap-3 lg:flex-col lg:gap-0">
                  {visible.map((id, index) => {
                     const state =
                        index === current ? 'current' : index < current ? 'done' : 'todo';
                     return (
                        <li key={id} className="flex min-w-0 flex-1 items-start gap-3 lg:flex-none">
                           <div className="flex flex-col items-center self-stretch">
                              <span
                                 className={cn(
                                    'flex size-8 shrink-0 items-center justify-center rounded-md border tabular-nums',
                                    state === 'current' &&
                                       'border-primary bg-primary text-primary-foreground',
                                    state === 'done' &&
                                       'border-status-success bg-status-success/20 text-status-success',
                                    state === 'todo' && 'border-border text-muted-foreground'
                                 )}
                                 aria-current={state === 'current' ? 'step' : undefined}
                              >
                                 {index + 1}
                              </span>
                              {index < visible.length - 1 ? (
                                 <span
                                    aria-hidden
                                    className="mt-1 hidden w-px flex-1 bg-border lg:block"
                                 />
                              ) : null}
                           </div>
                           <span
                              className={cn(
                                 'pt-1.5',
                                 state === 'todo' ? 'text-muted-foreground' : 'font-medium'
                              )}
                           >
                              {t(STEP_COPY[id])}
                           </span>
                        </li>
                     );
                  })}
               </ol>
            </aside>
            <main className="flex min-w-0 flex-1 flex-col gap-4">{children}</main>
         </div>
      </div>
   );
}

export function SetupActions({
   onSkip,
   onContinue,
   continueLabel,
   skipLabel,
   pending,
   continueVariant = 'default',
}: {
   onSkip: () => void;
   onContinue: () => void;
   continueLabel: string;
   skipLabel: string;
   pending?: boolean;
   continueVariant?: 'default' | 'outline';
}) {
   return (
      <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
         <button
            type="button"
            className="text-muted-foreground underline-offset-4 hover:underline"
            onClick={onSkip}
         >
            {skipLabel}
         </button>
         <Button variant={continueVariant} onClick={onContinue} disabled={pending}>
            {continueLabel}
         </Button>
      </div>
   );
}
