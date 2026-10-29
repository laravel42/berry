'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';

import { useNotificationsStore } from '@/store/notifications-store';
import { selectOpenReviewCount, useReviewsStore } from '@/store/reviews-store';
import { useSidebarPrefsStore } from '@/store/sidebar-prefs-store';
import { ShellBadge, badgeText } from './shell-badge';
import { ShellIcon, shellNavRow } from './shell-icon';
import { ShellSectionFold } from './shell-section-fold';
import { isMyTasks, isReviews, MY_TASKS_HREF } from './shell-routes';

const INBOX_ICON = '<path d="M4 13h4l1.5 3h5L16 13h4M4 13l2.5-7h11L20 13v5H4z" />';
const TASKS_ICON =
   '<path d="M5 7l2 2 4-4" /><path d="M5 16l2 2 4-4" /><path d="M13 7h6M13 17h6" />';
const REVIEWS_ICON =
   '<circle cx="7" cy="6" r="2" /><circle cx="7" cy="18" r="2" /><circle cx="17" cy="12" r="2" /><path d="M7 8v8M9 18h4a2 2 0 002-2v-2" />';

/**
 * The rail's "personal" section: the places that are about you rather than
 * about the workspace.
 *
 * Inbox is the notifications page. Unread counts on the rail row are how you
 * know something arrived without a floating drawer. Inbox follows the
 * workspace event stream, so a task assigned to you while you are reading
 * something else shows up without a refresh. Reviews sit here: they are
 * waiting on you, not on the workspace. Agent chat is not on the rail.
 */
export function ShellPersonal({ orgId }: { orgId: string }) {
   const t = useTranslations('navigation.sidebar');
   const personalOpen = useSidebarPrefsStore((state) => state.personalOpen);
   const setPersonalOpen = useSidebarPrefsStore((state) => state.setPersonalOpen);
   // The stored fold is unknown during the server render, so Personal stays
   // open until mount and then follows the person's choice.
   const [mounted, setMounted] = useState(false);
   useEffect(() => setMounted(true), []);
   const pathname = usePathname() ?? '';
   const notifications = useNotificationsStore((state) => state.notifications);
   const serverUnreadCount = useNotificationsStore((state) => state.serverUnreadCount);
   const openReviews = useReviewsStore(selectOpenReviewCount) ?? 0;

   // The loaded list is what Inbox shows, so it is what the badge counts;
   // the server figure stands in until the first load arrives.
   const local = notifications.filter((item) => !item.read).length;
   const inboxUnread = notifications.length > 0 ? local : (serverUnreadCount ?? 0);

   // Personal's entry is the assigned tab of the tasks page; the page with
   // every task is Work's Tasks, and only one of the two lights at a time.
   const search = useSearchParams()?.toString() ?? '';
   const onInbox = pathname.startsWith(`/${orgId}/inbox`);
   const onIssues = pathname.startsWith(`/${orgId}/tasks`) && isMyTasks(pathname, search);
   const onReviews = isReviews(pathname, orgId);

   return (
      <ShellSectionFold
         heading={t('personal')}
         open={mounted ? (personalOpen ?? true) : true}
         onOpenChange={setPersonalOpen}
      >
         <ul className="flex flex-col gap-0 px-3 lg:gap-1">
            <li>
               <Link
                  data-shell-nav
                  href={`/${orgId}/inbox`}
                  aria-current={onInbox ? 'page' : undefined}
                  className={shellNavRow(onInbox)}
               >
                  <ShellIcon path={INBOX_ICON} />
                  {t('inbox')}
                  <ShellBadge
                     count={inboxUnread}
                     label={t('inboxUnread', { count: badgeText(inboxUnread) })}
                  />
               </Link>
            </li>
            <li>
               <Link
                  data-shell-nav
                  href={`/${orgId}${MY_TASKS_HREF}`}
                  aria-current={onIssues ? 'page' : undefined}
                  className={shellNavRow(onIssues)}
               >
                  <ShellIcon path={TASKS_ICON} />
                  {t('myIssues')}
               </Link>
            </li>
            <li>
               <Link
                  data-shell-nav
                  href={`/${orgId}/reviews`}
                  aria-current={onReviews ? 'page' : undefined}
                  className={shellNavRow(onReviews)}
               >
                  <ShellIcon path={REVIEWS_ICON} />
                  {t('reviews')}
                  <ShellBadge
                     count={openReviews}
                     label={t('reviewsWaiting', { count: openReviews })}
                  />
               </Link>
            </li>
         </ul>
      </ShellSectionFold>
   );
}
