'use client';

import { useTranslations } from 'next-intl';

import { ModelTiersPanel } from '@/components/common/settings/model-tiers-settings';
import { SetupActions } from '@/components/onboarding/setup-frame';

export function TiersStep({ onContinue, onSkip }: { onContinue: () => void; onSkip: () => void }) {
   const t = useTranslations('workspaceAdmin.onboarding');

   return (
      <>
         <div className="max-h-[min(36rem,56vh)] overflow-y-auto rounded-xl border bg-card p-5">
            <ModelTiersPanel embedded />
         </div>
         <SetupActions
            onSkip={onSkip}
            onContinue={onContinue}
            skipLabel={t('skip')}
            continueLabel={t('finish')}
         />
      </>
   );
}
