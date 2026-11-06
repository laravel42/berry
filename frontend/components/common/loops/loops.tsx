'use client';

import { EmptyLoops } from '@/components/common/loops/empty-loops';
import { PageKpiHeader } from '@/components/common/page/page-parts';
import { useTranslations } from 'next-intl';

export default function Loops() {
   const t = useTranslations('loops');

   return (
      <div className="flex h-full min-h-0 flex-col">
         <PageKpiHeader label={t('nav.title')} />
         <EmptyLoops />
      </div>
   );
}
