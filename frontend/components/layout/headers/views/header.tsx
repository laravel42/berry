'use client';

import { Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { PageStatement } from '@/components/common/page/page-parts';
import { SaveViewDialog } from '@/components/common/views/save-view-dialog';
import { SavedViewsBar } from '@/components/common/views/saved-views-bar';
import { Button } from '@/components/ui/button';
import { useViewsStore } from '@/store/views-store';

export default function Header() {
   const t = useTranslations('issueLists.views');
   // The views store has no loaded flag, so an empty store says nothing yet:
   // the figure waits for the first view rather than claiming zero.
   const count = useViewsStore((state) => state.views.length);
   const [creating, setCreating] = useState(false);

   return (
      <div className="flex w-full flex-col items-center">
         {/* New view is the page's one action, inline with the title as on the
             other list pages; the tab bar below does not repeat it here. */}
         <PageStatement
            label={t('title')}
            figure={count > 0 ? count : undefined}
            line={t('statement.line', { count })}
            sub={t('statement.sub')}
         >
            <Button className="shrink-0" onClick={() => setCreating(true)}>
               <Plus className="size-4" aria-hidden />
               {t('newView')}
            </Button>
         </PageStatement>
         <SavedViewsBar showCreate={false} showManage={false} />
         <SaveViewDialog open={creating} onOpenChange={setCreating} />
      </div>
   );
}
