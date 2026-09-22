'use client';

import { useTranslations } from 'next-intl';

import { PageStatement } from '@/components/common/page/page-parts';
import { SavedViewsBar } from '@/components/common/views/saved-views-bar';
import { useViewsStore } from '@/store/views-store';

export default function Header() {
   const t = useTranslations('issueLists.views');
   // The views store has no loaded flag, so an empty store says nothing yet:
   // the figure waits for the first view rather than claiming zero.
   const count = useViewsStore((state) => state.views.length);

   return (
      <div className="flex w-full flex-col items-center">
         <PageStatement
            label={t('title')}
            figure={count > 0 ? count : undefined}
            line={t('statement.line', { count })}
            sub={t('statement.sub')}
         />
         <SavedViewsBar />
      </div>
   );
}
