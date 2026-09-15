'use client';

import { useTranslations } from 'next-intl';

/**
 * Goals list header. No action, deliberately: planning is what makes a goal and
 * it starts in a project, so the button lives there. Offering it here would
 * invite a goal with no project to hang off.
 */
export default function Header() {
   const t = useTranslations('goals.header');
   return (
      <header className="flex w-full items-center border-b px-6 py-3">
         <h1 className="min-w-0 truncate">{t('title')}</h1>
      </header>
   );
}
