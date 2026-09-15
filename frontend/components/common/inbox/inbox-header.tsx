'use client';

import { useNotificationsStore } from '@/store/notifications-store';
import { useTranslations } from 'next-intl';

/**
 * The page's one header row.
 *
 * The unread count is stated here rather than only on the bell, because on
 * this page the bell is the thing you just came from.
 */
export function InboxHeader() {
   const t = useTranslations('inbox');
   const unread = useNotificationsStore((state) => state.getUnreadCount());

   return (
      <div className="flex w-full items-center gap-3 border-b px-6 py-3">
         <h1 className="min-w-0 truncate">{t('title')}</h1>
         {unread > 0 ? (
            <span
               aria-label={t('unreadCount', { count: unread })}
               className="shrink-0 rounded-full bg-primary px-2 py-0.5 font-medium tabular-nums text-primary-foreground"
            >
               {unread}
            </span>
         ) : null}
      </div>
   );
}
