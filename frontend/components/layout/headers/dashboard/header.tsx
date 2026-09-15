'use client';

import { useTranslations } from 'next-intl';

export default function Header() {
   const t = useTranslations('areas.dashboard');
   return (
      <header className="flex w-full items-center border-b px-6 py-3">
         <h1 className="min-w-0 truncate">{t('title')}</h1>
      </header>
   );
}
