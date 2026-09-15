'use client';

import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useApprovalsFilterStore, type ApprovalsView } from '@/store/approvals-filter-store';
import { useTranslations } from 'next-intl';

/**
 * The page's name and its two filters. What approvals are is said once, on
 * the empty list a new workspace sees, not on every visit.
 */
export default function Header() {
   const t = useTranslations('approvals');
   const { view, setView, mine, setMine } = useApprovalsFilterStore();
   return (
      <header className="flex w-full flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b px-6 py-2">
         <h1>{t('title')}</h1>
         <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-2">
               <Switch
                  id="approvals-mine"
                  checked={mine}
                  onCheckedChange={setMine}
                  aria-describedby="approvals-mine-description"
                  title={t('mineDescription')}
               />
               <Label htmlFor="approvals-mine">{t('mine')}</Label>
               <span id="approvals-mine-description" className="sr-only">
                  {t('mineDescription')}
               </span>
            </div>
            <Tabs value={view} onValueChange={(value) => setView(value as ApprovalsView)}>
               <TabsList className="h-8">
                  <TabsTrigger value="pending">{t('views.pending')}</TabsTrigger>
                  <TabsTrigger value="all">{t('views.all')}</TabsTrigger>
                  <TabsTrigger value="resolved">{t('views.resolved')}</TabsTrigger>
               </TabsList>
            </Tabs>
         </div>
      </header>
   );
}
